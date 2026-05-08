import {defineManifest} from '@crxjs/vite-plugin'
import pkg from './package.json' with {type: 'json'}

// Manifest V3 manifest for the Retyc Gmail extension.
//
// Architecture: content-script injects InboxSDK into mail.google.com → adds a "Retyc" button to
// every compose toolbar → opens an iframe (web_accessible_resources) hosting the Vue app. The
// iframe runs the @retyc/sdk client (auth, E2EE, upload). All cleartext bytes stay inside the
// extension's own origin; nothing flows through Google's servers.
//
// Why no service worker? Auth, storage and uploads all live in the iframe. host_permissions on
// api.retyc.com let the iframe bypass CORS for direct fetches, so no proxy SW is needed.

export default defineManifest({
  manifest_version: 3,
  name: 'Retyc for Gmail',
  short_name: 'Retyc',
  description: 'Send large files securely from Gmail: end-to-end encrypted, GDPR-compliant.',
  version: pkg.version,
  homepage_url: 'https://retyc.com',

  icons: {
    16: 'assets/icon-16.png',
    32: 'assets/icon-32.png',
    48: 'assets/icon-48.png',
    128: 'assets/icon-128.png',
  },

  permissions: ['storage', 'scripting'],

  host_permissions: [
    'https://mail.google.com/*',
    'https://api.retyc.com/*',
    'https://auth.retyc.com/*',
  ],

  // `service_worker` is what Chrome reads in MV3; Firefox MV3 ignores it and reads `scripts`
  // instead. We declare both so the same bundle works on both browsers. The cast is needed
  // because @crxjs/vite-plugin's typed manifest narrows `background` to one shape; at runtime
  // crxjs and the browsers handle the dual form fine.
  background: {
    service_worker: 'src/background/background.ts',
    scripts: ['src/background/background.ts'],
    type: 'module',
  } as unknown as chrome.runtime.ManifestV3['background'],

  content_scripts: [
    {
      matches: ['https://mail.google.com/*'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
    },
  ],

  web_accessible_resources: [
    {
      resources: [
        'src/iframe/iframe.html',
        'assets/*',
        'chunks/*',
        'pageWorld.js',
      ],
      matches: ['https://mail.google.com/*'],
    },
  ],

  content_security_policy: {
    extension_pages:
      "script-src 'self' 'wasm-unsafe-eval'; " +
      "object-src 'self'; " +
      "connect-src 'self' https://api.retyc.com https://auth.retyc.com",
  },

  browser_specific_settings: {
    gecko: {
      id: 'retyc-gmail@retyc.com',
      strict_min_version: '140.0',
      data_collection_permissions: {
        required: ['none'],
        optional: [],
      },
    },
  },
})
