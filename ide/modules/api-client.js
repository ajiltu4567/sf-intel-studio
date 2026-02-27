/**
 * SF-Intel Studio - API Client
 * Communicates with sf-intel web server (localhost:3000)
 */

class SFIntelAPIClient {
    constructor(baseUrl = 'http://127.0.0.1:3000') {
        this.baseUrl = baseUrl;
        this.cache = new Map();
        this.cacheTTL = 60000; // 1 minute cache
    }

    /**
     * Check if server is running
     * @returns {Promise<boolean>}
     */
    async isServerRunning() {
        try {
            const response = await fetch(`${this.baseUrl}/api/stats`, {
                method: 'GET',
                signal: AbortSignal.timeout(2000)
            });
            return response.ok;
        } catch (error) {
            SFIntelUtils.log('warn', 'SF-Intel server not running', error);
            return false;
        }
    }

    /**
     * Get database statistics
     * @returns {Promise<Object>}
     */
    async getStats() {
        return this._fetchWithCache('/api/stats');
    }

    /**
     * Get all Apex classes
     * @returns {Promise<Array>}
     */
    async getClasses() {
        return this._fetchWithCache('/api/classes');
    }

    /**
     * Get impact analysis for a class
     * @param {string} className - Name of the Apex class
     * @returns {Promise<Object>}
     */
    async getImpactAnalysis(className) {
        if (!className) {
            throw new Error('Class name is required');
        }
        return this._fetchWithCache(`/api/impact/${encodeURIComponent(className)}`);
    }

    /**
     * Get flow visualization for a class
     * @param {string} className - Name of the Apex class
     * @returns {Promise<Object>}
     */
    async getFlowVisualization(className) {
        if (!className) {
            throw new Error('Class name is required');
        }
        return this._fetchWithCache(`/api/flow/${encodeURIComponent(className)}`);
    }

    /**
     * Get context analysis for a class
     * @param {string} className - Name of the Apex class
     * @returns {Promise<Object>}
     */
    async getContextAnalysis(className) {
        if (!className) {
            throw new Error('Class name is required');
        }
        return this._fetchWithCache(`/api/context/${encodeURIComponent(className)}`);
    }

    /**
     * Shim for real-time validation (proxies to LSP)
     * @param {string} code 
     * @returns {Promise<Object>}
     */
    async validateCode(code) {
        return this._fetchWithCache('/api/apex/validate', {
            method: 'POST',
            body: JSON.stringify({ code })
        });
    }

    /**
     * Get entry points
     * @returns {Promise<Array>}
     */
    async getEntryPoints() {
        return this._fetchWithCache('/api/entrypoints');
    }

    /**
     * Get roles (architecture layers)
     * @returns {Promise<Object>}
     */
    async getRoles() {
        return this._fetchWithCache('/api/roles');
    }

    /**
     * Get class relationships and call graph
     * @param {string} className
     * @returns {Promise<Object>}
     */
    async getClassRelationships(className) {
        if (!className) throw new Error('Class name is required');
        return this._fetchWithCache(`/api/class-relationships/${encodeURIComponent(className)}`);
    }

    /**
     * Get SOQL reporting data
     * @returns {Promise<Object>}
     */
    async getSoqlData() {
        return this._fetchWithCache('/api/report/soql/data');
    }

    /**
     * Validate Apex code snippet
     * @param {string} code
     * @returns {Promise<Object>}
     */
    async validateCode(code) {
        try {
            const response = await fetch(`${this.baseUrl}/api/apex/validate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code })
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (error) {
            SFIntelUtils.log('error', 'Code validation failed', error);
            return { error: error.message };
        }
    }

    /**
     * Fetch with caching
     * @private
     * @param {string} endpoint
     * @returns {Promise<any>}
     */
    async _fetchWithCache(endpoint) {
        const cacheKey = endpoint;
        const cached = this.cache.get(cacheKey);

        // Return cached if valid
        if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
            SFIntelUtils.log('log', `Cache hit for ${endpoint}`);
            return cached.data;
        }

        try {
            const response = await fetch(`${this.baseUrl}${endpoint}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                },
                signal: AbortSignal.timeout(60000)
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            // Cache the result
            this.cache.set(cacheKey, {
                data,
                timestamp: Date.now()
            });

            return data;
        } catch (error) {
            SFIntelUtils.log('error', `API request failed for ${endpoint}`, error);

            // Return cached data even if expired, better than nothing
            if (cached) {
                SFIntelUtils.log('warn', `Using stale cache for ${endpoint}`);
                return cached.data;
            }

            throw error;
        }
    }

    /**
     * Clear cache
     */
    clearCache() {
        this.cache.clear();
        SFIntelUtils.log('log', 'Cache cleared');
    }

    /**
     * Clear cache for specific endpoint
     * @param {string} endpoint
     */
    clearCacheForEndpoint(endpoint) {
        this.cache.delete(endpoint);
    }
}

// Create global instance
window.sfIntelAPI = new SFIntelAPIClient();
