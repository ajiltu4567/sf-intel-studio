/**
 * SF-Intel Native Messaging Bridge
 * 
 * Connects Chrome extension to sf-intel-native-host via Chrome Native Messaging
 * Eliminates all localhost/networking dependencies
 */

class NativeBridge {
    constructor() {
        this.port = null;
        this.requestCallbacks = new Map();
        this.connected = false;
        this.connectionError = null;
        this.retryTimer = null;
        this.hostName = 'com.sfintel.native.host';
    }

    /**
     * Establish connection to native host
     * @returns {Promise<void>}
     */
    async connect() {
        return new Promise((resolve, reject) => {
            try {
                console.log('[NativeBridge] Extension ID:', chrome.runtime.id);
                console.log('[NativeBridge] Connecting to native host:', this.hostName);
                
                this.port = chrome.runtime.connectNative(this.hostName);
                
                // Track if we've resolved/rejected already
                let settled = false;
                
                this.port.onMessage.addListener((response) => {
                    console.log('[NativeBridge] Received message:', response);
                    
                    // First message = connection successful
                    if (!settled && !this.connected) {
                        settled = true;
                        this.connected = true;
                        this.connectionError = null;
                        console.log('[NativeBridge] ✅ Connected successfully (first message received)');
                        resolve();
                    }
                    
                    const callback = this.requestCallbacks.get(response.requestId);
                    if (callback) {
                        callback.resolve(response);
                        this.requestCallbacks.delete(response.requestId);
                    }
                });
                
                this.port.onDisconnect.addListener(() => {
                    const error = chrome.runtime.lastError;
                    console.warn('[NativeBridge] Disconnected:', error);
                    
                    // If we haven't resolved yet, this is a connection failure
                    if (!settled) {
                        settled = true;
                        console.error('[NativeBridge] Raw chrome error:', JSON.stringify(error));
                        this.connectionError = this.classifyError(error);
                        console.error('[NativeBridge] ❌ Connection failed:', this.connectionError);
                        reject(this.connectionError);
                        return;
                    }
                    
                    // Otherwise, it's a disconnect after successful connection
                    this.connected = false;
                    this.connectionError = this.classifyError(error);
                    
                    // Reject all pending requests
                    for (const [id, callback] of this.requestCallbacks) {
                        callback.reject(this.connectionError);
                    }
                    this.requestCallbacks.clear();
                    
                    // Schedule reconnect attempt
                    this.scheduleReconnect();
                });

                // BREAK DEADLOCK: Send initial ping to force the host to respond.
                // This triggers the onMessage listener above and resolves the connection.
                console.log('[NativeBridge] Sending initial ping to break deadlock...');
                this.port.postMessage({
                    type: 'health_check',
                    requestId: 'init-ping-' + Date.now()
                });
                
                // Timeout if no response within 5 seconds (increased from 2s for stability)
                setTimeout(() => {
                    if (!settled) {
                        settled = true;
                        const timeoutError = { 
                            type: 'TIMEOUT', 
                            message: 'Native host connection timeout (no response to ping)',
                            userMessage: 'Native host connection timeout' 
                        };
                        this.connectionError = timeoutError;
                        console.error('[NativeBridge] ❌ Connection timeout');
                        reject(timeoutError);
                    }
                }, 5000);
                
            } catch (error) {
                console.error('[NativeBridge] Connection exception:', error);
                this.connectionError = this.classifyError(error);
                reject(this.connectionError);
            }
        });
    }
    
    /**
     * Classify connection errors into user-friendly messages
     * @param {Error|Object} rawError 
     * @returns {Object} Classified error with user message and action
     */
    classifyError(rawError) {
        const message = rawError?.message || '';
        
        // CLI not installed or not registered
        if (message.includes('Specified native messaging host not found')) {
            return {
                type: 'NOT_INSTALLED',
                userMessage: 'SFintel CLI not found',
                action: 'install',
                actionLabel: 'Install CLI',
                actionUrl: 'https://sfintel.io/install'
            };
        }
        
        // Permission/security block
        if (message.includes('Access to the specified native messaging host is forbidden')) {
            return {
                type: 'PERMISSION_DENIED',
                userMessage: 'System blocked SFintel CLI',
                action: 'help',
                actionLabel: 'Learn More',
                actionUrl: 'https://sfintel.io/troubleshooting#permissions'
            };
        }
        
        // Native host crashed or exited
        if (message.includes('Native host has exited')) {
            return {
                type: 'CRASHED',
                userMessage: 'Engine stopped unexpectedly',
                action: 'restart',
                actionLabel: 'Restart',
                actionUrl: null
            };
        }
        
        // Version incompatibility
        if (message.includes('incompatible') || message.includes('version')) {
            return {
                type: 'VERSION_INCOMPATIBLE',
                userMessage: 'CLI version incompatible',
                action: 'update',
                actionLabel: 'Update CLI',
                actionUrl: 'https://sfintel.io/install'
            };
        }
        
        // Unknown error
        return {
            type: 'UNKNOWN',
            userMessage: 'SFintel Engine unavailable',
            action: 'retry',
            actionLabel: 'Retry',
            actionUrl: 'https://sfintel.io/troubleshooting'
        };
    }
    
    /**
     * Send request to native host
     * @param {string} type - Request type (health_check, execute_command, etc.)
     * @param {Object} payload - Request payload
     * @returns {Promise<Object>} Response from native host
     */
    async request(type, payload = {}) {
        if (!this.connected) {
            await this.connect();
        }
        
        const requestId = crypto.randomUUID();
        
        return new Promise((resolve, reject) => {
            this.requestCallbacks.set(requestId, { resolve, reject });
            
            const message = {
                type,
                requestId,
                cliVersion: '1.0.0',
                payload
            };
            
            console.log('[NativeBridge] Sending request:', message);
            this.port.postMessage(message);
            
            // Timeout after 30s
            setTimeout(() => {
                if (this.requestCallbacks.has(requestId)) {
                    this.requestCallbacks.delete(requestId);
                    reject(new Error('Request timeout'));
                }
            }, 30000);
        });
    }
    
    /**
     * Check native host health
     * @returns {Promise<Object>} Health status
     */
    async healthCheck() {
        try {
            const response = await this.request('health_check');
            
            // Validate protocol version compatibility
            const protocolVersion = response.payload.protocolVersion || response.protocolVersion;
            const minExtVersion = response.payload.minExtensionVersion;
            const currentExtVersion = chrome.runtime.getManifest().version;
            
            // Check if protocol versions are compatible
            const isCompatible = this.checkProtocolCompatibility(protocolVersion, currentExtVersion, minExtVersion);
 
            if (!isCompatible) {
                return {
                    available: false,
                    error: {
                        type: 'VERSION_INCOMPATIBLE',
                        userMessage: 'CLI version incompatible',
                        action: 'update',
                        actionLabel: 'Update CLI',
                        details: {
                            cliProtocol: protocolVersion,
                            extensionVersion: currentExtVersion,
                            minRequired: minExtVersion
                        }
                    }
                };
            }
            
            return {
                available: true,
                version: response.payload.version,
                protocolVersion: protocolVersion,
                compatible: isCompatible,
                features: response.payload.supported_features
            };
        } catch (error) {
            return { 
                available: false, 
                error: this.connectionError || { 
                    type: 'UNKNOWN',
                    userMessage: error.message 
                } 
            };
        }
    }
    
    /**
     * Check protocol version compatibility
     * @param {string} protocolVersion - Native host protocol version
     * @param {string} extensionVersion - Current extension version
     * @param {string} minExtVersion - Minimum required extension version
     * @returns {boolean} True if compatible
     */
    checkProtocolCompatibility(protocolVersion, extensionVersion, minExtVersion) {
        // Parse versions (simple major.minor comparison)
        const parseVersion = (ver) => {
            const parts = ver.split('.').map(Number);
            return { major: parts[0] || 0, minor: parts[1] || 0, patch: parts[2] || 0 };
        };
        
        const extVer = parseVersion(extensionVersion);
        const minVer = parseVersion(minExtVersion || '0.0.0');
        const protoVer = parseVersion(protocolVersion || '1.0');
        
        // Extension must be >= minExtVersion
        if (extVer.major < minVer.major) return false;
        if (extVer.major === minVer.major && extVer.minor < minVer.minor) return false;
        
        // Protocol version must be 1.x (current version)
        if (protoVer.major !== 1) return false;
        
        return true;
    }
    
    /**
     * Get CLI info (version, platform, etc.)
     * @returns {Promise<Object>} CLI information
     */
    async getCliInfo() {
        try {
            const response = await this.request('get_cli_info');
            return response.payload;
        } catch (error) {
            throw new Error(`Failed to get CLI info: ${error.message}`);
        }
    }
    
    /**
     * Schedule reconnection attempt
     */
    scheduleReconnect() {
        if (this.retryTimer) {
            clearTimeout(this.retryTimer);
        }
        
        console.log('[NativeBridge] Scheduling reconnect in 5s...');
        this.retryTimer = setTimeout(() => {
            this.connect().catch(err => {
                console.warn('[NativeBridge] Reconnect failed:', err);
            });
        }, 5000);
    }
    
    /**
     * Disconnect from native host
     */
    disconnect() {
        if (this.retryTimer) {
            clearTimeout(this.retryTimer);
            this.retryTimer = null;
        }
        
        if (this.port) {
            this.port.disconnect();
            this.port = null;
        }
        
        this.connected = false;
        this.requestCallbacks.clear();
    }
    
    /**
     * Check if connected
     * @returns {boolean}
     */
    isConnected() {
        return this.connected;
    }
    
    /**
     * Get current connection error
     * @returns {Object|null}
     */
    getError() {
        return this.connectionError;
    }
}

// Export for use in other modules
window.NativeBridge = NativeBridge;
