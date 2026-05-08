# Security Policy

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

See our security policy and contact details at:
**https://retyc.com/.well-known/security.txt**

## Threat model

- File bytes are read in the extension iframe (`chrome-extension://<id>/src/iframe/iframe.html`)
  via the HTML5 File API and encrypted client-side by `@retyc/sdk` before any network call.
  They never traverse Gmail's compose attachment system, never pass through Google's servers
  in cleartext, and never cross the postMessage bridge.
- Cleartext file bytes never leave the iframe process.

## Known limitations

- Authentication tokens (access token + refresh token) are stored in `browser.storage.local`,
  which is **per-extension, per-browser-profile, and unencrypted on disk**. Anyone with read
  access to your browser profile directory (a malicious local process, a backup leak, an
  unsynced shared device) can extract them. Protect your account with strong authentication
  and MFA, and the token store will inherit your OS account protections.
- The extension uses [InboxSDK](https://www.inboxsdk.com) (proprietary; Streak Inc.) to wire
  the Retyc button into Gmail's compose UI. InboxSDK runs in the content-script and has DOM
  access to the Gmail tab. **No Retyc tokens, file bytes, or recipient lists pass through
  InboxSDK** — the iframe holds those alone. The bridge between content-script and iframe
  carries only what InboxSDK already sees natively (recipients, body HTML).
- The OIDC Device Flow opens the Retyc sign-in page in a separate browser tab; tokens are
  delivered to the iframe through the SDK's polling mechanism, not via an OAuth redirect URI
  registered with the extension origin.
