/**
 * SF-Intel Studio - Content Script / Injector
 * Runs in Salesforce page context.
 * - Injects a page-context network monitor to detect LWC/Aura Apex calls
 * - Relays detected calls to the service worker during Live Trace capture windows
 * No additional Chrome permissions required — script tag injection is a standard content script capability.
 */

console.log('[SF-Intel] Content script initialized');

// ---------------------------------------------------------------------------
// Inject network monitor into the page's JS execution context.
// Loaded via <script src> using the extension's chrome-extension:// URL, which
// Salesforce's CSP allows (it whitelists chrome-extension://[id]/).
// No 'scripting' permission required — standard content script capability.
// ---------------------------------------------------------------------------
(function injectMonitor() {
    const monitor = document.createElement('script');
    monitor.src = chrome.runtime.getURL('content/network-monitor.js');
    monitor.onload = function () { monitor.remove(); }; // Clean up DOM after load
    (document.head || document.documentElement).appendChild(monitor);
})();

// ---------------------------------------------------------------------------
// Relay page-context monitor events → service worker
// Handles: SF_INTEL_NET_EVENT (Apex network calls) and SF_INTEL_UI_ERROR (toast errors)
// Strict source validation: only accept messages from the same window
// ---------------------------------------------------------------------------
window.addEventListener('message', function(event) {
    // Only handle messages from our own page (not iframes, not other origins)
    if (event.source !== window) return;
    if (!event.data || typeof event.data.type !== 'string') return;
    var payload = event.data.payload;
    if (!payload || typeof payload !== 'object') return;

    if (event.data.type === 'SF_INTEL_NET_EVENT') {
        // Apex network call detected — SW stores while armed
        chrome.runtime.sendMessage({ action: 'network-event', payload: payload });
    } else if (event.data.type === 'SF_INTEL_UI_ERROR') {
        // LWC client-side toast error (e.g. error thrown before Apex call)
        chrome.runtime.sendMessage({ action: 'ui-error', payload: payload });
    }
});
