import {ref, computed, onMounted, onUnmounted, watch} from 'vue'
import {getSDK} from '../shared/sdk-factory'
import {performRetycTransfer, isAuthError} from '../shared/upload'
import type {UploadProgress} from '../shared/upload'
import {getBridge} from '../../shared/bridge/client'
import type {FilesDroppedPayload, RecipientList} from '../../shared/bridge/protocol'
import {t, getLocale} from '../i18n'

// Stepper-style flow:
//   files     — pick / drop files, choose expiry. "Next" goes to review.
//   review    — confirm a snapshot of Gmail recipients (live-updated if they change in Gmail
//               while we're on this step). Toggle / fill passphrase. "Encrypt & upload" starts
//               the actual transfer; "Back" returns to files (recipients are no longer locked).
//   uploading — progress.
//   done      — link inserted, success copy, "Prepare another" returns to files.
//   error     — error copy, retry returns to review (where the validation lives).
export type Step = 'files' | 'review' | 'uploading' | 'done' | 'error'

export interface UploadStatus {
  phase: 'reading' | 'uploading'
  fileName: string
  fileIndex: number  // 1-based for display
  totalFiles: number
  uploadedBytes: number
  totalBytes: number
  ratio: number  // 0..1
}

export interface ExpiryOption {
  label: string
  value: number | null
}

const EXPIRY_VALUES = [
  {key: 'hour1', value: 3600},
  {key: 'hours12', value: 43200},
  {key: 'day1', value: 86400},
  {key: 'days3', value: 259200},
  {key: 'days7', value: 604800},
  {key: 'days30', value: 2592000},
  {key: 'days90', value: 7776000},
  {key: 'year1', value: 31536000},
] as const

function buildExpiryOptions(): ExpiryOption[] {
  return EXPIRY_VALUES.map(({key, value}) => ({
    label: t(`transfer.expiryOptions.${key}`),
    value,
  }))
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email)
}

export interface UseTransferOptions {
  isAuthenticated: () => boolean
  onAuthError: () => void
  currentUserEmail: () => string
}

export function useTransfer(options: UseTransferOptions) {
  const bridge = getBridge()

  const step = ref<Step>('files')
  const composeAvailable = ref(true)  // iframe only opens when there's an active compose
  const selectedFiles = ref<File[]>([])
  // Snapshot of Gmail recipients, refreshed explicitly on every entry to the review step (and
  // kept live by the recipientsChanged event from there on). Read at upload time.
  const recipients = ref<string[]>([])
  const recipientsLoading = ref(false)
  const recipientsError = ref('')
  const passphrase = ref('')
  const passphraseError = ref('')
  // Set to true when the backend rejects a no-passphrase upload because at least one recipient
  // doesn't have a Retyc account (HTTP 409). The UI then forces the passphrase toggle on.
  const passphraseRequired = ref(false)
  const usePassphrase = ref(false)
  const expirySeconds = ref<number | null>(604800)
  const expiryOptions = ref<ExpiryOption[]>([{label: t('transfer.expiryOptions.days7'), value: 604800}])
  const maxShareSize = ref<number | null>(null)
  const uploadStatus = ref<UploadStatus | null>(null)
  const transferError = ref('')

  const isComposeAvailable = computed(() => composeAvailable.value && options.isAuthenticated())

  const validRecipients = computed(() =>
    recipients.value.filter(email => isValidEmail(email)),
  )

  const hasRecipients = computed(() => validRecipients.value.length > 0)
  // No recipients in Gmail → passphrase is the only way to protect the transfer; force it.
  const passphraseLocked = computed(() => !hasRecipients.value || passphraseRequired.value)
  const passphraseEnabled = computed(() => usePassphrase.value || passphraseLocked.value)

  const canGoToReview = computed(() => selectedFiles.value.length > 0)

  const canEncrypt = computed(() => {
    if (selectedFiles.value.length === 0) return false
    if (passphraseEnabled.value) {
      // Either user-toggled or forced — require ≥ 8 chars.
      if (passphrase.value.trim().length < 8) return false
    } else {
      // Without a passphrase we need at least one recipient.
      if (!hasRecipients.value) return false
    }
    return true
  })

  async function loadCapabilities() {
    const all = buildExpiryOptions()
    try {
      const sdk = await getSDK()
      const caps = await sdk.user.getUploadCapabilities()
      const max = caps.max_share_expiration_time
      expiryOptions.value = max == null
        ? all
        : all.filter(o => o.value !== null && o.value <= max)
      maxShareSize.value = caps.max_share_size
    } catch {
      expiryOptions.value = all.filter(o => o.value !== null && o.value <= 604800)
    }
    if (!expiryOptions.value.find(o => o.value === expirySeconds.value)) {
      expirySeconds.value = expiryOptions.value[expiryOptions.value.length - 1]?.value ?? 604800
    }
  }

  function isSelf(email: string): boolean {
    const self = options.currentUserEmail().toLowerCase()
    return self.length > 0 && email.toLowerCase() === self
  }

  // Read recipients from Gmail and drop the user's own Retyc account email — sending to oneself
  // is rarely intentional (and the SDK would reject it anyway as a self-encryption).
  async function readRecipientsSnapshot(): Promise<void> {
    recipientsLoading.value = true
    recipientsError.value = ''
    try {
      const r = await bridge.getRecipients()
      const merged = [...r.to, ...r.cc, ...r.bcc]
        .map(e => e.trim().toLowerCase())
        .filter(e => e.length > 0 && !isSelf(e))
      recipients.value = [...new Set(merged)]
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[Retyc] readRecipientsSnapshot failed:', msg)
      recipientsError.value = msg
      recipients.value = []
    } finally {
      recipientsLoading.value = false
    }
  }

  async function refreshComposeIfNeeded() {
    if (!options.isAuthenticated() || !composeAvailable.value) {
      step.value = 'files'
      return
    }
    void loadCapabilities()
    await readRecipientsSnapshot()
  }

  function addFiles(files: FileList | File[]) {
    for (const f of Array.from(files)) {
      const dup = selectedFiles.value.some(
        s => s.name === f.name && s.size === f.size && s.lastModified === f.lastModified,
      )
      if (!dup) selectedFiles.value.push(f)
    }
  }

  function removeFile(index: number) {
    selectedFiles.value.splice(index, 1)
  }

  function clearFiles() {
    selectedFiles.value = []
  }

  function gotoFiles() {
    passphraseError.value = ''
    step.value = 'files'
  }

  async function gotoReview() {
    if (!canGoToReview.value) return
    passphraseError.value = ''
    step.value = 'review'
    // Re-read the recipients at the moment the user enters review so the snapshot is current.
    // Awaited so the UI's loading state (recipientsLoading) is meaningful — if the user hits
    // "Encrypt & upload" while we're still fetching, the encryption will use the latest snapshot.
    await readRecipientsSnapshot()
  }

  // Manual refresh button in the review step.
  async function refreshRecipients() {
    await readRecipientsSnapshot()
  }

  function resetTransferState() {
    selectedFiles.value = []
    passphrase.value = ''
    passphraseError.value = ''
    passphraseRequired.value = false
    usePassphrase.value = false
    step.value = 'files'
  }

  async function encryptAndUpload() {
    if (!composeAvailable.value) {
      transferError.value = t('transfer.errors.noActiveCompose')
      step.value = 'error'
      return
    }
    if (!selectedFiles.value.length) {
      step.value = 'files'
      return
    }

    const passRaw = passphrase.value.trim()
    const passphraseUsed = passphraseEnabled.value ? passRaw : ''
    if (passphraseEnabled.value && passphraseUsed.length < 8) {
      passphraseError.value = t('transfer.errors.passphraseTooShort')
      return
    }
    if (!hasRecipients.value && !passphraseUsed) {
      passphraseError.value = t('transfer.errors.addRecipientOrPass')
      return
    }

    passphraseError.value = ''
    step.value = 'uploading'
    uploadStatus.value = null
    const filesToUpload = [...selectedFiles.value]
    // Snapshot the recipients at the exact upload moment so the encrypted payload matches what
    // we're about to insert into the compose body.
    const recipientsSnapshot = [...validRecipients.value]

    try {
      const sdk = await getSDK()
      await performRetycTransfer(bridge, sdk, filesToUpload, {
        recipients: recipientsSnapshot,
        expires: expirySeconds.value,
        passphrase: passphraseUsed || undefined,
        onProgress: (p: UploadProgress) => {
          uploadStatus.value = {
            phase: p.phase,
            fileName: p.fileName,
            fileIndex: p.fileIndex + 1,
            totalFiles: p.totalFiles,
            uploadedBytes: p.uploadedBytes,
            totalBytes: p.totalBytes,
            ratio: p.ratio,
          }
        },
      })
      clearFiles()
      passphrase.value = ''
      step.value = 'done'
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/\b409\b/.test(msg)) {
        // Backend says: at least one recipient lacks a Retyc account, so we need a passphrase.
        // Bring the user back to review with the passphrase enforced.
        step.value = 'review'
        passphraseRequired.value = true
        usePassphrase.value = true
        passphraseError.value = t('transfer.errors.passphraseRequired409')
        return
      }
      if (isAuthError(msg)) {
        try {
          await (await getSDK()).auth.logout()
        } catch { /* best effort */
        }
        options.onAuthError()
        return
      }
      transferError.value = msg
      step.value = 'error'
    }
  }

  function retry() {
    transferError.value = ''
    step.value = canGoToReview.value ? 'review' : 'files'
  }

  let unsubRecipients: (() => void) | null = null
  let unsubClosed: (() => void) | null = null
  let unsubFilesDropped: (() => void) | null = null
  let unsubPanelHidden: (() => void) | null = null

  function setupBridgeHandlers() {
    unsubRecipients = bridge.on('recipientsChanged', (payload) => {
      const snap = payload as RecipientList | undefined
      if (!snap) return
      const merged = [...snap.to, ...snap.cc, ...snap.bcc]
        .map(e => e.trim().toLowerCase())
        .filter(e => e.length > 0 && !isSelf(e))
      recipients.value = [...new Set(merged)]
    })
    unsubClosed = bridge.on('composeClosed', () => {
      composeAvailable.value = false
      resetTransferState()
    })
    unsubFilesDropped = bridge.on('filesDropped', (payload) => {
      const p = payload as FilesDroppedPayload | undefined
      if (!p?.files?.length) return
      if (step.value !== 'files') return  // only accept new files in step 1
      addFiles(p.files)
    })
    // When the panel is closed (X / backdrop / Escape / in-iframe close), wipe terminal-state
    // UI so the next open lands on a fresh step 1. We don't reset mid-flow (files / review)
    // to preserve the user's selection if they close by mistake.
    unsubPanelHidden = bridge.on('panelHidden', () => {
      if (step.value === 'done' || step.value === 'error') {
        resetTransferState()
        return
      }
      // Always clear the 409-forced passphrase lock so the next open does not inherit it.
      passphraseRequired.value = false
      passphraseError.value = ''
      usePassphrase.value = false
    })
  }

  function teardownBridgeHandlers() {
    unsubRecipients?.();
    unsubRecipients = null
    unsubClosed?.();
    unsubClosed = null
    unsubFilesDropped?.();
    unsubFilesDropped = null
    unsubPanelHidden?.();
    unsubPanelHidden = null
  }

  // Refresh expiry option labels when locale changes.
  watch(() => getLocale(), () => {
    if (expiryOptions.value.length === 0) return
    const allowedValues = new Set(expiryOptions.value.map(o => o.value))
    expiryOptions.value = buildExpiryOptions().filter(o => allowedValues.has(o.value))
  })

  // Tell the host to lock the panel while uploading. Released as soon as we leave the uploading
  // step (success → done, failure → error / review on 409 / files on auth error).
  watch(step, (next, prev) => {
    if (next === 'uploading' && prev !== 'uploading') void bridge.setBusy(true)
    else if (prev === 'uploading' && next !== 'uploading') void bridge.setBusy(false)
  })

  onMounted(() => {
    setupBridgeHandlers()
  })

  onUnmounted(() => {
    teardownBridgeHandlers()
  })

  return {
    step,
    selectedFiles,
    recipients,
    recipientsLoading,
    recipientsError,
    refreshRecipients,
    passphrase,
    passphraseError,
    passphraseRequired,
    usePassphrase,
    expirySeconds,
    expiryOptions,
    maxShareSize,
    uploadStatus,
    transferError,
    isComposeAvailable,
    hasRecipients,
    passphraseLocked,
    passphraseEnabled,
    canGoToReview,
    canEncrypt,
    addFiles,
    removeFile,
    clearFiles,
    gotoFiles,
    gotoReview,
    refreshComposeIfNeeded,
    encryptAndUpload,
    retry,
  }
}
