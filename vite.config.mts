import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {defineConfig, type Plugin} from 'vite'
import vue from '@vitejs/plugin-vue'
import ui from '@nuxt/ui/vite'
import {crx} from '@crxjs/vite-plugin'
import {getIconData} from '@iconify/utils'
import manifest from './manifest.config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Icons used by @nuxt/ui components — declared here so the same object drives both
// the ui() theme config and the lucideSubsetPlugin (single source of truth).
// See: https://ui.nuxt.com/docs/getting-started/integrations/icons/vue
const UI_ICONS = {
  arrowDown: 'i-lucide-arrow-down',
  arrowLeft: 'i-lucide-arrow-left',
  arrowRight: 'i-lucide-arrow-right',
  arrowUp: 'i-lucide-arrow-up',
  caution: 'i-lucide-circle-alert',
  check: 'i-lucide-check',
  chevronDoubleLeft: 'i-lucide-chevrons-left',
  chevronDoubleRight: 'i-lucide-chevrons-right',
  chevronDown: 'i-lucide-chevron-down',
  chevronLeft: 'i-lucide-chevron-left',
  chevronRight: 'i-lucide-chevron-right',
  chevronUp: 'i-lucide-chevron-up',
  close: 'i-lucide-x',
  copy: 'i-lucide-copy',
  copyCheck: 'i-lucide-copy-check',
  dark: 'i-lucide-moon',
  drag: 'i-lucide-grip-vertical',
  ellipsis: 'i-lucide-ellipsis',
  error: 'i-lucide-circle-x',
  external: 'i-lucide-arrow-up-right',
  eye: 'i-lucide-eye',
  eyeOff: 'i-lucide-eye-off',
  file: 'i-lucide-file',
  folder: 'i-lucide-folder',
  folderOpen: 'i-lucide-folder-open',
  hash: 'i-lucide-hash',
  info: 'i-lucide-info',
  light: 'i-lucide-sun',
  loading: 'i-lucide-loader-circle',
  menu: 'i-lucide-menu',
  minus: 'i-lucide-minus',
  panelClose: 'i-lucide-panel-left-close',
  panelOpen: 'i-lucide-panel-left-open',
  plus: 'i-lucide-plus',
  reload: 'i-lucide-rotate-ccw',
  search: 'i-lucide-search',
  stop: 'i-lucide-square',
  success: 'i-lucide-circle-check',
  system: 'i-lucide-monitor',
  tip: 'i-lucide-lightbulb',
  upload: 'i-lucide-upload',
  warning: 'i-lucide-triangle-alert',
}

// Builds a minimal Lucide subset at compile time from:
//   1. the icons declared in UI_ICONS (passed as argument)
//   2. any additional i-lucide-* references found in src/
// Emits a virtual module so @iconify-json/lucide never lands in the browser bundle.
function lucideSubsetPlugin(uiIcons: Record<string, string>): Plugin {
  const VIRTUAL_ID = 'virtual:lucide-subset'
  const RESOLVED_ID = '\0virtual:lucide-subset'

  function scanDir(dir: string): Set<string> {
    const names = new Set<string>()
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        for (const n of scanDir(full)) names.add(n)
      } else if (/\.(vue|ts)$/.test(entry.name)) {
        const src = fs.readFileSync(full, 'utf-8')
        for (const m of src.matchAll(/i-lucide-([\w-]+)/g)) names.add(m[1])
      }
    }
    return names
  }

  return {
    name: 'retyc:lucide-subset',
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined
    },
    load(id) {
      if (id !== RESOLVED_ID) return
      const fromConfig = Object.values(uiIcons).flatMap(v => {
        const m = v.match(/^i-lucide-([\w-]+)$/)
        return m ? [m[1]] : []
      })
      const allNames = new Set([...fromConfig, ...scanDir(path.resolve(__dirname, 'src'))])
      const lucideData = JSON.parse(
        fs.readFileSync(path.resolve(__dirname, 'node_modules/@iconify-json/lucide/icons.json'), 'utf-8')
      )
      const icons: Record<string, unknown> = {}
      for (const name of allNames) {
        const data = getIconData(lucideData, name)
        if (data) icons[name] = data
      }
      return `export default ${JSON.stringify({prefix: 'lucide', icons})}`
    },
  }
}

// Firefox MV3 still doesn't support `background.service_worker` for unpacked / temporary add-ons
// (it's gated behind a flag). Chrome MV3 doesn't support `background.scripts`. We declare both
// keys in the final manifest so the same bundle works on both browsers — crxjs only writes
// `service_worker`, so we re-inject `scripts` post-build pointing at the same loader file.
//
// crxjs also injects `use_dynamic_url: false` into every web_accessible_resources entry — a
// Chrome-only field that Firefox rejects with a manifest warning. We strip it here since the
// default (false) applies on Chrome whether or not the key is present.
function dualBackgroundManifestPlugin(): Plugin {
  return {
    name: 'retyc:dual-background-manifest',
    apply: 'build',
    enforce: 'post',
    writeBundle(_, bundle) {
      const manifest = bundle['manifest.json']
      if (!manifest || manifest.type !== 'asset') return
      const json = JSON.parse(manifest.source as string) as {
        background?: { service_worker?: string; scripts?: string[]; type?: string }
        web_accessible_resources?: Array<Record<string, unknown>>
      }
      let changed = false
      if (json.background?.service_worker && !json.background.scripts) {
        json.background.scripts = [json.background.service_worker]
        changed = true
      }
      for (const entry of json.web_accessible_resources ?? []) {
        if ('use_dynamic_url' in entry) {
          delete entry['use_dynamic_url']
          changed = true
        }
      }
      if (changed) {
        const outDir = path.resolve(__dirname, 'dist')
        fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(json, null, 2))
      }
    },
  }
}

// Copies @inboxsdk/core/pageWorld.js into dist/pageWorld.js (fixed name, no hash) so the MV3
// service worker can `chrome.scripting.executeScript({ files: ['pageWorld.js'] })` it into
// Gmail's MAIN world. Without this, InboxSDK throws "Couldn't inject pageWorld.js".
function inboxsdkPageWorldPlugin(): Plugin {
  return {
    name: 'retyc:inboxsdk-pageworld',
    apply: 'build',
    generateBundle() {
      const src = require.resolve('@inboxsdk/core/pageWorld.js')
      this.emitFile({
        type: 'asset',
        fileName: 'pageWorld.js',
        source: fs.readFileSync(src),
      })
    },
  }
}

export default defineConfig(() => ({
  plugins: [
    vue(),
    lucideSubsetPlugin(UI_ICONS),
    inboxsdkPageWorldPlugin(),
    ui({
      colorMode: false,
      router: false,
      ui: {
        icons: UI_ICONS,
        colors: {
          primary: 'cornflower-blue',
          secondary: 'jacaranda',
          neutral: 'zinc',
        },
        button: {slots: {base: 'cursor-pointer'}},
        tabs: {slots: {trigger: 'cursor-pointer'}},
        alert: {slots: {root: 'p-3', description: 'text-xs'}}
      },
    }),
    crx({manifest}),
    dualBackgroundManifestPlugin(),
  ],

  resolve: {
    alias: {
      '@bridge': path.resolve(__dirname, 'src/shared/bridge'),
      'node:buffer': 'buffer',
      'node:stream': 'stream-browserify',
      'node:path': path.resolve(__dirname, 'node_modules/path-browserify/index.js'),
      'fs': path.resolve(__dirname, 'src/iframe/shims/fs.ts'),
      'path': path.resolve(__dirname, 'node_modules/path-browserify/index.js'),
    },
  },

  define: {
    'process.env': '{}',
    'global': 'globalThis',
  },

  optimizeDeps: {
    include: ['buffer', 'stream-browserify', 'path-browserify'],
  },

  publicDir: 'public',

  build: {
    outDir: 'dist',
    // The 1MB content-script bundle is dominated by InboxSDK (no public sub-modules) — it can't
    // really shrink. Below 200kB are the per-feature Vue chunks that load on demand.
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      // Declare the iframe.html as an explicit entry so Vite processes its <script type="module">
      // and emits a hashed bundle. crxjs adds the content-script entry on top of this.
      input: {
        iframe: path.resolve(__dirname, 'src/iframe/iframe.html'),
      },
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
        // Group big shared dependencies into stable, parallel-loadable chunks. Browsers fetch them
        // concurrently, and they cache long-term across releases (only the chunk hash changes when
        // the dependency itself changes, not when our app code changes).
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('@retyc/sdk') || id.includes('retyc-ts-sdk')) return 'retyc-sdk'
          if (id.includes('@iconify/vue') || id.includes('@iconify/utils')) return 'icons'
          if (id.includes('age-encryption') || id.includes('jose')) return 'crypto'
          if (id.includes('@nuxt/ui') || id.includes('reka-ui')) return 'nuxt-ui'
          if (id.includes('@vue/') || id.match(/[\\/]vue[\\/]/) || id.includes('vue-i18n')) return 'vue'
          if (id.includes('buffer') || id.includes('stream-browserify') || id.includes('path-browserify')) return 'node-shims'
          if (id.includes('@inboxsdk')) return 'inboxsdk'
          return 'vendor'
        },
      },
    },
  },

  server: {
    port: 5173,
    strictPort: true,
    hmr: {port: 5173},
  },
}))
