<script setup lang="ts">
import {computed, onMounted, ref} from 'vue'
import {useI18n} from 'vue-i18n'
import DropZone from '@iframe/components/DropZone.vue'
import RetycSpinner from '@iframe/components/RetycSpinner.vue'
import {injectAuth} from '../composables/useAuth'
import {useTransfer} from '../composables/useTransfer'
import {useDropOverlay} from '../composables/useDropOverlay'
import {getBridge} from '@bridge/client'

const auth = injectAuth()
const {t} = useI18n()

const transfer = useTransfer({
  isAuthenticated: () => auth.isAuthenticated.value,
  currentUserEmail: () => auth.userEmail.value,
  onAuthError: () => {
    auth.forceLogout()
  },
})

const overlay = useDropOverlay({
  isActive: () => transfer.step.value === 'files' && transfer.isComposeAvailable.value,
  onFiles: files => transfer.addFiles(files),
})

const showPass = ref(false)

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

function closePanel() {
  void getBridge().closeIframe()
}

const stepperItems = computed(() => [
  {slot: 'files', title: t('transfer.steps.files'), icon: 'i-lucide-folder'},
  {slot: 'review', title: t('transfer.steps.review'), icon: 'i-lucide-shield-check'},
  {slot: 'uploading', title: t('transfer.steps.uploading'), icon: 'i-lucide-upload'},
  {slot: 'done', title: t('transfer.steps.done'), icon: 'i-lucide-check-circle-2'},
])

const STEP_INDEX: Record<string, number> = {files: 0, review: 1, uploading: 2, error: 2, done: 3}

// Keep the @nuxt/ui Stepper in sync with the typed step state in useTransfer.
// Uploading and done steps are read-only — clicking stepper indicators during those phases is ignored.
const stepIndex = computed({
  get: () => STEP_INDEX[transfer.step.value] ?? 0,
  set: (i: number) => {
    if (transfer.step.value === 'uploading' || transfer.step.value === 'done') return
    if (i === 0) transfer.gotoFiles()
    else if (i === 1 && transfer.canGoToReview.value) void transfer.gotoReview()
  },
})

onMounted(async () => {
  await transfer.refreshComposeIfNeeded()
})
</script>

<template>
  <div class="space-y-4 py-3 relative">

    <div v-if="!transfer.isComposeAvailable.value"
         class="flex flex-col items-center gap-3 py-8 text-center text-neutral-400">
      <UIcon name="i-lucide-mail-plus" class="w-8 h-8"/>
      <p class="text-sm">{{ t('transfer.openComposeHint') }}</p>
    </div>

    <UStepper
        v-else
        v-model="stepIndex"
        :items="stepperItems"
        size="sm"
        color="primary"
        linear
    >
      <!-- STEP 1 — Files -->
      <template #files>
        <div class="flex flex-col gap-3 pt-2">
          <UAlert color="info" variant="soft" icon="i-lucide-info">
            <template #description>
              {{ t('transfer.encryptedNote') }}
              <i18n-t keypath="transfer.notThroughGmail" tag="span">
                <template #neverThrough>
                  <strong>{{ t('transfer.notThroughGmailStrong') }}</strong>
                </template>
              </i18n-t>
            </template>
          </UAlert>

          <UFormField
              :label="t('transfer.filesLabel')"
              :hint="transfer.maxShareSize.value ? t('transfer.maxSize', { size: formatSize(transfer.maxShareSize.value) }) : undefined"
          >
            <DropZone
                :files="transfer.selectedFiles.value"
                @add-files="transfer.addFiles"
                @remove-file="transfer.removeFile"
                @clear-files="transfer.clearFiles"
            />
          </UFormField>

          <UCollapsible class="border border-neutral-200 rounded-lg overflow-hidden">
            <template #default="{ open }">
              <UButton
                  color="neutral"
                  variant="ghost"
                  block
                  :trailing-icon="open ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                  :ui="{ base: 'rounded-none justify-between w-full' }"
              >
                {{ t('transfer.options') }}
              </UButton>
            </template>
            <template #content>
              <div class="flex flex-col gap-4 px-3 pb-3 pt-2">
                <UFormField :label="t('transfer.expiry')">
                  <USelect
                      v-model="transfer.expirySeconds.value"
                      :items="transfer.expiryOptions.value"
                      class="w-full"
                  />
                </UFormField>
              </div>
            </template>
          </UCollapsible>

          <UFieldGroup>
            <UButton color="neutral" variant="subtle" size="lg" icon="i-lucide-x" @click="closePanel">
              {{ t('login.cancel') }}
            </UButton>
            <UButton
                size="lg" color="primary" trailing-icon="i-lucide-arrow-right"
                :disabled="!transfer.canGoToReview.value" @click="transfer.gotoReview"
            >
              {{ t('transfer.next') }}
            </UButton>
          </UFieldGroup>
        </div>
      </template>

      <!-- STEP 2 — Review -->
      <template #review>
        <div class="flex flex-col gap-3 pt-2">
          <p class="text-xs text-neutral-400">{{ t('transfer.reviewIntro') }}</p>

          <UFormField :label="t('transfer.recipientsLabel')">
            <template #hint>
              <UButton
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  icon="i-lucide-refresh-ccw"
                  :loading="transfer.recipientsLoading.value"
                  :title="t('transfer.refreshRecipients')"
                  aria-label="Refresh recipients"
                  @click="transfer.refreshRecipients"
              />
            </template>

            <UAlert
                v-if="transfer.recipientsLoading.value"
                color="neutral" variant="soft"
                :description="t('transfer.loadingRecipients')"
            >
              <template #leading>
                <UIcon name="i-lucide-loader-circle" class="animate-spin shrink-0"/>
              </template>
            </UAlert>
            <UAlert
                v-else-if="transfer.recipientsError.value"
                color="error" variant="soft" icon="i-lucide-circle-x"
                :description="transfer.recipientsError.value"
            />
            <UAlert
                v-else-if="!transfer.hasRecipients.value"
                color="warning" variant="subtle" icon="i-lucide-info"
                :description="t('transfer.noRecipientsBanner')"
            />
            <UCard v-else :ui="{body: 'p-2'}">
              <div class="flex flex-wrap gap-1">
                <UBadge
                    v-for="r in transfer.recipients.value"
                    :key="r"
                    size="sm"
                    color="neutral"
                    variant="subtle"
                >
                  {{ r }}
                </UBadge>
              </div>
            </UCard>
          </UFormField>

          <UFormField
              :label="transfer.passphraseLocked.value ? t('transfer.passphraseLocked') : undefined"
              :error="transfer.passphraseError.value || undefined"
          >
            <USwitch
                v-if="!transfer.passphraseLocked.value"
                v-model="transfer.usePassphrase.value"
                :label="t('transfer.usePassphraseToggle')"
                :description="t('transfer.usePassphraseHint')"
                class="mb-2"
            />
            <UInput
                v-if="transfer.passphraseEnabled.value"
                v-model="transfer.passphrase.value"
                :type="showPass ? 'text' : 'password'"
                :placeholder="t('transfer.passphrasePlaceholder')"
                autocomplete="off"
                class="w-full"
                :ui="{ trailing: 'pr-1' }"
            >
              <template #trailing>
                <UButton
                    color="neutral"
                    variant="ghost"
                    :icon="showPass ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                    size="xs"
                    @click="showPass = !showPass"
                />
              </template>
            </UInput>
          </UFormField>

          <UAlert color="neutral" variant="soft" icon="i-lucide-lock"
                  :description="t('transfer.recipientsLockedWarning')"/>

          <UFieldGroup>
            <UButton
                size="lg" color="neutral" variant="subtle" icon="i-lucide-arrow-left"
                @click="transfer.gotoFiles"
            >
              {{ t('transfer.back') }}
            </UButton>
            <UButton
                size="lg" color="primary" icon="i-lucide-shield-check"
                :disabled="!transfer.canEncrypt.value"
                @click="transfer.encryptAndUpload"
            >
              {{ t('transfer.encryptAndUpload') }}
            </UButton>
          </UFieldGroup>
        </div>
      </template>
      <!-- STEP 3 — Uploading / Error (same stepper slot) -->
      <template #uploading>
        <div v-if="transfer.step.value === 'uploading'" class="flex flex-col items-center gap-3 py-4 pt-2">
          <RetycSpinner class="w-12 h-12"/>
          <div v-if="transfer.uploadStatus.value" class="w-full flex flex-col gap-2">
            <div class="flex justify-between items-baseline gap-2 text-sm text-neutral-700">
              <span class="truncate" :title="transfer.uploadStatus.value.fileName">
                {{
                  transfer.uploadStatus.value.phase === 'reading'
                      ? t('transfer.readingFile', {name: transfer.uploadStatus.value.fileName})
                      : t('transfer.uploadingFile', {name: transfer.uploadStatus.value.fileName})
                }}
              </span>
              <span class="text-xs text-neutral-400 shrink-0">
                {{ transfer.uploadStatus.value.fileIndex }} / {{ transfer.uploadStatus.value.totalFiles }}
              </span>
            </div>
            <UProgress :model-value="Math.round(transfer.uploadStatus.value.ratio * 100)"/>
            <div class="flex justify-between text-xs text-neutral-500">
              <span>{{
                  formatSize(transfer.uploadStatus.value.uploadedBytes)
                }} / {{ formatSize(transfer.uploadStatus.value.totalBytes) }}</span>
              <span>{{ Math.round(transfer.uploadStatus.value.ratio * 100) }}%</span>
            </div>
          </div>
          <p class="text-xs text-neutral-400 text-center">{{ t('transfer.pleaseWait') }}</p>
        </div>
        <div v-else-if="transfer.step.value === 'error'" class="flex flex-col items-center gap-3 py-4 pt-2">
          <UIcon name="i-lucide-x-circle" class="w-12 h-12 text-error-500"/>
          <p class="font-semibold text-error-600">{{ t('transfer.uploadFailed') }}</p>
          <p class="text-sm text-neutral-500 text-center">{{ transfer.transferError.value }}</p>
          <UButton color="neutral" size="xl" block @click="transfer.retry">{{ t('transfer.retry') }}</UButton>
        </div>
      </template>

      <!-- STEP 4 — Done -->
      <template #done>
        <div class="flex flex-col items-center gap-3 py-4 pt-2">
          <UIcon name="i-lucide-check-circle-2" class="w-12 h-12 text-success-500"/>
          <p class="font-semibold text-success-600">{{ t('transfer.transferReady') }}</p>
          <p class="text-sm text-neutral-500 text-center">
            {{ t('transfer.linkAppended') }}<br/>
            <i18n-t keypath="transfer.clickSendInGmail" tag="span">
              <template #sendBold><strong>{{ t('transfer.clickSendInGmailBold') }}</strong></template>
            </i18n-t>
          </p>
          <UButton color="neutral" size="xl" block icon="i-lucide-x" @click="closePanel">{{ t('app.close') }}</UButton>
        </div>
      </template>
    </UStepper>

    <Transition name="fade">
      <div
          v-if="overlay.showOverlay.value"
          class="drop-overlay"
          @dragover.prevent
          @drop="overlay.onOverlayDrop"
      >
        <UIcon name="i-lucide-upload" class="w-10 h-10"/>
        <p>{{ t('transfer.dropFilesHere') }}</p>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.1s;
}

.fade-enter-from, .fade-leave-to {
  opacity: 0;
}

.drop-overlay {
  position: fixed;
  inset: 8px;
  z-index: 500;
  background: color-mix(in srgb, var(--color-primary-50) 94%, transparent);
  border: 2px dashed var(--color-primary-400);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--color-primary-400);
  font-size: 15px;
  font-weight: 600;
  pointer-events: all;
}
</style>
