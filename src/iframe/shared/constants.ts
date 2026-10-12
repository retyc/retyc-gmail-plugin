// `||` (not `??`) — Docker passes ENV=${ARG} which materializes as "" when the build-arg is
// omitted, and an empty string would otherwise turn API calls into same-origin fetches against
// the asset host.
export const API_URL = import.meta.env.VITE_RETYC_API_URL || 'https://api.retyc.com'

// Tokens are stored per Gmail account under `retyc_tokens:<lowercased email>` (see account.ts).
export const STORAGE_KEY_TOKENS_PREFIX = 'retyc_tokens:'
// Single shared key used before per-account isolation; only read once for migration.
export const STORAGE_KEY_TOKENS_LEGACY = 'retyc_tokens'
