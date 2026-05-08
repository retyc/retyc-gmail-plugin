// Content-script side of the bridge. One instance per iframe (per compose, or one global for the
// settings panel). Receives Req messages, calls the matching InboxSDK ComposeView API when one
// is bound, and sends Res back. Broadcasts events to the iframe.

import type {ComposeView} from '@inboxsdk/core'
import {
  BRIDGE_TAG,
  isBridgeMessage,
  type EventKind,
  type Evt,
  type InsertBodyHtmlPayload,
  type RecipientList,
  type Req,
  type Res,
} from '../shared/bridge/protocol'
import {insertHtmlIntoBody} from './insert-html'

// InboxSDK doesn't expose a `recipientsChanged` event natively. We poll the recipient lists at a
// modest cadence and diff. Stops on compose destroy.
const RECIPIENTS_POLL_MS = 400

interface ComposeBridgeOptions {
  // Bound compose view for the compose-mode panel. `null` for the settings-mode panel — bridge
  // ops that depend on a compose throw "Compose not available" in that case.
  composeView: ComposeView | null
  iframe: HTMLIFrameElement
  iframeOrigin: string  // chrome-extension://<id>
  // Called when the bridge is torn down (compose closed): the host should remove the iframe.
  onClose: () => void
  // Called when the iframe asks to be hidden (user clicked the in-iframe close button).
  onCloseRequest?: () => void
  // Called when the iframe reports its content's natural height; the host resizes the iframe.
  onContentHeight?: (height: number) => void
  // Called when the iframe asks the host to surface the global settings panel (e.g. user clicked
  // "Open Retyc settings" from the LoginPrompt in the compose mode).
  onOpenSettingsPanel?: () => void
  // Called when the iframe enters / leaves a busy state (uploading). The host should disable
  // close affordances while busy.
  onBusyChange?: (busy: boolean) => void
}

export class ComposeBridge {
  private readonly composeView: ComposeView | null
  private readonly iframe: HTMLIFrameElement
  private readonly iframeOrigin: string
  private readonly onClose: () => void
  private readonly onCloseRequest: (() => void) | null
  private readonly onContentHeight: ((h: number) => void) | null
  private readonly onOpenSettingsPanel: (() => void) | null
  private readonly onBusyChange: ((busy: boolean) => void) | null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private lastRecipientsKey = ''
  private destroyed = false

  constructor(opts: ComposeBridgeOptions) {
    this.composeView = opts.composeView
    this.iframe = opts.iframe
    this.iframeOrigin = opts.iframeOrigin
    this.onClose = opts.onClose
    this.onCloseRequest = opts.onCloseRequest ?? null
    this.onContentHeight = opts.onContentHeight ?? null
    this.onOpenSettingsPanel = opts.onOpenSettingsPanel ?? null
    this.onBusyChange = opts.onBusyChange ?? null

    window.addEventListener('message', this.onMessage)

    if (this.composeView) {
      this.composeView.on('destroy', () => {
        if (this.destroyed) return
        this.broadcast('composeClosed')
        this.dispose()
      })
    }

    // Listen for the iframe load event so we can broadcast `composeReady` once it's ready to
    // receive postMessages. The bridge is constructed immediately after the iframe is appended
    // to the DOM, so the load event hasn't fired yet — listening here is reliable.
    this.iframe.addEventListener('load', this.onIframeLoad, {once: true})

    if (this.composeView) this.startRecipientsPoll()
  }

  broadcastFilesDropped(files: File[]): void {
    this.broadcast('filesDropped', {files})
  }

  broadcastHostDragOverlay(visible: boolean): void {
    this.broadcast('hostDragOverlay', {visible})
  }

  // Notify the iframe that the panel has been hidden (close button, backdrop click, escape,
  // or in-iframe close request). Lets the iframe reset terminal-state UI (done/error) so the
  // next open lands on a fresh step 1.
  broadcastPanelHidden(): void {
    this.broadcast('panelHidden')
  }

  dispose(): void {
    if (this.destroyed) return
    this.destroyed = true
    window.removeEventListener('message', this.onMessage)
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    this.onClose()
  }

  private onIframeLoad = (): void => {
    this.broadcast('composeReady')
  }

  private onMessage = (e: MessageEvent): void => {
    if (e.origin !== this.iframeOrigin) {
      // A bridge message from a different origin shouldn't happen; surface it for diagnosis.
      if (isBridgeMessage(e.data)) {
        console.warn('[Retyc CB] dropping bridge message: origin', e.origin, '!=', this.iframeOrigin)
      }
      return
    }
    if (e.source !== this.iframe.contentWindow) return
    if (!isBridgeMessage(e.data)) return
    if (e.data.kind !== 'req') return

    void this.handleRequest(e.data)
  }

  private async handleRequest(req: Req): Promise<void> {
    try {
      const result = await this.dispatch(req)
      this.respond({tag: BRIDGE_TAG, kind: 'res', id: req.id, ok: true, result})
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.respond({tag: BRIDGE_TAG, kind: 'res', id: req.id, ok: false, error: message})
    }
  }

  private dispatch(req: Req): unknown {
    switch (req.op) {
      case 'getRecipients':
        return this.readRecipients()
      case 'setToRecipients':
        return this.setToRecipients(req.payload as string[])
      case 'getBodyHtml':
        return this.requireCompose().getHTMLContent()
      case 'insertBodyHtml':
        return this.insertBodyHtml(req.payload as InsertBodyHtmlPayload)
      case 'getCurrentUserEmail':
        return this.getCurrentUserEmail()
      case 'getLocale':
        return this.getLocale()
      case 'closeIframe':
        return this.closeIframe()
      case 'setContentHeight':
        return this.setContentHeight(req.payload as { height: number })
      case 'openSettingsPanel':
        return this.openSettingsPanel()
      case 'setBusy':
        return this.setBusy(req.payload as { busy: boolean })
      default: {
        // Exhaustiveness guard: a new ReqKind without a case here is a compile error.
        const _exhaustive: never = req.op
        throw new Error(`Unknown bridge op: ${String(_exhaustive)}`)
      }
    }
  }

  private setBusy(payload: { busy: boolean }): void {
    if (this.onBusyChange && typeof payload?.busy === 'boolean') {
      this.onBusyChange(payload.busy)
    }
  }

  private requireCompose(): ComposeView {
    if (!this.composeView) throw new Error('Compose not available in this panel.')
    return this.composeView
  }

  private setContentHeight(payload: { height: number }): void {
    if (this.onContentHeight && typeof payload?.height === 'number') {
      this.onContentHeight(payload.height)
    }
  }

  private readRecipients(): RecipientList {
    const cv = this.requireCompose()
    // InboxSDK 2.x getXxxRecipients() are synchronous and return ContactNameOptional[]. Some
    // entries may carry an empty emailAddress when the user is mid-typing — filter them out.
    const norm = (rs: { emailAddress: string }[]): string[] =>
      rs.map(r => (r?.emailAddress ?? '').trim()).filter(Boolean)
    return {
      to: norm(cv.getToRecipients()),
      cc: norm(cv.getCcRecipients()),
      bcc: norm(cv.getBccRecipients()),
    }
  }

  private setToRecipients(emails: string[]): void {
    if (!Array.isArray(emails)) throw new Error('setToRecipients: payload must be string[]')
    this.requireCompose().setToRecipients(emails)
  }

  private insertBodyHtml(payload: InsertBodyHtmlPayload): void {
    const bodyEl = this.requireCompose().getBodyElement()
    if (!bodyEl) throw new Error('Compose body element not available.')
    insertHtmlIntoBody(bodyEl, payload.html, payload.idempotencyKey)
  }

  private getCurrentUserEmail(): string {
    const from = this.composeView?.getFromContact?.()
    if (from?.emailAddress) return from.emailAddress
    const meLink = document.querySelector<HTMLLinkElement>('link[rel="me"][href^="mailto:"]')
    if (meLink) return meLink.href.replace(/^mailto:/, '')
    return ''
  }

  private getLocale(): string {
    return document.documentElement.lang || navigator.language || 'en'
  }

  private closeIframe(): void {
    if (this.onCloseRequest) {
      this.onCloseRequest()
    } else {
      this.iframe.style.display = 'none'
    }
  }

  private openSettingsPanel(): void {
    this.onOpenSettingsPanel?.()
  }

  private respond(res: Res): void {
    if (!this.iframe.contentWindow) return
    this.iframe.contentWindow.postMessage(res, this.iframeOrigin)
  }

  private broadcast(event: EventKind, payload?: unknown): void {
    if (!this.iframe.contentWindow) return
    const evt: Evt = {tag: BRIDGE_TAG, kind: 'evt', event, payload}
    this.iframe.contentWindow.postMessage(evt, this.iframeOrigin)
  }

  private startRecipientsPoll(): void {
    if (!this.composeView) return
    try {
      this.lastRecipientsKey = recipientsKey(this.readRecipients())
    } catch { /* compose not yet ready */
    }
    this.pollTimer = setInterval(() => {
      if (this.destroyed) return
      let snapshot: RecipientList
      try {
        snapshot = this.readRecipients()
      } catch {
        return
      }
      const key = recipientsKey(snapshot)
      if (key !== this.lastRecipientsKey) {
        this.lastRecipientsKey = key
        this.broadcast('recipientsChanged', snapshot)
      }
    }, RECIPIENTS_POLL_MS)
  }
}

function recipientsKey(r: RecipientList): string {
  return JSON.stringify([r.to, r.cc, r.bcc])
}
