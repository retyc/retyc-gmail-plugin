import type {TokenSet, TokenStore} from '@retyc/sdk'
import browser from 'webextension-polyfill'
import {STORAGE_KEY_TOKENS} from './constants'

// Persists OIDC tokens in browser.storage.local (extension-scoped, not synced — Chrome's
// storage.sync has a 100 KB quota that refresh tokens routinely exceed). Identical contract to
// the Outlook OfficeRoamingTokenStore so the rest of the SDK integration is unchanged.
export class BrowserStorageTokenStore implements TokenStore {
  async get(): Promise<TokenSet | null> {
    const result = await browser.storage.local.get(STORAGE_KEY_TOKENS)
    const raw = result[STORAGE_KEY_TOKENS]
    if (typeof raw !== 'string' || !raw) return null
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      if (
        typeof parsed.accessToken !== 'string' ||
        typeof parsed.refreshToken !== 'string' ||
        typeof parsed.expiresAt !== 'number' ||
        typeof parsed.tokenType !== 'string'
      ) {
        await this.clear()
        return null
      }
      return parsed as unknown as TokenSet
    } catch {
      await this.clear()
      return null
    }
  }

  async set(tokens: TokenSet): Promise<void> {
    await browser.storage.local.set({[STORAGE_KEY_TOKENS]: JSON.stringify(tokens)})
  }

  async clear(): Promise<void> {
    await browser.storage.local.remove(STORAGE_KEY_TOKENS)
  }
}
