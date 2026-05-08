// Inserts an HTML snippet into the Gmail compose body, before the user's signature or the
// quoted-reply block when present. Idempotent: previous Retyc snippets sharing the same idempotency
// key are removed first, so the user clicking "Encrypt & insert" twice won't duplicate the block.

import DOMPurify from 'dompurify'

// Strict allow-list matching exactly what buildLinkSnippet (upload.ts) produces.
// Sanitised on the CS side so the trust boundary is explicit regardless of what the iframe sends.
const PURIFY_CONFIG = {
  ALLOWED_TAGS: ['div', 'br', 'strong', 'a', 'small'],
  ALLOWED_ATTR: ['href', 'style'],
  ALLOWED_URI_REGEXP: /^https:\/\//i,
}

const RETYC_INJECTED_ATTR = 'data-retyc-injected'

// Order matters: we want to land *before* the signature, but if there's no signature we still want
// to land *before* a quoted reply.
const ANCHOR_SELECTORS = [
  'div.gmail_signature',
  'div.gmail_quote',
  'blockquote.gmail_quote',
] as const

export function insertHtmlIntoBody(
  bodyEl: HTMLElement,
  html: string,
  idempotencyKey: string,
): void {
  // Remove any prior Retyc-injected blocks (regardless of key) so re-runs replace cleanly.
  for (const prev of bodyEl.querySelectorAll<HTMLElement>(`[${RETYC_INJECTED_ATTR}]`)) {
    prev.remove()
  }

  const wrapper = document.createElement('div')
  wrapper.setAttribute(RETYC_INJECTED_ATTR, idempotencyKey)
  wrapper.innerHTML = DOMPurify.sanitize(html, PURIFY_CONFIG)

  const anchor = findAnchor(bodyEl)
  if (anchor) {
    anchor.parentElement?.insertBefore(wrapper, anchor)
  } else {
    bodyEl.appendChild(wrapper)
  }
}

function findAnchor(bodyEl: HTMLElement): HTMLElement | null {
  for (const sel of ANCHOR_SELECTORS) {
    const el = bodyEl.querySelector<HTMLElement>(sel)
    if (el) return el
  }
  return null
}
