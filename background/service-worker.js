/**
 * SF-Intel Studio - Background Service Worker
 * Handles API calls to bypass CORS restrictions
 */

console.log('[SF-Intel Studio] Service worker initialized');

/**
 * Dynamic Icon Management
 * Shows active (blue) icon on Salesforce pages, inactive (grey) on all others
 */
const ACTIVE_ICONS = {
    16: '/icons/app_logo_16.png',
    32: '/icons/app_logo_32.png',
    48: '/icons/app_logo_48.png',
    128: '/icons/app_logo_128.png'
};

const INACTIVE_ICONS = {
    16: '/icons/app_logo_16_inactive.png',
    32: '/icons/app_logo_32_inactive.png',
    48: '/icons/app_logo_48_inactive.png',
    128: '/icons/app_logo_128_inactive.png'
};

function isSalesforcePage(url) {
    if (!url) return false;
    return url.includes('.salesforce.com') ||
        url.includes('.force.com') ||
        url.includes('.visualforce.com') ||
        url.includes('.salesforce-setup.com');
}

function updateIconForTab(tabId, url) {
    const isActive = isSalesforcePage(url);
    const icons = isActive ? ACTIVE_ICONS : INACTIVE_ICONS;
    const title = isActive ? 'SF-Intel Studio — Click to Launch' : 'SF-Intel Studio — Navigate to Salesforce';

    chrome.action.setIcon({ tabId, path: icons });
    chrome.action.setTitle({ tabId, title });
}

// Update icon when tab URL changes
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url || changeInfo.status === 'complete') {
        updateIconForTab(tabId, tab.url);
    }
});

// Update icon when switching tabs
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        updateIconForTab(tab.id, tab.url);
    } catch (e) {
        // Tab might have been closed
    }
});

// Set inactive icon on install/startup
chrome.runtime.onInstalled.addListener(() => {
    chrome.action.setIcon({ path: INACTIVE_ICONS });
    chrome.action.setTitle({ title: 'SF-Intel Studio — Navigate to Salesforce' });
});

/**
 * Handle extension icon click
 */
let ideWindowId = null;

chrome.action.onClicked.addListener(async (tab) => {
    console.log('[SF-Intel Studio] Extension icon clicked on tab:', tab.id);

    // Check if it's a Salesforce page
    if (!isSalesforcePage(tab.url)) {
        console.warn('[SF-Intel Studio] Not a Salesforce page:', tab.url);
        return;
    }

    // Try to find existing window
    if (ideWindowId !== null) {
        try {
            await chrome.windows.update(ideWindowId, { focused: true });
            // Notify IDE that context might have changed
            chrome.runtime.sendMessage({ action: 'context-updated' });
            return;
        } catch (e) {
            ideWindowId = null;
        }
    }

    // Capture context
    lastActiveContext = { tabId: tab.id, url: tab.url };

    // Create standalone window
    const window = await chrome.windows.create({
        url: chrome.runtime.getURL('ide/ide.html'),
        type: 'popup',
        width: 1280,
        height: 800
    });
    ideWindowId = window.id;
});

let lastActiveContext = null;

/**
 * Live Trace Network Event Buffer
 * Stores intercepted LWC/Aura Apex calls while a trace is armed.
 * Cleared on arm, fetched on capture.
 */
let liveTraceNetworkEvents = [];
let liveTraceUiErrors = [];
let liveTraceArmed = false;

/**
 * Handle messages from IDE window or Content script
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[SF-Intel Studio] Message received:', request.action || request.message);

    // Network interception: store Apex call events from content script while trace is armed
    if (request.action === 'network-event') {
        if (liveTraceArmed && request.payload) {
            liveTraceNetworkEvents.push(request.payload);
        }
        sendResponse({ ok: true });
        return true;
    }

    // UI error interception: store ShowToastEvent errors from content script while trace is armed
    if (request.action === 'ui-error') {
        if (liveTraceArmed && request.payload) {
            liveTraceUiErrors.push(request.payload);
        }
        sendResponse({ ok: true });
        return true;
    }

    if (request.action === 'arm-network-capture') {
        liveTraceNetworkEvents = [];
        liveTraceUiErrors = [];
        liveTraceArmed = true;
        sendResponse({ ok: true });
        return true;
    }

    if (request.action === 'get-network-events') {
        liveTraceArmed = false; // Stop accumulating after capture
        sendResponse({ events: liveTraceNetworkEvents, uiErrors: liveTraceUiErrors });
        return true;
    }

    if (request.action === 'disarm-network-capture') {
        liveTraceNetworkEvents = [];
        liveTraceUiErrors = [];
        liveTraceArmed = false;
        sendResponse({ ok: true });
        return true;
    }

    // LWC Preview: hard-reload the preview tab after navigation commits so that
    // Salesforce's cached Aura/LWC JS+CSS is bypassed (equivalent to Ctrl+Shift+R).
    if (request.action === 'hard-reload-preview') {
        setTimeout(() => {
            chrome.tabs.query({ url: ['*://*.salesforce.com/*', '*://*.force.com/*', '*://*.visualforce.com/*'] }, (tabs) => {
                const tab = (tabs || []).find(t => t.url && t.url.includes('sfIntelPreviewHost'));
                if (tab) chrome.tabs.reload(tab.id, { bypassCache: true });
            });
        }, 800); // wait for window.open() navigation to commit before reloading
        sendResponse({ ok: true });
        return true;
    }

    // Provide context to IDE window
    if (request.action === 'get-active-context') {
        if (!lastActiveContext) {
            sendResponse(null);
            return;
        }

        let host = new URL(lastActiveContext.url).hostname;
        const originalHost = host;

        // Transform lightning domain to my.salesforce.com for cookie/API access
        if (host.includes('.lightning.force.com')) {
            host = host.replace('.lightning.force.com', '.my.salesforce.com');
        }

        chrome.cookies.get({
            url: 'https://' + host,
            name: 'sid'
        }, (cookie) => {
            if (cookie) {
                sendResponse({
                    sessionId: cookie.value,
                    instanceUrl: 'https://' + host
                });
            } else {
                // Try fallback to original host if transformation didn't find it
                if (host !== originalHost) {
                    chrome.cookies.get({
                        url: 'https://' + originalHost,
                        name: 'sid'
                    }, (fallbackCookie) => {
                        if (fallbackCookie) {
                            sendResponse({
                                sessionId: fallbackCookie.value,
                                instanceUrl: 'https://' + originalHost
                            });
                        } else {
                            sendResponse(null);
                        }
                    });
                } else {
                    sendResponse(null);
                }
            }
        });
        return true;
    }

    if (request.message === 'getSession') {
        let host = request.sfHost;

        // Ensure we are looking for the cookie on the canonical domain
        if (host.includes('.lightning.force.com')) {
            host = host.replace('.lightning.force.com', '.my.salesforce.com');
        }

        console.log('[SF-Intel Studio] Getting session for host:', host);

        // Extract session cookie using chrome.cookies API
        chrome.cookies.get({
            url: 'https://' + host,
            name: 'sid',
            storeId: sender.tab?.cookieStoreId
        }, (sessionCookie) => {
            if (!sessionCookie) {
                console.warn('[SF-Intel Studio] No session cookie found for:', host);
                // Fallback: try the original host if different
                if (host !== request.sfHost) {
                    chrome.cookies.get({
                        url: 'https://' + request.sfHost,
                        name: 'sid',
                        storeId: sender.tab?.cookieStoreId
                    }, (fallbackCookie) => {
                        if (fallbackCookie) {
                            console.log('[SF-Intel Studio] Found session on original host fallback');
                            sendResponse({
                                key: fallbackCookie.value,
                                hostname: fallbackCookie.domain
                            });
                        } else {
                            sendResponse(null);
                        }
                    });
                } else {
                    sendResponse(null);
                }
                return;
            }

            console.log('[SF-Intel Studio] Session cookie found for:', sessionCookie.domain);
            const session = {
                key: sessionCookie.value,
                hostname: sessionCookie.domain
            };
            sendResponse(session);
        });

        return true; // Keep channel open for async response
    }

    // P1 Security: Removed deprecated 'api-call' open proxy handler (was using cookies-based approach instead)


    if (request.action === 'reload-preview-tabs') {
        chrome.tabs.query({ url: ['*://*.salesforce.com/*', '*://*.force.com/*', '*://*.visualforce.com/*'] }, (tabs) => {
            if (chrome.runtime.lastError) {
                sendResponse({ success: false, count: 0 });
                return;
            }
            const newUrl = request.previewUrl || null;

            // Extract the component name from the new URL so we only refresh
            // that component's own preview tab, leaving other LWC preview tabs untouched.
            let targetCmp = null;
            if (newUrl) {
                try { targetCmp = new URL(newUrl).searchParams.get('c__cmp'); } catch (e) {}
            }

            const allPreviewTabs = (tabs || []).filter(t =>
                t.url && (t.url.includes('sfIntelPreviewHost.app') || t.url.includes('c__cmp='))
            );

            // If we resolved a component name, only touch its tab.
            // Fallback: refresh all preview tabs (e.g. when URL could not be built).
            const previewTabs = targetCmp
                ? allPreviewTabs.filter(t => t.url.includes(`c__cmp=${targetCmp}`))
                : allPreviewTabs;

            previewTabs.forEach(t => {
                if (newUrl) {
                    // Navigate to the new URL first (updates c__cmp + t= cache buster).
                    // Then, once the page finishes loading, do a hard bypass-cache reload so
                    // Salesforce serves fresh LWC bundle JS/CSS instead of a cached version.
                    const tabId = t.id;
                    const onUpdatedListener = (updatedTabId, changeInfo) => {
                        if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
                        chrome.tabs.onUpdated.removeListener(onUpdatedListener);
                        chrome.tabs.reload(tabId, { bypassCache: true }, () => {
                            if (chrome.runtime.lastError) {
                                console.warn('[SF-Intel SW] Hard reload failed:', chrome.runtime.lastError.message);
                            }
                        });
                    };
                    chrome.tabs.onUpdated.addListener(onUpdatedListener);
                    // Safety: remove listener after 15 s if the tab never reaches 'complete'
                    setTimeout(() => chrome.tabs.onUpdated.removeListener(onUpdatedListener), 15000);

                    chrome.tabs.update(tabId, { url: newUrl }, () => {
                        if (chrome.runtime.lastError) {
                            chrome.tabs.onUpdated.removeListener(onUpdatedListener);
                            console.warn('[SF-Intel SW] Tab update failed:', chrome.runtime.lastError.message);
                        }
                    });
                } else {
                    chrome.tabs.reload(t.id, { bypassCache: true }, () => {
                        if (chrome.runtime.lastError) {
                            console.warn('[SF-Intel SW] Tab reload failed:', chrome.runtime.lastError.message);
                        }
                    });
                }
            });
            sendResponse({ success: true, count: previewTabs.length });
        });
        return true;
    }
});

/**
 * Get Salesforce session cookies
 */
async function getSalesforceCookies(url) {
    try {
        const cookies = await chrome.cookies.getAll({ url });
        console.log('[SF-Intel Studio] Found', cookies.length, 'cookies for', url);

        // Build cookie header
        const cookieHeader = cookies
            .map(cookie => `${cookie.name}=${cookie.value}`)
            .join('; ');

        return cookieHeader;
    } catch (error) {
        console.error('[SF-Intel Studio] Failed to get cookies:', error);
        return '';
    }
}

/**
 * Make API call with proper credentials (backup method)
 */
async function makeAPICall(url, options = {}) {
    console.log('[SF-Intel Studio] Making API call:', url);

    const fetchOptions = {
        method: options.method || 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        credentials: 'include',
        mode: 'cors'
    };

    if (options.body && options.method !== 'GET') {
        fetchOptions.body = JSON.stringify(options.body);
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`API Error: ${response.status} - ${error}`);
    }

    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
        return response.json();
    }

    return response.text();
}
