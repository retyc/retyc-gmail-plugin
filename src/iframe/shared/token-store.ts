import {isTokenSet, type TokenSet, type TokenStore} from '@retyc/sdk'
import browser from 'webextension-polyfill'
import {STORAGE_KEY_TOKENS_LEGACY} from './constants'

const MIGRATION_LOCK = 'retyc-token-migration'
const REFRESH_LOCK_PREFIX = 'retyc-token-refresh:'

// Persists OIDC tokens in browser.storage.local (extension-scoped, not synced — Chrome's
// storage.sync has a 100 KB quota that refresh tokens routinely exceed). Identical contract to
// the Outlook OfficeRoamingTokenStore so the rest of the SDK integration is unchanged.
//
// One entry per Gmail account: `key` comes from `getTokenStorageKey()` (see account.ts). A null
// key means the account is unknown: the store then reads as empty and refuses to persist, so
// tokens never land under a key shared between accounts.
export class BrowserStorageTokenStore implements TokenStore {
  constructor(private readonly key: string | null) {}

  async get(): Promise<TokenSet | null> {
    if (!this.key) return null
    const result = await browser.storage.local.get(this.key)
    const raw = result[this.key] ?? await this.migrateLegacy(this.key)
    if (typeof raw !== 'string' || !raw) return null
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!isTokenSet(parsed)) {
        await this.clear()
        return null
      }
      return parsed
    } catch {
      await this.clear()
      return null
    }
  }

  async set(tokens: TokenSet): Promise<void> {
    if (!this.key) throw new Error('Gmail account unknown: refusing to persist Retyc tokens.')
    await browser.storage.local.set({[this.key]: JSON.stringify(tokens)})
  }

  async clear(): Promise<void> {
    if (!this.key) return
    await browser.storage.local.remove(this.key)
  }

  // Every compose has its own iframe and SDK instance, all sharing this account's entry. The SDK
  // runs token refreshes inside this lock so only one of them spends the refresh token; the
  // others then pick up the refreshed TokenSet from storage. One lock per account.
  withLock<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.key || !('locks' in navigator)) return fn()
    return navigator.locks.request(REFRESH_LOCK_PREFIX + this.key, fn)
  }

  // Versions before per-account isolation kept a single TokenSet under STORAGE_KEY_TOKENS_LEGACY.
  // The first account that opens after the update adopts it (so the user isn't forced to log in
  // again) and the legacy entry is removed. The lock keeps two accounts opening at the same time
  // from both adopting it.
  private async migrateLegacy(key: string): Promise<unknown> {
    const migrate = async (): Promise<unknown> => {
      const result = await browser.storage.local.get([key, STORAGE_KEY_TOKENS_LEGACY])
      if (result[key] !== undefined) return result[key]
      const legacy = result[STORAGE_KEY_TOKENS_LEGACY]
      if (legacy === undefined) return undefined
      await browser.storage.local.set({[key]: legacy})
      await browser.storage.local.remove(STORAGE_KEY_TOKENS_LEGACY)
      return legacy
    }
    return 'locks' in navigator ? navigator.locks.request(MIGRATION_LOCK, migrate) : migrate()
  }
}
