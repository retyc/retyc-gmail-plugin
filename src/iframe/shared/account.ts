import {STORAGE_KEY_TOKENS_PREFIX} from './constants'

// Per-Gmail-account namespace for the token store.
//
// Several Google accounts can be open in one browser profile (/mail/u/0, /mail/u/1, …) and they
// all share this extension's `browser.storage.local`. Each one gets its own storage key, derived
// from the account email reported by the content-script, so a Retyc login on one Gmail account
// is not visible from another.
//
// The email comes from the Gmail tab through the bridge: it is a namespace, NOT a proof of
// identity. Do not use it for anything else. When it is missing or malformed there is no key at
// all (never a shared fallback one) and the user is treated as logged out.

let _storageKey: string | null = null

export function setAccountEmail(raw: unknown): void {
  const email = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  _storageKey = /^[^\s@]+@[^\s@]+$/.test(email) ? STORAGE_KEY_TOKENS_PREFIX + email : null
}

export function getTokenStorageKey(): string | null {
  return _storageKey
}
