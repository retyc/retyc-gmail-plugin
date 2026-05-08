<script setup lang="ts">
import {useI18n} from 'vue-i18n'
import {injectAuth} from '../composables/useAuth'
import RetycSpinner from '@iframe/components/RetycSpinner.vue'
import RetycLogo from "@iframe/components/RetycLogo.vue";

const auth = injectAuth()
const {t} = useI18n()

async function onLogin() {
  await auth.startLogin()
}
</script>

<template>
  <div class="flex flex-col gap-5 p-6">

    <div class="flex flex-col items-center gap-2 text-center">
      <RetycLogo/>
      <p class="text-sm text-neutral-400">{{ t('app.tagline') }}</p>
    </div>

    <div v-if="auth.authState.value === 'loading'" class="flex justify-center py-8">
      <RetycSpinner class="w-12 h-12"/>
    </div>

    <div v-else-if="auth.authState.value === 'unauthenticated'" class="flex flex-col items-center gap-4">
      <UButton id="btn-login" size="lg" color="primary" icon="i-lucide-log-in" @click="onLogin">
        {{ t('login.button') }}
      </UButton>
      <USeparator/>
      <p class="text-sm text-neutral-500 text-center">
        {{ t('login.newToRetyc') }}
        <UButton to="https://retyc.com/" external target="_blank" variant="link" color="secondary" size="sm">
          {{ t('login.signUp') }}
        </UButton>
      </p>
    </div>

    <div v-else-if="auth.authState.value === 'device-flow'" class="flex flex-col items-center gap-4">
      <USeparator/>
      <p class="text-sm text-neutral-500">{{ t('login.deviceFlowIntro') }}</p>
      <UButton
          :to="auth.deviceFlowUrl.value" external target="_blank"
          size="lg" trailing-icon="i-lucide-external-link"
      >
        {{ t('login.openSignInPage') }}
      </UButton>

      <p class="text-sm text-neutral-500 flex items-center gap-2">
        {{ t('login.waiting') }}
        <UIcon name="i-lucide-loader-circle" class="animate-spin size-7 text-primary"/>
      </p>
      <UButton color="neutral" variant="subtle" size="lg" @click="auth.cancelLogin">{{ t('login.cancel') }}</UButton>
    </div>
  </div>
</template>
