import type {RetycSDK} from '@retyc/sdk'
import {API_URL} from './constants'
import {getTokenStorageKey} from './account'

let _sdk: RetycSDK | null = null

export async function getSDK(): Promise<RetycSDK> {
  if (_sdk) return _sdk
  // token-store imports SDK values, so it is loaded lazily alongside the SDK chunk.
  const [{RetycSDK}, {BrowserStorageTokenStore}] = await Promise.all([
    import('@retyc/sdk'),
    import('./token-store'),
  ])
  // Built here rather than at module load: the account key is only known after bootstrap.
  const tokenStore = new BrowserStorageTokenStore(getTokenStorageKey())
  const sdk = new RetycSDK({apiUrl: API_URL, tokenStore})
  await sdk.preload()
  _sdk = sdk
  return _sdk
}

export function invalidateSDK(): void {
  _sdk = null
}
