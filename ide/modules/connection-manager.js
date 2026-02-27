/**
 * Connection Manager
 * 
 * Intelligently selects between Native Messaging and HTTP fallback
 * Provides seamless transition with zero user disruption
 */

class ConnectionManager {
    constructor() {
        this.nativeBridge = new NativeBridge();
        this.httpFallback = new CLIBridge(); // Existing localhost bridge
        this.activeConnection = null;
        this.connectionType = null;
        
        // PRODUCTION: Disable HTTP fallback in Chrome Store builds
        // Development: Allow HTTP fallback for testing
        this.autoFallback = true; // Allow fallback if native fails
        this.preferNative = true; // Try Native Messaging first
        
        console.log('[ConnectionManager] Mode:', Environment ? Environment.getEnvironment() : 'unknown');
        console.log('[ConnectionManager] HTTP fallback:', this.autoFallback ? 'enabled' : 'disabled');
    }

    /**
     * Initialize connection - tries Native Messaging first, falls back to HTTP
     * @returns {Promise<Object>} Active connection bridge or null
     */
    async initialize() {
        console.log('[ConnectionManager] Initializing connection...');
        console.log('[ConnectionManager] Mode:', Environment ? Environment.getEnvironment() : 'unknown');
        console.log('[ConnectionManager] HTTP fallback:', this.autoFallback ? 'enabled' : 'disabled');
        
        // SKIP Native Messaging entirely if preferNative is false (HTTP-only mode)
        if (!this.preferNative) {
            console.log('[ConnectionManager] Skipping Native Messaging (HTTP-only mode)');
        } else {
            // Try Native Messaging first (production path)
            try {
                console.log('[ConnectionManager] Attempting Native Messaging...');
                await this.nativeBridge.connect();
                const health = await this.nativeBridge.healthCheck();
                
                if (health.available) {
                    this.activeConnection = this.nativeBridge;
                    this.connectionType = 'native';
                    console.log('[ConnectionManager] ✅ Native host confirmed healthy');
                    console.log('[ConnectionManager] ✅ Using Native Messaging');
                    return this.nativeBridge;
                } else {
                    console.warn('[ConnectionManager] Native host health check failed:', health.error);
                }
            } catch (error) {
                console.warn('[ConnectionManager] Native Messaging failed:', error.message || error.userMessage || error);
            }
        }
        
        // Auto-fallback to HTTP (localhost) in development or as backup
        if (this.autoFallback) {
            try {
                console.log('[ConnectionManager] Attempting HTTP fallback...');
                const health = await this.httpFallback.checkHealth();
                if (health.available) {
                    this.activeConnection = this.httpFallback;
                    this.connectionType = 'http';
                    console.log('[ConnectionManager] ⚠️ Using HTTP fallback (localhost)');
                    return this.httpFallback;
                }
            } catch (error) {
                console.warn('[ConnectionManager] HTTP fallback failed:', error.message || error.userMessage || error);
            }
        }
        
        // No connection available - but don't throw, let status manager handle gracefully
        this.connectionType = 'none';
        console.warn('[ConnectionManager] ⚠️ No CLI connection available');
        console.log('[ConnectionManager] Status bar will show connection status');
        return null;
    }
    
    /**
     * Get active connection bridge
     * @returns {NativeBridge|CLIBridge}
     */
    getConnection() {
        if (!this.activeConnection) {
            throw new Error('No active connection. Call initialize() first.');
        }
        return this.activeConnection;
    }
    
    /**
     * Get connection type
     * @returns {string} 'native', 'http', or 'none'
     */
    getConnectionType() {
        return this.connectionType;
    }
    
    /**
     * Check if using native messaging
     * @returns {boolean}
     */
    isUsingNative() {
        return this.connectionType === 'native';
    }
    
    /**
     * Check if using HTTP fallback
     * @returns {boolean}
     */
    isUsingHttp() {
        return this.connectionType === 'http';
    }
    
    /**
     * Get connection status for UI
     * @returns {Object} Status object with type, connected, and message
     */
    getStatus() {
        if (this.connectionType === 'native') {
            return {
                type: 'native',
                connected: this.nativeBridge.isConnected(),
                message: 'SFintel Engine: Ready',
                icon: '🟢',
                error: this.nativeBridge.getError()
            };
        }
        
        if (this.connectionType === 'http') {
            return {
                type: 'http',
                connected: true,
                message: 'SFintel Engine: Ready (HTTP)',
                icon: '🟡',
                note: 'Using localhost fallback'
            };
        }
        
        return {
            type: 'none',
            connected: false,
            message: 'SFintel Engine: Unavailable',
            icon: '🔴',
            error: this.nativeBridge.getError() || { userMessage: 'No connection' }
        };
    }
    
    /**
     * Force reconnect
     * @returns {Promise<Object>}
     */
    async reconnect() {
        console.log('[ConnectionManager] Forcing reconnect...');
        this.activeConnection = null;
        this.connectionType = null;
        return this.initialize();
    }
}

// Export for use in IDE
window.ConnectionManager = ConnectionManager;
