import {inject, type InjectionKey} from 'vue'

// Two iframe modes:
// - settings : standalone Retyc panel reachable from the Gmail-wide button. Login + account/quota
//              + language. No compose interaction available.
// - compose  : panel attached to a specific compose. File transfer flow only — auth state is
//              shown as a redirect to settings if not logged in.
export type AppMode = 'settings' | 'compose'

export const modeInjectionKey: InjectionKey<AppMode> = Symbol('retyc:mode')

export function readModeFromUrl(): AppMode {
  try {
    const url = new URL(window.location.href)
    const m = url.searchParams.get('mode')
    return m === 'settings' ? 'settings' : 'compose'
  } catch {
    return 'compose'
  }
}

export function injectMode(): AppMode {
  const m = inject(modeInjectionKey)
  if (!m) throw new Error('AppMode must be provided at the app root')
  return m
}
