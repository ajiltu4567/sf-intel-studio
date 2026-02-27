/**
 * SF-Intel Studio - Org Detector
 * 
 * ARCHITECTURAL PRINCIPLE:
 * Extract Salesforce session context safely from the Lightning Experience page.
 * NO external tools required. NO Salesforce DOM mutation.
 * 
 * Uses only public/safe methods to detect org context.
 */

class OrgDetector {
    constructor() {
        this.context = null;
    }

    /**
     * Detect if we're in Salesforce Lightning Experience
     * @returns {boolean}
     */
    isLightningExperience() {
        // Check for Lightning-specific elements
        return (
            document.querySelector('[data-aura-rendered-by]') !== null ||
            document.querySelector('.slds-') !== null ||
            window.location.pathname.includes('/lightning/')
        );
    }

    /**
     * Extract session ID from cookies
     * @returns {string|null}
     */
    getSessionIdFromCookies() {
        const cookies = document.cookie.split(';');

        for (const cookie of cookies) {
            const [name, value] = cookie.trim().split('=');

            // Salesforce session cookie patterns
            if (name === 'sid' || name.startsWith('sid_')) {
                console.log('[OrgDetector] Found session in cookie:', name);
                return decodeURIComponent(value);
            }
        }

        return null;
    }

    /**
     * Extract session ID from window (safer alternative)
     * @returns {string|null}
     */
    getSessionIdFromWindow() {
        try {
            // Method 1: Try Aura context
            if (window.$A && window.$A.getToken) {
                const token = window.$A.getToken();
                if (token) {
                    return token;
                }
            }

            // Method 2: Lightning global
            if (window.SfdcApp && window.SfdcApp.CSRF_TOKEN) {
                return window.SfdcApp.CSRF_TOKEN;
            }

            // Method 3: Lightning context
            if (window.LCC && window.LCC.accessToken) {
                return window.LCC.accessToken;
            }

            // Method 4: Check localStorage
            const lsToken = localStorage.getItem('accessToken') ||
                localStorage.getItem('sessionId') ||
                localStorage.getItem('sid');
            if (lsToken) {
                return lsToken;
            }

            // Method 5: Check known Salesforce session globals only
            const knownSessionGlobals = ['sfdcSessionVars', 'Sfdc_Session', 'SfdcSessionVars_Token'];
            for (const key of knownSessionGlobals) {
                try {
                    const val = window[key];
                    if (typeof val === 'string' && val.length > 50 && val.includes('!')) {
                        return val;
                    }
                    if (typeof val === 'object' && val !== null) {
                        const token = val.token || val.sessionId || val.sid;
                        if (typeof token === 'string' && token.length > 50 && token.includes('!')) {
                            return token;
                        }
                    }
                } catch (e) { /* skip inaccessible properties */ }
            }

        } catch (error) {
            console.warn('[OrgDetector] Could not access window session:', error);
        }

        return null;
    }

    /**
     * Get instance URL (transformed to my.salesforce.com for API stability)
     * @returns {string}
     */
    getInstanceUrl() {
        let host = window.location.hostname;
        // Transform Lightning domain to API domain to avoid redirects/auth issues
        if (host.includes('.lightning.force.com')) {
            host = host.replace('.lightning.force.com', '.my.salesforce.com');
        }
        // Remove MCAS suffix if present
        host = host.replace('.mcas.ms', '');

        return `https://${host}`;
    }

    /**
     * Extract org ID from page
     * @returns {string|null}
     */
    getOrgId() {
        try {
            // Method 1: From meta tag
            const metaTag = document.querySelector('meta[name="salesforce-organization-id"]');
            if (metaTag) {
                return metaTag.getAttribute('content');
            }

            // Method 2: From script tag
            const scripts = document.querySelectorAll('script');
            for (const script of scripts) {
                const content = script.textContent;
                const match = content.match(/organizationId["']?\s*:\s*["']([a-zA-Z0-9]{15,18})["']/);
                if (match) {
                    return match[1];
                }
            }

            // Method 3: From data attribute
            const orgElement = document.querySelector('[data-org-id]');
            if (orgElement) {
                return orgElement.getAttribute('data-org-id');
            }
        } catch (error) {
            console.warn('[OrgDetector] Could not extract org ID:', error);
        }

        return null;
    }

    /**
     * Get current user context
     * @returns {Object|null}
     */
    getUserContext() {
        try {
            // Try to get from window
            if (window.UserContext) {
                return {
                    userId: window.UserContext.userId,
                    userName: window.UserContext.userName,
                    userEmail: window.UserContext.userEmail
                };
            }

            // Try Aura context
            if (window.$A && window.$A.getContext) {
                const context = window.$A.getContext();
                if (context) {
                    return {
                        userId: context.globalValueProviders?.user?.userId,
                        userName: context.globalValueProviders?.user?.userName
                    };
                }
            }
        } catch (error) {
            console.warn('[OrgDetector] Could not get user context:', error);
        }

        return null;
    }

    /**
     * Detect complete Salesforce context
     * @returns {Promise<Object>} Org context
     */
    async detectContext() {
        console.log('[OrgDetector] Detecting Salesforce context...');

        // Check if Lightning
        if (!this.isLightningExperience()) {
            throw new Error('Not in Salesforce Lightning Experience');
        }

        // Get instance URL first
        const instanceUrl = this.getInstanceUrl();

        // Get session from background script (like Inspector!)
        console.log('[OrgDetector] Requesting session from background script...');
        let sessionId = null;

        try {
            const urlObj = new URL(instanceUrl);
            const sfHost = urlObj.hostname;

            const message = await new Promise((resolve) => {
                chrome.runtime.sendMessage({
                    message: 'getSession',
                    sfHost: sfHost
                }, resolve);
            });

            if (message && message.key) {
                sessionId = message.key;
            } else {
                console.warn('[OrgDetector] No session returned from background');
            }
        } catch (error) {
            console.error('[OrgDetector] Failed to get session from background:', error);
        }

        if (!sessionId) {
            throw new Error('Could not extract Salesforce session ID from background script');
        }

        // Get org ID
        const orgId = this.getOrgId();

        // Get user context
        const userContext = this.getUserContext();

        this.context = {
            sessionId,
            instanceUrl,
            orgId,
            user: userContext,
            detectedAt: new Date().toISOString()
        };

        console.log('[OrgDetector] Context detected:', {
            instanceUrl,
            orgId: orgId || 'unknown',
            hasSession: !!sessionId,
            user: userContext?.userName || 'unknown'
        });

        return this.context;
    }

    /**
     * Get cached context
     * @returns {Object|null}
     */
    getContext() {
        return this.context;
    }

    /**
     * Validate session is still active
     * @param {SalesforceAPIClient} apiClient
     * @returns {Promise<boolean>}
     */
    async validateSession(apiClient) {
        try {
            // Simple validation query
            await apiClient.query('SELECT Id FROM User LIMIT 1');
            return true;
        } catch (error) {
            console.error('[OrgDetector] Session validation failed:', error);
            return false;
        }
    }

    /**
     * Monitor for org changes (e.g., user switches orgs)
     * @param {Function} callback - Called when org changes
     */
    monitorOrgChanges(callback) {
        let lastOrgId = this.context?.orgId;

        const checkInterval = setInterval(async () => {
            const currentOrgId = this.getOrgId();

            if (currentOrgId && currentOrgId !== lastOrgId) {
                console.log('[OrgDetector] Org change detected:', currentOrgId);
                lastOrgId = currentOrgId;

                // Re-detect context
                try {
                    const newContext = await this.detectContext();
                    callback(newContext);
                } catch (error) {
                    console.error('[OrgDetector] Failed to detect new context:', error);
                }
            }
        }, 5000); // Check every 5 seconds

        return () => clearInterval(checkInterval);
    }
}

/**
 * Singleton instance
 */
let orgDetectorInstance = null;

function getOrgDetector() {
    if (!orgDetectorInstance) {
        orgDetectorInstance = new OrgDetector();
    }
    return orgDetectorInstance;
}

/**
 * Quick helper to detect and return context
 * @returns {Promise<Object>}
 */
async function detectSalesforceOrg() {
    const detector = getOrgDetector();
    return detector.detectContext();
}

// Make globally available for injector script
window.getOrgDetector = getOrgDetector;
window.detectSalesforceOrg = detectSalesforceOrg;
