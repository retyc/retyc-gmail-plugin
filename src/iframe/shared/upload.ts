// Reads the user's selected files (from the dropzone in the iframe), encrypts them client-side via
// @retyc/sdk, and asks the content-script to append a Retyc download link to the compose body.
//
// We deliberately bypass Gmail's attachment system: the bytes go from the user's disk straight
// into the extension iframe's process and are encrypted there. Cleartext attachments never traverse
// Google's servers. The bridge only carries metadata (recipients, body HTML, the small link block).
//
// The HTML insertion is performed by the content-script (which has direct DOM access to the
// compose body via InboxSDK) — this keeps idempotency and signature/quote-anchored placement out
// of the iframe.

import type {RetycSDK, UploadProgress as SdkUploadProgress} from '@retyc/sdk'
import type {BridgeClient} from '@bridge/client'

const MAX_TOTAL_BYTES = 5 * 1024 * 1024 * 1024 // 5 GB hard limit

export type UploadPhase = 'reading' | 'uploading'

export interface UploadProgress {
  phase: UploadPhase
  fileName: string
  fileIndex: number   // 0-based
  totalFiles: number
  uploadedBytes: number
  totalBytes: number
  ratio: number       // 0..1
}

export interface UploadOptions {
  recipients: string[]
  expires: number | null  // seconds; null = never expires
  passphrase?: string
  onProgress?: (p: UploadProgress) => void
}

export interface UploadOutcome {
  transferUrl: string
}

// --- Link rendering ---

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatExpiry(seconds: number): string {
  if (seconds >= 2 * 31536000) return `${Math.round(seconds / 31536000)} years`
  if (seconds >= 31536000) return '1 year'
  if (seconds >= 2 * 2592000) return `${Math.round(seconds / 2592000)} months`
  if (seconds >= 2592000) return '1 month'
  if (seconds >= 2 * 86400) return `${Math.round(seconds / 86400)} days`
  if (seconds >= 86400) return '1 day'
  if (seconds >= 2 * 3600) return `${Math.round(seconds / 3600)} hours`
  if (seconds >= 3600) return '1 hour'
  return `${Math.round(seconds / 60)} minutes`
}

function buildLinkSnippet(transferUrl: string, expires: number | null): string {
  if (new URL(transferUrl).protocol !== 'https:') {
    throw new Error('transferUrl must use https')
  }
  const safe = escapeHtml(transferUrl)
  const expiryLine = expires !== null
    ? ` &nbsp;&bull;&nbsp; This link expires in ${escapeHtml(formatExpiry(expires))}`
    : ''
  return `
<br><br>
<div style="font-family:sans-serif;font-size:14px;color:#444;border:1px solid #e0e0e0;border-radius:6px;padding:14px 16px;display:inline-block;max-width:560px">
  <strong>&#128230; Your files are available via Retyc:</strong><br>
  <a href="${safe}" style="color:#1a3c6e">${safe}</a><br>
  <small style="color:#888">&#128274; End-to-end encrypted${expiryLine}</small>
</div>`
}

// --- Pipeline ---

export async function performRetycTransfer(
  bridge: BridgeClient,
  sdk: RetycSDK,
  files: File[],
  options: UploadOptions,
): Promise<UploadOutcome> {
  if (files.length === 0) {
    throw new Error('No files selected to upload.')
  }
  if (options.recipients.length === 0 && !options.passphrase) {
    throw new Error('Provide at least one recipient or a passphrase.')
  }

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0)
  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new Error(
      `Total file size (${(totalBytes / 1e9).toFixed(1)} GB) exceeds the 5 GB limit.`,
    )
  }

  // Read each file sequentially (rather than in parallel) so we don't hammer the disk + browser
  // memory all at once on a multi-file selection. The byte buffers all end up in memory before
  // the SDK upload starts — that's a tradeoff with the SDK's current API, which expects an
  // array of {name, data, size} up front; revisit once it accepts a stream/iterator.
  const uploadFiles: Array<{ name: string; mimeType: string; data: Uint8Array; size: number }> = []
  for (let idx = 0; idx < files.length; idx++) {
    const file = files[idx]
    options.onProgress?.({
      phase: 'reading',
      fileName: file.name,
      fileIndex: idx,
      totalFiles: files.length,
      uploadedBytes: 0,
      totalBytes,
      ratio: 0,
    })
    const buffer = await file.arrayBuffer()
    uploadFiles.push({
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      data: new Uint8Array(buffer),
      size: buffer.byteLength,
    })
  }

  const result = await sdk.transfers.upload({
    recipients: options.recipients,
    expires: options.expires as unknown as number, // null = never expires; SDK types are conservative but backend accepts it
    files: uploadFiles,
    ...(options.passphrase ? {passphrase: options.passphrase} : {}),
    ...(options.onProgress
      ? {
        onProgress: (p: SdkUploadProgress) => {
          options.onProgress!({
            phase: 'uploading',
            fileName: p.currentFile.name,
            fileIndex: p.currentFile.index,
            totalFiles: p.currentFile.total,
            uploadedBytes: p.uploadedBytes,
            totalBytes: p.totalBytes,
            ratio: p.ratio,
          })
        },
      }
      : {}),
  })

  const transferUrl = result.webUrl

  // Zero out plaintext buffers now that the SDK has consumed them. JS GC cannot guarantee
  // timely reclamation, so this reduces residency in heap dumps / crash reports.
  for (const f of uploadFiles) f.data.fill(0)
  uploadFiles.length = 0

  // No mirror: recipients used for encryption were read directly from Gmail, so writing them back
  // would only overwrite what the user typed. The user manages To/Cc/Bcc in Gmail itself.
  await bridge.insertBodyHtml({
    html: buildLinkSnippet(transferUrl, options.expires),
    idempotencyKey: result.transferId ?? crypto.randomUUID(),
  })

  return {transferUrl}
}

export function isAuthError(message: string): boolean {
  return (
    message.toLowerCase().includes('refresh token') ||
    message.toLowerCase().includes('log in again') ||
    (/\b401\b/.test(message) && message.toLowerCase().includes('auth'))
  )
}
