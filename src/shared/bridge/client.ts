// Iframe-side bridge client. Sends requests to the content-script (which is the iframe's parent
// in the Gmail tab) and listens for events. Validates origins on every inbound message.

import {
  BRIDGE_TAG,
  isBridgeMessage,
  type EventKind,
  type Evt,
  type InsertBodyHtmlPayload,
  type RecipientList,
  type Req,
  type ReqKind,
} from './protocol'

type EventHandler = (payload?: unknown) => void

const GMAIL_ORIGIN = 'https://mail.google.com'
const REQUEST_TIMEOUT_MS = 10_000

interface PendingRequest {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

class BridgeClient {
  private readonly pending = new Map<string, PendingRequest>()
  private readonly handlers = new Map<EventKind, Set<EventHandler>>()
  private ready = false
  private readyResolvers: Array<() => void> = []

  constructor() {
    window.addEventListener('message', this.onMessage)
  }

  // The content-script sends a `composeReady` event after it has wired up the bridge for this
  // iframe. We wait for it before mounting the Vue app so initial calls don't race the handshake.
  handshake(): Promise<void> {
    if (this.ready) return Promise.resolve()
    return new Promise((resolve) => {
      this.readyResolvers.push(resolve)
    })
  }

  on(event: EventKind, handler: EventHandler): () => void {
    let set = this.handlers.get(event)
    if (!set) {
      set = new Set();
      this.handlers.set(event, set)
    }
    set.add(handler)
    return () => {
      set?.delete(handler)
    }
  }

  // Typed convenience wrappers — keep call-sites strongly typed without leaking `unknown`.
  getRecipients(): Promise<RecipientList> {
    return this.invoke<RecipientList>('getRecipients')
  }

  setToRecipients(emails: string[]): Promise<void> {
    return this.invoke<void>('setToRecipients', emails)
  }

  getBodyHtml(): Promise<string> {
    return this.invoke<string>('getBodyHtml')
  }

  insertBodyHtml(payload: InsertBodyHtmlPayload): Promise<void> {
    return this.invoke<void>('insertBodyHtml', payload)
  }

  getCurrentUserEmail(): Promise<string> {
    return this.invoke<string>('getCurrentUserEmail')
  }

  getLocale(): Promise<string> {
    return this.invoke<string>('getLocale')
  }

  closeIframe(): Promise<void> {
    return this.invoke<void>('closeIframe')
  }

  setContentHeight(height: number): Promise<void> {
    return this.invoke<void>('setContentHeight', {height})
  }

  openSettingsPanel(): Promise<void> {
    return this.invoke<void>('openSettingsPanel')
  }

  // Tell the host whether the iframe is in a non-interruptible state (e.g. uploading). The host
  // uses this to lock the panel: hide / backdrop click / Escape become no-ops and the close
  // button in the host header is hidden until the lock is released.
  setBusy(busy: boolean): Promise<void> {
    return this.invoke<void>('setBusy', {busy})
  }

  private invoke<T>(op: ReqKind, payload?: unknown): Promise<T> {
    const id = crypto.randomUUID()
    const req: Req = {tag: BRIDGE_TAG, kind: 'req', id, op, payload}
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`[Retyc bridge] timeout waiting for ${op}`))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
        timer,
      })
      // Targeting GMAIL_ORIGIN restricts which page can receive the message. The CS's listener
      // re-validates on its side that the source iframe belongs to the extension origin.
      window.parent.postMessage(req, GMAIL_ORIGIN)
    })
  }

  private onMessage = (e: MessageEvent): void => {
    // Only accept messages from the parent Gmail page (the only frame above us).
    if (e.source !== window.parent) return
    if (e.origin !== GMAIL_ORIGIN) return
    if (!isBridgeMessage(e.data)) return

    const msg = e.data
    if (msg.kind === 'res') {
      const pending = this.pending.get(msg.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(msg.id)
      if (msg.ok) pending.resolve(msg.result)
      else pending.reject(new Error(msg.error))
      return
    }
    if (msg.kind === 'evt') {
      this.handleEvent(msg)
    }
  }

  private handleEvent(evt: Evt): void {
    if (evt.event === 'composeReady' && !this.ready) {
      this.ready = true
      const resolvers = this.readyResolvers
      this.readyResolvers = []
      for (const r of resolvers) r()
    }
    const set = this.handlers.get(evt.event)
    if (set) {
      for (const h of set) {
        try {
          h(evt.payload)
        } catch (e) {
          console.error('[Retyc bridge] handler error', e)
        }
      }
    }
  }
}

let _bridge: BridgeClient | null = null

export function getBridge(): BridgeClient {
  if (!_bridge) _bridge = new BridgeClient()
  return _bridge
}

export type {BridgeClient}
