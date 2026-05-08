import {Buffer} from 'buffer'
import {addCollection} from '@iconify/vue'
import lucideSubset from 'virtual:lucide-subset'
import {createApp} from 'vue'
import ui from '@nuxt/ui/vue-plugin'
import App from './App.vue'
import {i18n, setLocale, detectInitialLocale} from './i18n'
import {getBridge} from '@bridge/client'
import {modeInjectionKey, readModeFromUrl} from './composables/useMode'
import './assets/custom.css'

// Register only the ~50 Lucide icons actually used (app + @nuxt/ui defaults) so the CSP-blocked
// extension never falls back to api.iconify.design. The subset is built at compile time by
// lucideSubsetPlugin in vite.config.mts, cutting the icon chunk from 685 kB to ~15 kB.
addCollection(lucideSubset)

if (typeof globalThis.Buffer === 'undefined') {
  (globalThis as typeof globalThis & { Buffer: typeof Buffer }).Buffer = Buffer
}

async function bootstrap(): Promise<void> {
  const bridge = getBridge()
    // Expose the bridge on window for DevTools debugging:
    //   await window.retyc.bridge.getRecipients()
    // Safe to ship: the bridge already validates origins on every postMessage, so exposing the
    // client-side handle doesn't widen any attack surface.
  ;(window as Window & { retyc?: { bridge: typeof bridge } }).retyc = {bridge}
  // Wait for the content-script to signal it has wired up the compose bridge for this iframe
  // before issuing any cross-frame call (otherwise getLocale() etc. race the listener).
  await bridge.handshake()
  setLocale(await detectInitialLocale(bridge))

  const mode = readModeFromUrl()
  createApp(App)
    .provide(modeInjectionKey, mode)
    .use(i18n)
    .use(ui)
    .mount('#app')

  // Report the document's natural content height to the host so it can size the iframe to fit.
  let lastReported = 0
  const report = (): void => {
    const h = Math.ceil(document.body.getBoundingClientRect().height)
    if (h <= 0 || Math.abs(h - lastReported) < 2) return
    lastReported = h
    void bridge.setContentHeight(h)
  }
  new ResizeObserver(report).observe(document.body)
  queueMicrotask(report)
  requestAnimationFrame(() => requestAnimationFrame(report))
}

void bootstrap()
