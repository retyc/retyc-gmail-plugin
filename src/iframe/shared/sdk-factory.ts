import type {RetycSDK} from '@retyc/sdk'
import {BrowserStorageTokenStore} from './token-store'
import {API_URL} from './constants'

let _sdk: RetycSDK | null = null
const _store = new BrowserStorageTokenStore()

export async function getSDK(): Promise<RetycSDK> {
  if (_sdk) return _sdk
  const {RetycSDK} = await import('@retyc/sdk')
  const sdk = new RetycSDK({apiUrl: API_URL, tokenStore: _store})
  await sdk.preload()
  _sdk = sdk
  return _sdk
}

export function invalidateSDK(): void {
  _sdk = null
}
