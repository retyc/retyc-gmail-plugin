// Vue I18n singleton.
//
// Exported as a module-level instance so non-component code (composables, plain TS modules) can
// translate via `t(...)` without sitting inside a component setup. Vue components keep using
// `useI18n()` from 'vue-i18n' as usual.

import {createI18n, type Composer} from 'vue-i18n'
import en from './locales/en'
import fr from './locales/fr'
import type {BridgeClient} from '../shared/bridge/client'

export type AppLocale = 'en' | 'fr'

export const SUPPORTED_LOCALES: AppLocale[] = ['en', 'fr']
export const DEFAULT_LOCALE: AppLocale = 'en'
export const LOCALE_STORAGE_KEY = 'retyc:locale'

function normalize(raw: string | null | undefined): AppLocale | null {
  if (!raw) return null
  const lower = raw.toLowerCase()
  if (lower.startsWith('fr')) return 'fr'
  if (lower.startsWith('en')) return 'en'
  return null
}

function readPersistedLocale(): AppLocale | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return normalize(window.localStorage.getItem(LOCALE_STORAGE_KEY))
  } catch {
    return null
  }
}

// Detection priority: persisted user choice → Gmail tab `<html lang>` (via bridge) → navigator
// language → default. The bridge query is async, so this returns a Promise — the iframe bootstrap
// awaits it before mounting.
export async function detectInitialLocale(bridge: BridgeClient): Promise<AppLocale> {
  const persisted = readPersistedLocale()
  if (persisted) return persisted

  try {
    const fromGmail = normalize(await bridge.getLocale())
    if (fromGmail) return fromGmail
  } catch {
    /* bridge unavailable — fall back */
  }

  if (typeof navigator !== 'undefined') {
    const fromNavigator = normalize(navigator.language)
    if (fromNavigator) return fromNavigator
  }

  return DEFAULT_LOCALE
}

export const i18n = createI18n({
  legacy: false,
  locale: DEFAULT_LOCALE,
  fallbackLocale: DEFAULT_LOCALE,
  messages: {en, fr} satisfies { en: typeof en; fr: typeof fr },
})

// vue-i18n types i18n.global as unknown in composition mode without legacy generics.
// The double cast is the documented workaround: github.com/intlify/vue-i18n/issues/1535
const composer = i18n.global as unknown as Composer

export function setLocale(next: AppLocale): void {
  composer.locale.value = next
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next)
    }
  } catch {
    /* ignore quota / unavailability */
  }
}

export function getLocale(): AppLocale {
  const v = composer.locale.value
  return v === 'fr' ? 'fr' : 'en'
}

// Translate from outside a Vue component (composables, plain modules).
export const t = composer.t.bind(composer)
