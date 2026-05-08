import {ref, computed, inject, onUnmounted, type InjectionKey} from 'vue'
import {getSDK, invalidateSDK} from '../shared/sdk-factory'
import {onAuthChanged} from '../shared/auth-sync'

export type AuthState = 'loading' | 'unauthenticated' | 'device-flow' | 'authenticated'

export type Auth = ReturnType<typeof useAuth>

export const authInjectionKey: InjectionKey<Auth> = Symbol('retyc:auth')

export function injectAuth(): Auth {
  const auth = inject(authInjectionKey)
  if (!auth) throw new Error('useAuth must be provided at the app root')
  return auth
}

interface CachedUser {
  fullName: string | null
  email: string
}

export function useAuth() {
  const authState = ref<AuthState>('loading')
  const userFullName = ref<string | null>(null)
  const userEmail = ref('')
  const tokenExpiry = ref<number | null>(null)
  const deviceFlowUrl = ref('')
  const userCode = ref('')

  const isAuthenticated = computed(() => authState.value === 'authenticated')

  let cachedUserInfo: CachedUser | null = null
  let pollTimer: ReturnType<typeof setTimeout> | null = null

  function stopPolling() {
    if (pollTimer !== null) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
  }

  async function readAuthSnapshot(): Promise<boolean> {
    try {
      const sdk = await getSDK()
      const tokens = await sdk.auth.getTokens()
      if (!tokens) return false

      if (tokens.expiresAt - Math.floor(Date.now() / 1000) <= 60) {
        await sdk.auth.refresh()
      }

      if (!cachedUserInfo) {
        const me = await sdk.user.getMe()
        cachedUserInfo = {fullName: me.user.full_name, email: me.user.email}
      }
      userFullName.value = cachedUserInfo.fullName
      userEmail.value = cachedUserInfo.email

      const current = await sdk.auth.getTokens()
      tokenExpiry.value = current?.expiresAt ?? tokens.expiresAt
      return true
    } catch {
      return false
    }
  }

  async function loadStatus(): Promise<boolean> {
    authState.value = 'loading'
    const ok = await readAuthSnapshot()
    authState.value = ok ? 'authenticated' : 'unauthenticated'
    return ok
  }

  async function startLogin(onAuthenticated?: () => void | Promise<void>) {
    invalidateSDK()
    cachedUserInfo = null
    authState.value = 'device-flow'
    try {
      const sdk = await getSDK()
      const flow = await sdk.auth.startDeviceFlow()
      void flow.poll().catch((e: unknown) => console.error('[Retyc] poll error', e))
      deviceFlowUrl.value = flow.verificationUriComplete ?? flow.verificationUri
      userCode.value = flow.userCode

      const deadline = Date.now() + flow.expiresIn * 1000
      const tick = async (): Promise<void> => {
        if (pollTimer === null) return
        if (Date.now() > deadline) {
          stopPolling()
          authState.value = 'unauthenticated'
          return
        }
        const ok = await readAuthSnapshot()
        if (ok) {
          if (pollTimer === null) return
          stopPolling()
          authState.value = 'authenticated'
          if (onAuthenticated) await onAuthenticated()
        } else {
          pollTimer = setTimeout(() => {
            void tick()
          }, 3000)
        }
      }
      pollTimer = setTimeout(() => {
        void tick()
      }, 3000)
    } catch (e) {
      console.error('[Retyc] login failed', e)
      authState.value = 'unauthenticated'
    }
  }

  function cancelLogin() {
    stopPolling()
    deviceFlowUrl.value = ''
    userCode.value = ''
    authState.value = 'unauthenticated'
  }

  async function logout() {
    stopPolling()
    cachedUserInfo = null
    try {
      const sdk = await getSDK()
      await sdk.auth.logout()
    } catch { /* best effort */
    }
    invalidateSDK()
    authState.value = 'unauthenticated'
  }

  async function refreshToken() {
    try {
      const sdk = await getSDK()
      const tokens = await sdk.auth.refresh()
      tokenExpiry.value = tokens.expiresAt
    } catch (e) {
      console.error('[Retyc] refresh failed', e)
    }
  }

  function forceLogout() {
    cachedUserInfo = null
    invalidateSDK()
    authState.value = 'unauthenticated'
  }

  // Cross-iframe sync: when another compose iframe logs in/out, our local `authState` ref
  // would otherwise stay stale. We subscribe to the auth-sync bus, which abstracts away the
  // detail of how the change is detected (currently `browser.storage.onChanged`).
  const unsubscribeAuthSync = onAuthChanged(event => {
    if (event.kind === 'cleared' && authState.value === 'authenticated') {
      forceLogout()
    } else if (event.kind === 'updated' && authState.value === 'unauthenticated') {
      void loadStatus()
    }
  })
  onUnmounted(unsubscribeAuthSync)

  return {
    authState,
    userFullName,
    userEmail,
    tokenExpiry,
    deviceFlowUrl,
    userCode,
    isAuthenticated,
    loadStatus,
    startLogin,
    cancelLogin,
    logout,
    refreshToken,
    forceLogout,
  }
}
