# Retyc for Gmail — Claude / agent notes

## Architecture in one screen

Two runtimes, one bridge:

```
mail.google.com tab
├── content-script (isolated world)
│     • Aliases window.chrome = chrome (Firefox doesn't attach `chrome` to window)
│     • Injects pageWorld.js manually as a <script src="moz-/chrome-extension://…">
│       and pre-marks data-inboxsdk-script-injected so InboxSDK skips its broken sendMessage path
│     • InboxSDK.load(2, AppId) → registerComposeViewHandler → addButton('Retyc')
│     • Per compose: builds a draggable PANEL (header + iframe), centered + backdrop,
│       attaches a ComposeBridge, listens for global file drag/drop on Gmail
│     • ComposeBridge: receives postMessage Reqs from iframe, calls InboxSDK ComposeView APIs,
│       broadcasts events back. Polls recipients for change-detection (no native event)
│
└── iframe @ chrome-extension://<id>/src/iframe/iframe.html
      • Vue 3 + @nuxt/ui app — NO header (it lives in the CS)
      • @retyc/sdk runs here (auth, E2EE, upload). File bytes NEVER leave the iframe process
      • Token store: browser.storage.local (webextension-polyfill)
      • Bridge client requests: getRecipients / setToRecipients / getBodyHtml /
        insertBodyHtml / getCurrentUserEmail / getLocale / closeIframe / setContentHeight
      • Bridge client events: composeReady / recipientsChanged / composeClosed /
        filesDropped / hostDragOverlay
      • ResizeObserver on document.body reports natural content height back to the host
        so the panel sizes to fit
```

## Don'ts

- **Do not** sideload InboxSDK from a CDN — the MV3 CSP forbids remote scripts. The
  `@inboxsdk/core` 2.x npm package bundles locally; keep it that way.
- **Do not** route file bytes through the postMessage bridge as actual byte arrays. `File`
  objects pass via structured cloning when forwarded for global drop, which shares the blob
  backing without copying — that's fine. Reading bytes (`arrayBuffer()`) must still happen
  inside the iframe before `@retyc/sdk` encrypts them.
- **Do not** put the panel header (drag handle + close button) inside the iframe Vue app.
  `mousedown`/`mousemove`/`mouseup` must all fire in the same document for a manual drag to
  work — once the cursor leaves the iframe, the iframe stops seeing events. The header lives
  in the content-script DOM (built with vanilla CSS in `createPanel()`); `App.vue` has NO
  header.
- **Do not** forget to register a production InboxSDK AppId before publishing to the Web
  Stores (the placeholder `'sdk'` is dev-only and rate-limited). Update
  `INBOXSDK_APP_ID` in `src/content/index.ts`.
- **Do not** constrain the iframe body height (`height: 100%`). It's intentionally
  unconstrained in `iframe.html` so `document.body.getBoundingClientRect().height` reflects
  the natural content height — that value is pushed to the host via `setContentHeight` and
  used to size the iframe to fit. Re-adding `height: 100%` would break dynamic sizing.
- **Do not** remove the `[Retyc][window.error]` / `[Retyc][unhandledrejection]` listeners
  at the top of `src/content/index.ts`. InboxSDK's internal Logger.error swallows real errors
  as `[object Object]` in the console; the global listeners stringify them properly so
  debugging on Firefox/Chrome is feasible.

## Quirks & workarounds (do not "clean up" without context)

- **`window.chrome = chrome` shim** at the top of `src/content/index.ts`. Firefox content
  scripts get `chrome`/`browser` injected as locals but **not** attached to `window`.
  InboxSDK reads `window.chrome.runtime` directly and crashes without this alias.
- **Manual pageWorld.js injection** (`ensurePageWorldInjected()` in the CS). InboxSDK's
  default path sends `inboxsdk__injectPageWorld` to the service worker which then runs
  `chrome.scripting.executeScript({world: 'MAIN'})`. On Firefox MV3 with temporary add-ons,
  `background.service_worker` is gated and `world: 'MAIN'` support is unreliable. We side-step
  by injecting `pageWorld.js` (copied to `dist/pageWorld.js` by `inboxsdkPageWorldPlugin` in
  `vite.config.mts`) as a `<script src="…">` tag from the content-script — WebExtension WAR
  URLs are CSP-exempt on Gmail. We pre-mark `data-inboxsdk-script-injected` so InboxSDK's
  `injectScript()` short-circuits its own broken path.
- **Dual `service_worker` + `scripts` in manifest** (`dualBackgroundManifestPlugin` in
  `vite.config.mts`). crxjs only emits `background.service_worker` (Chrome's MV3 form).
  Firefox 150+ refuses to load temporary add-ons without `background.scripts`. The plugin
  re-injects `scripts: [<same loader>]` post-build; both browsers ignore the key they don't
  use.
- **`pageWorld.js` is named without a hash** in `dist/`. `chrome.scripting.executeScript`
  references it by literal filename, and we keep that path consistent across Chrome (SW) and
  Firefox (manual injection).

## Panel anatomy

The "modal" is a content-script-owned `<div>` (the panel) containing a host-rendered header
and an iframe child. The panel is centered with `top:50%; left:50%`, transformed with
`translate(calc(-50% + dx), calc(-50% + dy)) scale(s)`:

- `dx`/`dy` accumulate during a drag (mousedown on the header).
- `s` animates between `0.96` (hidden) and `1.0` (shown) for the open/close transition.
- During drag the transition is disabled for instant follow; restored on mouseup.
- Drag is clamped so the panel center stays in-viewport with a 16 px margin.
- Position persists across `toggle()` (close/reopen via the toolbar button keeps your spot).

Three close paths: in-iframe `bridge.closeIframe()` from `App.vue` (Esc + close button) →
`onCloseRequest` callback → `hide()`; click on the backdrop → `hide()`; the toolbar button
re-toggles. `composeView.on('destroy')` removes the panel and backdrop from the DOM.

## Global drag-and-drop

When the panel is open, the CS listens for file drag events on the Gmail document and:

1. Broadcasts `hostDragOverlay { visible: true/false }` to the iframe — `useDropOverlay`
   ORs this with its own local drag counter so the in-modal drop overlay (the cornflower-blue
   dashed inset) lights up regardless of where on the screen the user is dragging.
2. On drop, broadcasts `filesDropped { files }` via postMessage. Structured clone shares
   the underlying blob without copying bytes; `useTransfer` ingests them via `addFiles()` only
   while `composeView === 'prepare'`.

Drops directly on the iframe go through Vue's local handlers as before — the two paths are
disjoint (CS document and iframe document don't share events).

## Testing end-to-end

After `npm run build:dev` and sideloading `dist/`:
1. Open mail.google.com, click Compose, then the Retyc icon → modal opens centered with a
   slight fade + scale animation. Backdrop dims Gmail.
2. In iframe DevTools (right-click iframe → Inspect): `getBridge().getRecipients()` should
   return the current `to`/`cc`/`bcc` arrays.
3. Type a recipient in Gmail → within ~400 ms the iframe's recipient chips update.
4. Drag a file from your desktop **anywhere on the Gmail tab** → the in-modal drop overlay
   lights up. Drop → file appears in the modal's selection list.
5. Drag the modal by its header (logo/title area, NOT the X) → it follows the cursor;
   release stays in place; toggle preserves position.
6. Resize the modal contents (open Options, toggle passphrase…) → the iframe height
   animates to fit, capped at `viewport - 104 px` (after which it scrolls internally).
7. Close via X / backdrop / Escape → fade-out animation.
8. Close the compose window → modal vanishes, `composeClosed` event fires, ResizeObserver
   tears down with the iframe.

## Established conventions (do not break)

- **Compose teardown is owned by `ComposeBridge`**: the bridge listens to `composeView.on('destroy')`
  and runs the `onClose` callback registered in `openPanelSession` (removes panel + backdrop).
  `index.ts` must not duplicate that cleanup — it only nulls the local `session` reference.

- **Bridge dispatch exhaustiveness**: `compose-bridge.ts#dispatch()` has a `const _exhaustive: never`
  guard at the end of the switch. Adding a `ReqKind` to the protocol without a matching case becomes
  a compile error. Workflow: add the entry to `ReqKind`, then add the `case` in the dispatch switch.

- **Expiry ticker in `AccountView.vue`**: the per-second `setInterval` only runs while the expiry
  text is dynamic (token expiry < 1 hour). Managed by a `watch` on `expiryText` — do not
  reintroduce side effects inside the `expiryText` computed.

- **`auth-sync.ts`**: singleton pub/sub bus that translates `browser.storage.onChanged` into
  high-level events (`cleared` / `updated`). `useAuth` consumes it via `onAuthChanged()` without
  knowing the transport. Add new signal sources (BroadcastChannel, CS messages…) in `auth-sync.ts`
  only, never in `useAuth`.

## CI

`.github/workflows/main.yml` runs `_ci.yml` (typecheck + build + lint + upload `dist/`
artifact). `release.yml` triggers on SemVer tags, builds, and attaches a zipped `dist/` to
the GitHub Release. Chrome Web Store auto-publish is gated behind the `PUBLISH_CHROME`
repository variable and the `CHROME_*` secrets.
