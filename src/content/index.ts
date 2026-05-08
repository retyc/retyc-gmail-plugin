// Content-script entry point. Loads InboxSDK, registers a compose-view handler that adds a
// "Retyc" toolbar button, and (on click) injects a draggable modal-style panel containing the
// Vue app iframe. One ComposeBridge per open compose view wires the iframe to the compose APIs.

// Firefox WebExtensions content-scripts get `chrome`/`browser` injected into the local scope but
// NOT attached to `window`. InboxSDK reads `window.chrome.runtime` directly, which throws
// "window.chrome is undefined" on Firefox. Mirror it onto `window` before InboxSDK loads.
if (typeof window !== 'undefined' && !(window as Window & { chrome?: typeof chrome }).chrome) {
  ;(window as Window & { chrome: typeof chrome }).chrome = chrome
}

// InboxSDK's internal Logger.error swallows real errors as "[object Object]" in the console,
// hiding what actually went wrong. Surface the real payload via the global error events.
function safeStringify(v: unknown): string {
  if (v instanceof Error) return v.stack ?? `${v.name}: ${v.message}`
  if (typeof v === 'object' && v !== null) {
    try {
      return JSON.stringify(v, Object.getOwnPropertyNames(v), 2)
    } catch {
      return Object.prototype.toString.call(v)
    }
  }
  return String(v)
}

window.addEventListener('error', (e) => {
  // pageWorld.js runs in the MAIN world of the main Gmail page AND, depending on the SPA's
  // iframe lifecycle, may be re-evaluated inside Gmail's own internal iframes. Our marker
  // attribute is only set on the main document, so the secondary executions throw the
  // "Should not happen" check. That throw is benign — the main-page execution is the one
  // that drives InboxSDK. Suppress the noise.
  const msg = String(e.message ?? '')
  if (msg.includes("InboxSDK pageWorld.js running in document that didn't request it")) return
  console.error('[Retyc][window.error]', safeStringify(e.error ?? e.message), e.filename + ':' + String(e.lineno))
})
window.addEventListener('unhandledrejection', (e) => {
  console.error('[Retyc][unhandledrejection]', safeStringify(e.reason))
})

import * as InboxSDK from '@inboxsdk/core'
import type {ComposeView} from '@inboxsdk/core'
import {ComposeBridge} from './compose-bridge'

// Public AppId — the placeholder InboxSDK ships for development. Replace with the registered
// production AppId before publishing to the Web Stores (https://www.inboxsdk.com/register).
const INBOXSDK_APP_ID = 'sdk_Retyc_061765c48f'

const ICON_URL = chrome.runtime.getURL('assets/icon-black.svg')
const ICON_URL_WHITE = chrome.runtime.getURL('assets/icon-white.svg')
const ICON_URL_BLUE = chrome.runtime.getURL('assets/icon-blue.svg')
const IFRAME_URL = chrome.runtime.getURL('src/iframe/iframe.html')
const IFRAME_ORIGIN = new URL(IFRAME_URL).origin

const ANIM_MS = 180
const HEADER_H = 40

function gmailLang(): string {
  return document.documentElement.lang.split('-')[0].toLowerCase()
}

const BUTTON_LABELS: Record<string, string> = {
  fr: 'Joindre des fichiers avec Retyc',
}
function buttonLabel(): string {
  return BUTTON_LABELS[gmailLang()] ?? 'Attach files with Retyc'
}

interface ActiveSession {
  iframe: HTMLIFrameElement
  bridge: ComposeBridge
  show: () => void
  hide: () => void
  toggle: () => void
  isVisible: () => boolean
}

// Manual pageWorld.js injection: necessary because the SW-based path (InboxSDK sends
// `inboxsdk__injectPageWorld` → SW runs `chrome.scripting.executeScript({world:'MAIN'})`) is
// unreliable on Firefox MV3 temporary add-ons (background.service_worker is gated). Manual
// injection via a `<script src="moz-extension://.../pageWorld.js">` tag works because
// WebExtension WAR URLs are CSP-exempt on Gmail.
//
// Side effect: pageWorld.js can be re-evaluated by Gmail in its own internal iframes. There,
// the marker attribute is missing and pageWorld throws — the throw is suppressed by the
// window.error listener above.
async function ensurePageWorldInjected(): Promise<void> {
  if (document.head.hasAttribute('data-inboxsdk-script-injected')) return
  document.head.setAttribute('data-inboxsdk-script-injected', 'true')
  const url = chrome.runtime.getURL('pageWorld.js')
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = url
    s.onload = () => {
      s.remove();
      resolve()
    }
    s.onerror = () => reject(new Error('pageWorld.js failed to load from ' + url))
    ;(document.head || document.documentElement).appendChild(s)
  })
}

// One global settings session shared across all composes — opens from the global Retyc button
// in the Gmail header.
let settingsSession: ActiveSession | null = null

function getOrOpenSettings(): ActiveSession {
  if (settingsSession && !settingsSession.iframe.isConnected) {
    // Stale ref (DOM removed); reset.
    settingsSession = null
  }
  if (!settingsSession) {
    settingsSession = openSettingsSession()
  } else {
    settingsSession.show()
  }
  return settingsSession
}

function injectButtonStyle(): void {
  const style = document.createElement('style')
  style.textContent = `
    .inboxsdk__compose_sendButton[aria-label*="Retyc"] {
      height: 36px !important;
      width: 36px !important;
      border-radius: 18px !important;
      background: #619af1 !important;
      box-sizing: border-box !important;
      cursor: pointer;
    }
    .inboxsdk__compose_sendButton[aria-label*="Retyc"] .inboxsdk__button_icon {
      margin: 0 !important;
    }
  `
  document.head.appendChild(style)
}

async function main(): Promise<void> {
  console.log('[Retyc] content-script booting, injecting pageWorld…')
  await ensurePageWorldInjected()
  console.log('[Retyc] pageWorld injected, loading InboxSDK…')
  const sdk = await InboxSDK.load(2, INBOXSDK_APP_ID, {
    appName: 'Retyc',
    appIconUrl: ICON_URL_BLUE,
    suppressAddonTitle: 'Retyc',
    globalErrorLogging: false,  // we have our own window.onerror / unhandledrejection handlers
    eventTracking: false,
  })
  console.log('[Retyc] InboxSDK loaded')

  injectButtonStyle()

  // Run in parallel — compose button registration must not wait for AppMenu.isShown().
  void registerGlobalEntry(sdk)

  sdk.Compose.registerComposeViewHandler((composeView: ComposeView) => {
    console.log('[Retyc] compose view detected, adding button')
    let session: ActiveSession | null = null

    try {
      composeView.addButton({
        title: buttonLabel(),
        iconUrl: ICON_URL_WHITE,
        type: 'SEND_ACTION',
        onClick: () => {
          if (!session) {
            session = openComposeSession(composeView)
            return
          }
          session.toggle()
        },
      })
      console.log('[Retyc] button registered')
    } catch (e) {
      console.error('[Retyc] addButton threw', e)
    }

    // Compose teardown: ComposeBridge listens to `composeView.on('destroy')` itself and
    // calls its `onClose` callback (registered in openPanelSession), which removes the
    // panel and backdrop from the DOM. Nothing to do here beyond clearing the local ref.
    composeView.on('destroy', () => {
      session = null
    })
  })
}

interface PanelHandle {
  panel: HTMLDivElement
  iframe: HTMLIFrameElement
  backdrop: HTMLDivElement
  setDragOffset: (dx: number, dy: number) => void
  getDragOffset: () => { dx: number; dy: number }
  setTransition: (enabled: boolean) => void
  applyTransform: (scale: number) => void
}

function openComposeSession(composeView: ComposeView): ActiveSession {
  return openPanelSession({mode: 'compose', composeView})
}

function openSettingsSession(): ActiveSession {
  return openPanelSession({mode: 'settings', composeView: null})
}

interface PanelSessionOptions {
  mode: 'compose' | 'settings'
  composeView: ComposeView | null
}

function openPanelSession(opts: PanelSessionOptions): ActiveSession {
  const handle = createPanel(opts.mode)
  const {panel, iframe, backdrop} = handle
  document.body.appendChild(backdrop)
  document.body.appendChild(panel)

  let visible = false
  // Busy = upload in progress. While busy, every close affordance is a no-op and the X in the
  // header is hidden. Released by the iframe when the upload finishes (success or error).
  let busy = false
  const closeBtn = panel.querySelector<HTMLButtonElement>('[data-retyc-close]')
  const setBusy = (next: boolean): void => {
    busy = next
    if (closeBtn) closeBtn.style.visibility = next ? 'hidden' : 'visible'
    backdrop.style.cursor = next ? 'not-allowed' : ''
  }
  const show = (): void => {
    if (visible) return
    visible = true
    backdrop.style.pointerEvents = 'auto'
    panel.style.pointerEvents = 'auto'
    handle.setTransition(true)
    requestAnimationFrame(() => {
      backdrop.style.opacity = '1'
      panel.style.opacity = '1'
      handle.applyTransform(1)
    })
  }
  const hide = (): void => {
    if (!visible) return
    if (busy) return  // Refuse to close while uploading.
    visible = false
    handle.setTransition(true)
    backdrop.style.opacity = '0'
    backdrop.style.pointerEvents = 'none'
    panel.style.opacity = '0'
    panel.style.pointerEvents = 'none'
    handle.applyTransform(0.96)
    bridge.broadcastPanelHidden()
  }
  const toggle = (): void => {
    if (visible) {
      hide()
    } else {
      show()
    }
  }

  backdrop.addEventListener('click', hide)
  attachDrag(handle)

  // Forward files dropped anywhere on the Gmail tab to the iframe (only while the panel is open).
  // The visible drop UI is rendered by the iframe (useDropOverlay), so the CS just signals when
  // a drag starts/ends and forwards the dropped files.
  const detachDrop = attachWindowFileDrop(
    () => visible,
    (files) => {
      bridge.broadcastFilesDropped(files)
    },
    (v) => {
      bridge.broadcastHostDragOverlay(v)
    },
  )

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && visible) {
      e.preventDefault()
      e.stopPropagation()
      hide()
    }
  }
  document.addEventListener('keydown', onKeyDown, true)

  const MIN_H = 280
  const setHeight = (h: number): void => {
    const max = window.innerHeight - 64 - HEADER_H
    const clamped = Math.max(MIN_H, Math.min(h, max))
    iframe.style.height = `${String(clamped)}px`
  }

  // Wire up the close button in the header.
  closeBtn?.addEventListener('click', hide)

  const bridge = new ComposeBridge({
    composeView: opts.composeView,
    iframe,
    iframeOrigin: IFRAME_ORIGIN,
    onClose: () => {
      document.removeEventListener('keydown', onKeyDown, true)
      detachDrop()
      panel.remove()
      backdrop.remove()
      if (opts.mode === 'settings' && settingsSession?.iframe === iframe) {
        settingsSession = null
      }
    },
    onCloseRequest: hide,
    onContentHeight: setHeight,
    onOpenSettingsPanel: () => {
      // Hide the current panel (typically the compose one) and surface the global settings.
      hide()
      getOrOpenSettings()
    },
    onBusyChange: setBusy,
  })

  show()

  return {iframe, bridge, show, hide, toggle, isVisible: () => visible}
}

function createPanel(mode: 'compose' | 'settings'): PanelHandle {
  const backdrop = document.createElement('div')
  backdrop.setAttribute('aria-hidden', 'true')
  Object.assign(backdrop.style, {
    position: 'fixed',
    inset: '0',
    background: 'rgba(15, 23, 42, 0.45)',
    backdropFilter: 'blur(2px)',
    zIndex: '2147483645',
    opacity: '0',
    transition: `opacity ${String(ANIM_MS)}ms ease`,
    pointerEvents: 'none',
  } satisfies Partial<CSSStyleDeclaration>)

  // The panel wraps the header (drag handle + close button) and the iframe in a single element
  // we can move with transform. Keeping the header in the host (rather than inside the iframe)
  // is what makes mouse drag work across the iframe boundary — mousedown/move/up all fire in the
  // same document.
  const panel = document.createElement('div')
  Object.assign(panel.style, {
    position: 'fixed',
    top: '50%',
    left: '50%',
    width: 'min(480px, calc(100vw - 32px))',
    border: '1px solid rgba(0,0,0,0.08)',
    borderRadius: '14px',
    boxShadow: '0 24px 64px rgba(0,0,0,0.25), 0 2px 8px rgba(0,0,0,0.1)',
    background: '#fff',
    zIndex: '2147483646',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    opacity: '0',
    transformOrigin: 'center center',
    pointerEvents: 'none',
    colorScheme: 'light',
  } satisfies Partial<CSSStyleDeclaration>)

  // Build the header (drag handle + brand + close button).
  const header = document.createElement('div')
  Object.assign(header.style, {
    height: `${String(HEADER_H)}px`,
    flexShrink: '0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 8px 0 12px',
    borderBottom: '1px solid rgb(226, 232, 240)',
    background: '#fff',
    cursor: 'move',
    userSelect: 'none',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  } satisfies Partial<CSSStyleDeclaration>)
  header.setAttribute('data-retyc-drag', 'true')

  const brand = document.createElement('div')
  Object.assign(brand.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    minWidth: '0',
  } satisfies Partial<CSSStyleDeclaration>)
  const icon = document.createElement('img')
  icon.src = ICON_URL_BLUE
  icon.alt = ''
  Object.assign(icon.style, {width: '20px', height: '20px', flexShrink: '0'} satisfies Partial<CSSStyleDeclaration>)
  const title = document.createElement('span')
  title.textContent = 'Retyc'
  Object.assign(title.style, {
    fontSize: '13px',
    fontWeight: '600',
    color: '#243884',  // cornflower-blue-900
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  } satisfies Partial<CSSStyleDeclaration>)
  brand.append(icon, title)

  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.setAttribute('aria-label', 'Close')
  closeBtn.setAttribute('data-retyc-close', 'true')
  closeBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>'
  Object.assign(closeBtn.style, {
    width: '24px',
    height: '24px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    background: 'transparent',
    color: '#64748b',
    borderRadius: '6px',
    cursor: 'pointer',
    padding: '0',
    flexShrink: '0',
  } satisfies Partial<CSSStyleDeclaration>)
  closeBtn.addEventListener('mouseenter', () => {
    closeBtn.style.background = '#f1f5f9'
  })
  closeBtn.addEventListener('mouseleave', () => {
    closeBtn.style.background = 'transparent'
  })
  // Stop drag from starting when clicking close.
  closeBtn.addEventListener('mousedown', (e) => {
    e.stopPropagation()
  })

  header.append(brand, closeBtn)

  const iframe = document.createElement('iframe')
  // Append the mode as a query string so the iframe Vue app knows which view to render.
  iframe.src = `${IFRAME_URL}?mode=${mode}`
  iframe.title = 'Retyc'
  Object.assign(iframe.style, {
    width: '100%',
    height: '320px',  // initial; updated via bridge.setContentHeight
    maxHeight: `calc(100vh - ${String(HEADER_H + 64)}px)`,
    border: 'none',
    display: 'block',
    transition: `height ${String(ANIM_MS)}ms ease`,
  } satisfies Partial<CSSStyleDeclaration>)

  panel.append(header, iframe)

  // Drag offset state — composed with the centering translate(-50%, -50%) and scale.
  let dx = 0
  let dy = 0
  const setDragOffset = (nx: number, ny: number): void => {
    dx = nx;
    dy = ny
  }
  const getDragOffset = (): { dx: number; dy: number } => ({dx, dy})

  const setTransition = (enabled: boolean): void => {
    panel.style.transition = enabled
      ? `opacity ${String(ANIM_MS)}ms ease, transform ${String(ANIM_MS)}ms ease`
      : 'none'
  }
  setTransition(true)

  const applyTransform = (scale: number): void => {
    panel.style.transform =
      `translate(calc(-50% + ${String(dx)}px), calc(-50% + ${String(dy)}px)) scale(${String(scale)})`
  }
  applyTransform(0.96)

  return {panel, iframe, backdrop, setDragOffset, getDragOffset, setTransition, applyTransform}
}

function attachDrag(handle: PanelHandle): void {
  const dragHandle = handle.panel.querySelector<HTMLElement>('[data-retyc-drag]')
  if (!dragHandle) return

  let dragging = false
  let startMouseX = 0
  let startMouseY = 0
  let startDx = 0
  let startDy = 0

  const onMouseMove = (e: MouseEvent): void => {
    if (!dragging) return
    const dx = startDx + (e.clientX - startMouseX)
    const dy = startDy + (e.clientY - startMouseY)
    // Clamp so the panel center stays inside the viewport with a small margin.
    const halfW = handle.panel.offsetWidth / 2
    const halfH = handle.panel.offsetHeight / 2
    const margin = 16
    const minX = -window.innerWidth / 2 + halfW + margin
    const maxX = window.innerWidth / 2 - halfW - margin
    const minY = -window.innerHeight / 2 + halfH + margin
    const maxY = window.innerHeight / 2 - halfH - margin
    handle.setDragOffset(
      Math.max(minX, Math.min(maxX, dx)),
      Math.max(minY, Math.min(maxY, dy)),
    )
    handle.applyTransform(1)
  }

  const onMouseUp = (): void => {
    if (!dragging) return
    dragging = false
    handle.setTransition(true)
    document.removeEventListener('mousemove', onMouseMove, true)
    document.removeEventListener('mouseup', onMouseUp, true)
  }

  dragHandle.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    dragging = true
    startMouseX = e.clientX
    startMouseY = e.clientY
    const {dx, dy} = handle.getDragOffset()
    startDx = dx;
    startDy = dy
    handle.setTransition(false)  // instant follow during drag
    document.addEventListener('mousemove', onMouseMove, true)
    document.addEventListener('mouseup', onMouseUp, true)
  })
}

// Listens for file drag/drop on the Gmail document. When active (panel open), forwards drag
// state changes and dropped Files to the iframe via the bridge. The iframe's own useDropOverlay
// renders the visible drop UI — keeping a single, consistent overlay regardless of whether the
// drag started over Gmail or over the iframe.
function attachWindowFileDrop(
  isActive: () => boolean,
  onFiles: (files: File[]) => void,
  onDragChanged: (visible: boolean) => void,
): () => void {
  let counter = 0
  let lastBroadcast = false
  const sync = (next: boolean): void => {
    if (next === lastBroadcast) return
    lastBroadcast = next
    onDragChanged(next)
  }
  const reset = (): void => {
    counter = 0;
    sync(false)
  }

  const hasFileDrag = (dt: DataTransfer | null): boolean => {
    if (!dt) return false
    const types = Array.from(dt.types ?? [])
    return types.includes('Files')
  }

  const onDragEnter = (e: DragEvent): void => {
    if (!isActive() || !hasFileDrag(e.dataTransfer)) return
    e.preventDefault()
    counter++
    if (counter === 1) sync(true)
  }
  const onDragOver = (e: DragEvent): void => {
    if (!isActive() || !hasFileDrag(e.dataTransfer)) return
    e.preventDefault()  // required to permit drop
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  }
  const onDragLeave = (): void => {
    if (counter === 0) return
    counter--
    if (counter <= 0) reset()
  }
  const onDrop = (e: DragEvent): void => {
    if (!isActive() || !hasFileDrag(e.dataTransfer)) return
    e.preventDefault()
    e.stopPropagation()
    reset()
    const files: File[] = []
    const items = e.dataTransfer?.items
    if (items) {
      for (const item of Array.from(items)) {
        if (item.kind !== 'file') continue
        const entry = item.webkitGetAsEntry?.()
        if (entry?.isDirectory) continue
        const f = item.getAsFile()
        if (f) files.push(f)
      }
    } else if (e.dataTransfer?.files) {
      files.push(...Array.from(e.dataTransfer.files))
    }
    if (files.length > 0) onFiles(files)
  }

  document.addEventListener('dragenter', onDragEnter, true)
  document.addEventListener('dragover', onDragOver, true)
  document.addEventListener('dragleave', onDragLeave, true)
  document.addEventListener('drop', onDrop, true)

  return () => {
    document.removeEventListener('dragenter', onDragEnter, true)
    document.removeEventListener('dragover', onDragOver, true)
    document.removeEventListener('dragleave', onDragLeave, true)
    document.removeEventListener('drop', onDrop, true)
  }
}

// Registers the Retyc entry in Gmail's left App Menu (Mail / Chat / Meet column). Note that
// Gmail only renders the AppMenu when Chat or Meet is enabled in settings; if both are off,
// AppMenu.addMenuItem will log an InboxSDK warning and the icon won't appear. We fall back to
// a floating button in that case so the entry is always reachable.
async function registerGlobalEntry(sdk: InboxSDK.InboxSDK): Promise<void> {
  const onClick = (): void => {
    if (settingsSession?.isVisible()) settingsSession.hide()
    else getOrOpenSettings()
  }

  let appMenuShown = false
  try {
    appMenuShown = await sdk.AppMenu.isShown()
  } catch (e) {
    console.warn('[Retyc] AppMenu.isShown() failed', e)
  }

  if (appMenuShown) {
    try {
      sdk.AppMenu.addMenuItem({
        name: 'Retyc',
        iconUrl: {
          lightTheme: {default: ICON_URL, active: ICON_URL_BLUE},
          darkTheme: {default: ICON_URL_WHITE, active: ICON_URL_BLUE},
        },
        onClick,
        isRouteActive: () => false,
      })
      console.log('[Retyc] AppMenu item registered')
      return
    } catch (e) {
      console.warn('[Retyc] AppMenu.addMenuItem failed; falling back to floating button', e)
    }
  } else {
    console.warn(
      '[Retyc] AppMenu not shown — Gmail only displays it when Chat or Meet is enabled. ' +
      'Enable one of them in Gmail Settings → Chat and Meet, or use the floating button below.',
    )
  }

  injectFloatingFallbackButton()
}

function injectFloatingFallbackButton(): void {
  if (document.getElementById('retyc-global-button')) return
  const button = document.createElement('button')
  button.id = 'retyc-global-button'
  button.type = 'button'
  button.title = 'Retyc'
  button.setAttribute('aria-label', 'Retyc')
  const img = document.createElement('img')
  img.src = ICON_URL
  img.alt = ''
  Object.assign(img.style, {width: '20px', height: '20px', display: 'block'} satisfies Partial<CSSStyleDeclaration>)
  button.appendChild(img)
  Object.assign(button.style, {
    position: 'fixed', bottom: '20px', left: '20px',
    width: '40px', height: '40px',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    border: '1px solid rgba(0,0,0,0.08)', background: '#fff',
    borderRadius: '50%', boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
    cursor: 'pointer', padding: '0', zIndex: '2147483640',
  } satisfies Partial<CSSStyleDeclaration>)
  button.addEventListener('click', () => {
    if (settingsSession?.isVisible()) settingsSession.hide()
    else getOrOpenSettings()
  })
  document.body.appendChild(button)
}

main().catch((e: unknown) => console.error('[Retyc] failed to initialize InboxSDK', e))
