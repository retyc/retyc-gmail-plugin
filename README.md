<p align="center">
  <img width="128" src="https://raw.githubusercontent.com/retyc/retyc-gmail-plugin/master/public/assets/icon-128.png" alt="Retyc icon" />
</p>

<h1 align="center">Retyc browser extension for Gmail</h1>

<p align="center">
  Transfer large files securely from Gmail: end-to-end encrypted, GDPR-compliant.<br/>
  Files are encrypted <b>client-side</b> inside the extension iframe and replaced by a secure download link in your message body.
</p>

<p align="center">
  <a href="https://github.com/retyc/retyc-gmail-plugin/actions/workflows/main.yml">
    <img src="https://github.com/retyc/retyc-gmail-plugin/actions/workflows/main.yml/badge.svg" alt="CI" />
  </a>
  <img src="https://img.shields.io/badge/manifest-v3-blue" alt="Manifest V3" />
  <a href="https://github.com/retyc/retyc-gmail-plugin/blob/master/LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" />
  </a>
</p>

---

## Features

- **Drag-and-drop into the extension panel**:  files never go through Gmail's attachment system, so they never traverse
  Google's servers in cleartext
- **End-to-end encryption**:  encryption happens client-side inside the extension iframe via the
  [Retyc SDK](https://www.npmjs.com/package/@retyc/sdk) (age / X25519 hybrid post-quantum) before bytes leave the
  browser
- **Passphrase support**:  required for recipients without a Retyc account, or for passphrase-only transfers without a
  recipient list (≥ 8 characters)
- **OIDC Device Flow auth**:  log in with your Retyc account directly from Gmail
- **Configurable transfer expiry**:  pick how long the transfer link stays alive, from the Options panel
- **Bilingual UI**:  auto-detects Gmail's display language; English / French bundled, switchable from the Account tab
- **Clean emails**:  a Retyc download link is appended to the message body before your signature; recipients are
  mirrored into Gmail's `To` field on confirm

## Requirements

- **Firefox 140+** or a Chromium-based browser (**Chrome**, **Edge**, **Brave**…) supporting WebExtension Manifest V3
- A [Retyc](https://retyc.com) account

## Usage

### 1. Log in

Open Gmail. Click the **Retyc** icon in Gmail's left App Menu (the Mail / Chat / Meet column). If the App Menu is
hidden (Chat and Meet both disabled), a floating Retyc button appears in the bottom-left corner instead. The Retyc
settings panel opens centered on screen; click **Log in with Retyc**. A code and URL appear: open the URL in your
browser, enter the code, and authenticate. Tokens are persisted in `browser.storage.local` so you stay logged in
across sessions.

### 2. Send files via Retyc

In a compose window, click the **Retyc** button in the compose toolbar (circular blue icon). A centered modal panel
opens over Gmail:

1. **Drop files** into the dropzone (or click to pick). You can also drag files from your desktop anywhere on the
   Gmail tab — the drop overlay lights up inside the panel regardless of where on screen you're dragging.
2. The recipient list mirrors Gmail's `To` / `Cc` / `Bcc` fields, edit them in Gmail and the panel stays in sync.
   Your own address is filtered out automatically.
3. Optionally toggle **Use a passphrase** in the Options panel (≥ 8 chars). Required if you have no recipients, or for
   recipients without a Retyc account.
4. Pick a transfer expiry from the same Options panel.
5. Click **Encrypt & insert Retyc link**: the iframe uploads the encrypted bytes, writes the merged recipient list into
   Gmail's `To` field, and inserts a Retyc download link before your signature. The close button is hidden while the
   upload is in progress to prevent accidental interruption.
6. Click **Send** in Gmail normally.

The Account tab shows your current quota (storage + transfers) and lets you switch the UI language.

You can drag the panel by its header (logo / title area) to reposition it anywhere on screen. The position is
preserved across close / reopen cycles for the same compose window.

## Development

### Prerequisites

- Node.js 24+ (declared in `package.json` engines and `.nvmrc`)
- The `@retyc/sdk` package (declared as a runtime dependency, fetched from the public npm registry)
- A Chromium-based browser or Firefox for sideloading

### Setup

```bash
npm install
npm run build:dev      # vite development build
npm run build          # vite production build
npm run watch          # rebuild on file changes
npm run typecheck      # vue-tsc --noEmit
npm run lint           # eslint src
npm run lint:firefox   # web-ext lint on dist/ (validates the Firefox manifest, requires a prior build)
npm run start          # vite dev server with HMR (CRXJS reloads the content-script and iframe)
npm run package        # zip dist/ into retyc-gmail-plugin-<version>.zip for store submission
```

### Sideloading the extension

#### Chromium-based browsers (Chrome, Edge, Brave…)

1. Run `npm run build:dev` (or `npm run start` for live reload).
2. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
3. Toggle **Developer mode** on.
4. Click **Load unpacked** and select the `dist/` directory.
5. Open <https://mail.google.com>, click **Compose**: **Retyc** button appears in the compose toolbar.

#### Firefox

1. Run `npm run build:dev`.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…** and pick `dist/manifest.json`.
4. Open <https://mail.google.com> and look for the Retyc button in any compose toolbar.

### Project structure

```
src/
  background/      # MV3 service worker
    background.ts     # Handles InboxSDK's inboxsdk__injectPageWorld message → scripting.executeScript
  content/         # content-script (runs in mail.google.com)
    index.ts          # InboxSDK init + compose-button + global App Menu entry + panel management
    compose-bridge.ts # CS-side bridge: forwards postMessage requests to InboxSDK ComposeView APIs
    insert-html.ts    # idempotent HTML insertion before signature/quote in the compose body
  shared/bridge/   # protocol shared between CS and iframe
    protocol.ts       # Req / Res / Evt types + origin tag
    client.ts         # iframe-side client (used by the Vue app)
  iframe/          # Vue 3 app served from chrome-extension://<id>/src/iframe/iframe.html
    iframe.html        # entry HTML (loaded by the iframe injected into Gmail)
    main.ts           # bootstrap: wait for bridge handshake, detect locale, mount App
    App.vue           # auth gate + mode routing (Transfer / Account / Login)
    views/            # LoginView, TransferView, AccountView (root views, lazy-loaded)
    components/       # DropZone, RetycLogo, RetycSpinner (reusable partials)
    composables/      # useAuth, useTransfer, useDropOverlay
    shared/           # constants, sdk-factory, token-store (browser.storage.local), upload pipeline
    i18n.ts           # vue-i18n singleton + async locale detection (via bridge.getLocale())
    locales/          # en.ts, fr.ts message bundles
    assets/           # custom.css with the @theme block
public/            # PNG icons (16, 32, 48, 64, 80, 128)
scripts/
  package-zip.js   # node script that zips dist/ for Chrome Web Store / AMO submission
manifest.config.ts # MV3 manifest typed via @crxjs/vite-plugin
vite.config.mts    # Vite + Vue + @nuxt/ui + crxjs + lucide-subset plugin
```

### Architecture

The extension declares **three runtimes**: a background service worker, a content-script (running in Gmail's tab in
the WebExtension isolated world), and an iframe (running on the extension's own origin, `chrome-extension://<id>`).
The content-script and iframe communicate via `postMessage` through a small typed bridge.

**Background service worker** (`src/background/background.ts`): handles a single message type —
`inboxsdk__injectPageWorld` sent by InboxSDK from the content-script. On Chrome it runs
`chrome.scripting.executeScript({ world: 'MAIN', files: ['pageWorld.js'] })` to inject InboxSDK's page-world script
into Gmail's JS context. On Firefox MV3, `world: 'MAIN'` support is unreliable for temporary add-ons, so the
content-script falls back to injecting `pageWorld.js` manually via a `<script src="…">` tag.

**Why an iframe and not a direct DOM injection?** Running the Vue app in a `web_accessible_resources` iframe gives us
two guarantees:

1. **CSP isolation**: Gmail's strict CSP doesn't apply; the iframe runs under the extension's own `extension_pages`
   policy.
2. **CSS isolation**: Gmail's stylesheet doesn't bleed into our `@nuxt/ui` components.

**Why InboxSDK?** It encapsulates the brittle bits of integrating with Gmail's UI (compose toolbar, recipient lists,
body element). It keeps the content-script thin and shields us from Gmail's frequent DOM churn.

**Panel modes**: The content-script can open two kinds of panels, both centered on screen with a backdrop:

- **compose mode** (`?mode=compose`) — tied to a specific `ComposeView`; full Transfer + Account tabs.
  Opened via the circular blue button in the compose toolbar.
- **settings mode** (`?mode=settings`) — not tied to any compose; Account tab only (auth, quota, language).
  Opened via the Gmail App Menu entry (left sidebar) or the floating fallback button.

**Send-via-Retyc flow**

```
User opens a compose window → InboxSDK injects the Retyc button in the compose toolbar
  └─ User clicks Retyc → content-script injects a centered modal panel (header + iframe)
  └─ Iframe Vue app (mode=compose) handshakes with the CS over postMessage
  └─ User drops files into the iframe (HTML5 drag-drop or file picker)
       OR drags files anywhere on the Gmail tab → CS forwards filesDropped + hostDragOverlay events
  └─ Recipients pre-fill from Gmail's To/Cc/Bcc; live-sync via recipientsChanged events (~400 ms poll)
  └─ User optionally types a passphrase (≥ 8 chars)
  └─ User clicks "Encrypt & insert Retyc link"
       ├─ Iframe sends setBusy(true) → CS hides close button, disallows backdrop click
       ├─ Read each File via file.arrayBuffer() → bytes stay in the iframe process
       ├─ @retyc/sdk encrypts client-side (age / X25519 hybrid PQ)
       ├─ SDK uploads encrypted chunks to https://api.retyc.com (direct fetch, no proxy SW)
       ├─ bridge.setToRecipients(recipients) → only if recipients were provided
       ├─ bridge.insertBodyHtml({ html, idempotencyKey })
       │   → CS inserts the snippet before .gmail_signature / .gmail_quote
       └─ Iframe sends setBusy(false) → CS restores close affordances
  └─ User clicks Send in Gmail → email goes through Google's servers with no attachments,
     just the Retyc link in the body
```

**Bridge requests** (iframe → CS):

| Op                    | Description                                                            |
|-----------------------|------------------------------------------------------------------------|
| `getRecipients`       | Returns `{ to, cc, bcc }` arrays from the active ComposeView           |
| `setToRecipients`     | Writes a `string[]` into Gmail's To field                              |
| `getBodyHtml`         | Returns the compose body HTML                                          |
| `insertBodyHtml`      | Inserts a snippet before signature / quote (idempotent)                |
| `getCurrentUserEmail` | Returns the sender's email address                                     |
| `getLocale`           | Returns the Gmail UI locale string                                     |
| `closeIframe`         | Asks the CS to hide the panel                                          |
| `setContentHeight`    | Reports the iframe's natural content height; CS resizes the iframe     |
| `openSettingsPanel`   | Hides the current panel and opens the global settings panel            |
| `setBusy`             | Signals upload start / end; CS disables / re-enables close affordances |

**Bridge events** (CS → iframe):

| Event               | Description                                                     |
|---------------------|-----------------------------------------------------------------|
| `composeReady`      | Fired once when the iframe finishes loading                     |
| `recipientsChanged` | Fired when To / Cc / Bcc change (poll-detected)                 |
| `composeClosed`     | Fired when the ComposeView is destroyed                         |
| `filesDropped`      | Forwarded when files are dropped anywhere on the Gmail tab      |
| `hostDragOverlay`   | `{ visible: boolean }` — drag entered / left the Gmail document |
| `panelHidden`       | Fired when the panel is hidden (close button, backdrop, Escape) |

## License

[MIT](LICENSE) - © Retyc / TripleStack SAS
