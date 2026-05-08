// MV3 service worker. Handles InboxSDK's request to inject pageWorld.js into the Gmail tab's
// MAIN world (the real-page JS context, not the content-script's isolated world). InboxSDK uses
// the page-world script to listen on Gmail's internal events and intercept ajax — all of which
// require executing in the same global as Gmail itself.
//
// This is a verbatim port of @inboxsdk/core/background.js (we inline rather than re-export so
// crxjs/vite can bundle a single file and we keep control of permissions checks).

chrome.runtime.onMessage.addListener((message: Record<string, unknown>, sender, sendResponse) => {
  if (message?.type === 'inboxsdk__injectPageWorld' && sender.tab && sender.tab.id !== undefined) {
    // Only process requests from our own extension running on Gmail. `sender.id` equals
    // `chrome.runtime.id` for same-extension content-scripts on both Chrome and Firefox MV3.
    // `sender.url` is the URL of the frame that sent the message (more reliable than
    // `sender.tab.url` for multi-frame pages).
    const senderUrl = sender.url ?? sender.tab.url ?? ''
    if (sender.id !== chrome.runtime.id || !senderUrl.startsWith('https://mail.google.com/')) {
      sendResponse(false)
      return
    }
    if (!chrome.scripting) {
      // No MV3 scripting API available — content-script will fall back.
      sendResponse(false)
      return
    }
    // Protect against w3c/webextensions#8 on Chrome 106+ that supports documentId.
    const target: chrome.scripting.InjectionTarget = sender.documentId
      ? { tabId: sender.tab.id, documentIds: [sender.documentId] }
      : sender.frameId !== undefined
        ? { tabId: sender.tab.id, frameIds: [sender.frameId] }
        : { tabId: sender.tab.id }
    chrome.scripting.executeScript({
      target,
      world: 'MAIN',
      files: ['pageWorld.js'],
    }).then(
      () => sendResponse(true),
      (err: unknown) => {
        console.error('[Retyc] pageWorld injection failed', err)
        sendResponse(false)
      },
    )
    // Returning true keeps the message channel open for the async sendResponse above.
    return true
  }
  return undefined
})
