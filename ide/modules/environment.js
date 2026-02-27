/**
 * Environment Detection
 * 
 * Detects if extension is running in development (unpacked) or production (Chrome Store)
 */

class Environment {
    /**
     * Check if running in development mode
     * @returns {boolean} True if extension is unpacked (development)
     */
    static isDevelopment() {
        const manifest = chrome.runtime.getManifest();
        // Unpacked extensions don't have update_url in manifest
        return !('update_url' in manifest);
    }
    
    /**
     * Check if running in production mode
     * @returns {boolean} True if extension is from Chrome Store
     */
    static isProduction() {
        return !this.isDevelopment();
    }
    
    /**
     * Get extension ID
     * @returns {string} Chrome extension ID
     */
    static getExtensionId() {
        return chrome.runtime.id;
    }
    
    /**
     * Get extension version
     * @returns {string} Version from manifest
     */
    static getVersion() {
        return chrome.runtime.getManifest().version;
    }
    
    /**
     * Get environment string for logging
     * @returns {string} 'development' or 'production'
     */
    static getEnvironment() {
        return this.isDevelopment() ? 'development' : 'production';
    }
}

// Export for use in other modules
window.Environment = Environment;
