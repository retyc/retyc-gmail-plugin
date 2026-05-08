// Shared protocol for the postMessage bridge between the content-script (where InboxSDK lives,
// running in the page's isolated world on https://mail.google.com) and the iframe (running on
// chrome-extension://<id>/src/iframe/iframe.html, where the Vue app + @retyc/sdk live).
//
// Files (drag-dropped in the iframe) never traverse this bridge — they are encrypted/uploaded
// directly by @retyc/sdk in the iframe context. Only metadata flows through postMessage:
// recipients, body HTML, locale, the current user email, plus a few lifecycle events.

export type ReqKind =
  | 'getRecipients'
  | 'setToRecipients'
  | 'getBodyHtml'
  | 'insertBodyHtml'
  | 'getCurrentUserEmail'
  | 'getLocale'
  | 'closeIframe'
  | 'setContentHeight'
  | 'openSettingsPanel'
  | 'setBusy'

export type EventKind =
  | 'composeReady'
  | 'recipientsChanged'
  | 'composeClosed'
  | 'filesDropped'
  | 'hostDragOverlay'
  | 'panelHidden'

export interface FilesDroppedPayload {
  files: File[]
}

export interface HostDragOverlayPayload {
  visible: boolean
}

export interface RecipientList {
  to: string[]
  cc: string[]
  bcc: string[]
}

export interface InsertBodyHtmlPayload {
  html: string
  // A unique key per insertion attempt. The CS strips any prior <div data-retyc-injected="...">
  // before adding the new one, so re-running the upload doesn't duplicate the snippet.
  idempotencyKey: string
}

// Tag every message with this discriminator so we don't react to unrelated postMessages flying
// around inside Gmail's tab.
export const BRIDGE_TAG = 'retyc-bridge' as const

export interface Req {
  tag: typeof BRIDGE_TAG
  kind: 'req'
  id: string
  op: ReqKind
  payload?: unknown
}

export type Res =
  | { tag: typeof BRIDGE_TAG; kind: 'res'; id: string; ok: true; result?: unknown }
  | { tag: typeof BRIDGE_TAG; kind: 'res'; id: string; ok: false; error: string }

export interface Evt {
  tag: typeof BRIDGE_TAG
  kind: 'evt'
  event: EventKind
  payload?: unknown
}

export type Message = Req | Res | Evt

export function isBridgeMessage(data: unknown): data is Message {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { tag?: unknown }).tag === BRIDGE_TAG
  )
}
