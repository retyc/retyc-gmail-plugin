<script setup lang="ts">
import {computed, defineAsyncComponent, onMounted, onUnmounted, provide} from 'vue'
import {useI18n} from 'vue-i18n'
import {en as nuxtEn, fr as nuxtFr} from '@nuxt/ui/locale'
import {useAuth, authInjectionKey} from './composables/useAuth'
import {injectMode} from './composables/useMode'
import {getBridge} from '@bridge/client'

const LoginView = defineAsyncComponent(() => import('./views/LoginView.vue'))
const TransferView = defineAsyncComponent(() => import('./views/TransferView.vue'))
const AccountView = defineAsyncComponent(() => import('./views/AccountView.vue'))
const RetycSpinner = defineAsyncComponent(() => import('./components/RetycSpinner.vue'))

const auth = useAuth()
provide(authInjectionKey, auth)

const {locale} = useI18n()
const nuxtLocale = computed(() => (locale.value === 'fr' ? nuxtFr : nuxtEn))

const mode = injectMode()

function closePanel() {
  void getBridge().closeIframe()
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    closePanel()
  }
}

onMounted(async () => {
  document.addEventListener('keydown', onKeyDown)
  await auth.loadStatus()
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <UApp :locale="nuxtLocale">
    <!-- Loading: no px-3, vertically centered -->
    <div
        v-if="auth.authState.value === 'loading'"
        class="flex flex-col items-center justify-center gap-3 py-12"
    >
      <RetycSpinner class="w-10 h-10"/>
    </div>

    <!-- All views: px-3 defined once here -->
    <div v-else class="px-3">
      <template v-if="mode === 'settings'">
        <LoginView v-if="!auth.isAuthenticated.value"/>
        <AccountView v-else/>
      </template>
      <template v-else>
        <LoginView v-if="!auth.isAuthenticated.value"/>
        <TransferView v-else/>
      </template>
    </div>
  </UApp>
</template>
