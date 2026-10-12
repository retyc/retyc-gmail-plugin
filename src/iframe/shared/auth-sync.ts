import browser from 'webextension-polyfill'
import {getTokenStorageKey} from './account'

// Cross-iframe auth state synchronization.
//
// Each Gmail compose opens its own iframe with its own Vue app and its own `useAuth()`
// instance. The OIDC tokens live in `browser.storage.local`, which is the single source of
// truth shared across all iframes of this extension. They are keyed per Gmail account, and we
// only react to changes of the current account's key: a login/logout on /mail/u/1 must not
// affect the iframes of /mail/u/0. When iframe A logs out, the storage
// entry is cleared — but iframe B's `authState` ref is local and would still report
// `authenticated` until we tell it otherwise.
//
// This module owns the "how do we know the storage changed" detail and exposes a small,
// transport-agnostic API to the rest of the app:
//
//   onAuthChanged(cb) → unsubscribe
//   cb receives { kind: 'cleared' } | { kind: 'updated' }
//
// `useAuth` consumes this bus without knowing about `browser.storage` or the storage key.
// If we later want to add another sync source (a manual BroadcastChannel, an SDK-emitted
// signal on a failed refresh, …), it plugs in here without touching the auth composable.

export type AuthSyncEvent =
  | {kind: 'cleared'}   // tokens were removed (logout in another iframe, refresh failure, …)
  | {kind: 'updated'}   // tokens appeared or changed (login in another iframe, refresh, …)

type Listener = (event: AuthSyncEvent) => void

const listeners = new Set<Listener>()
let attached = false

function emit(event: AuthSyncEvent): void {
  // Snapshot to allow listeners to unsubscribe themselves during dispatch.
  for (const listener of [...listeners]) {
    try {
      listener(event)
    } catch (e) {
      console.error('[Retyc] auth-sync listener threw', e)
    }
  }
}

function handleStorageChanged(
  changes: Record<string, browser.Storage.StorageChange>,
  area: string,
): void {
  const key = getTokenStorageKey()
  if (area !== 'local' || !key || !(key in changes)) return
  const {newValue} = changes[key]
  emit({kind: newValue ? 'updated' : 'cleared'})
}

function ensureAttached(): void {
  if (attached) return
  browser.storage.onChanged.addListener(handleStorageChanged)
  attached = true
}

export function onAuthChanged(listener: Listener): () => void {
  ensureAttached()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
