// `||` (not `??`) — Docker passes ENV=${ARG} which materializes as "" when the build-arg is
// omitted, and an empty string would otherwise turn API calls into same-origin fetches against
// the asset host.
export const API_URL = import.meta.env.VITE_RETYC_API_URL || 'https://api.retyc.com'

export const STORAGE_KEY_TOKENS = 'retyc_tokens'
