/**
 * SF-Intel Studio - Fetch Latest from Salesforce Module
 *
 * Provides VS Code-like "Fetch Latest" functionality for:
 * - Apex Classes (.cls)
 * - Apex Triggers (.trigger)
 * - LWC Components (bundle)
 * - Aura Components (bundle)
 *
 * @module FetchLatestService
 * @version 1.0.0
 */

const FetchLatestService = {
    /**
     * Supported metadata types
     */
    SUPPORTED_TYPES: {
        APEX_CLASS: 'ApexClass',
        APEX_TRIGGER: 'ApexTrigger',
        LWC: 'LWC',
        AURA: 'AuraDefinitionBundle'
    },

    /**
     * Fetch latest Apex Class source from Salesforce
     * @param {string} name - Class name (without .cls extension)
     * @returns {Promise<{success: boolean, name: string, body: string, metadata?: object}>}
     */
    async fetchApexClass(name) {
        console.log(`[FetchLatest] Fetching ApexClass: ${name}`);

        if (!window.apiClient) {
            throw new Error('API client not initialized');
        }

        try {
            const query = `SELECT Id, Name, Body, ApiVersion, Status, LastModifiedDate, LastModifiedBy.Name
                          FROM ApexClass WHERE Name = '${this._sanitizeName(name)}' LIMIT 1`;
            const result = await window.apiClient.toolingQuery(query);

            if (!result.records || result.records.length === 0) {
                throw new Error(`Apex Class '${name}' not found in org`);
            }

            const record = result.records[0];
            return {
                success: true,
                type: this.SUPPORTED_TYPES.APEX_CLASS,
                id: record.Id,
                name: record.Name,
                body: record.Body || '',
                metadata: {
                    apiVersion: record.ApiVersion,
                    status: record.Status,
                    lastModified: record.LastModifiedDate,
                    lastModifiedBy: record.LastModifiedBy?.Name || 'Unknown'
                }
            };
        } catch (error) {
            console.error(`[FetchLatest] Failed to fetch ApexClass '${name}':`, error);
            throw error;
        }
    },

    /**
     * Fetch latest Apex Trigger source from Salesforce
     * @param {string} name - Trigger name (without .trigger extension)
     * @returns {Promise<{success: boolean, name: string, body: string, metadata?: object}>}
     */
    async fetchApexTrigger(name) {
        console.log(`[FetchLatest] Fetching ApexTrigger: ${name}`);

        if (!window.apiClient) {
            throw new Error('API client not initialized');
        }

        try {
            const query = `SELECT Id, Name, Body, ApiVersion, Status, TableEnumOrId, LastModifiedDate, LastModifiedBy.Name
                          FROM ApexTrigger WHERE Name = '${this._sanitizeName(name)}' LIMIT 1`;
            const result = await window.apiClient.toolingQuery(query);

            if (!result.records || result.records.length === 0) {
                throw new Error(`Apex Trigger '${name}' not found in org`);
            }

            const record = result.records[0];
            return {
                success: true,
                type: this.SUPPORTED_TYPES.APEX_TRIGGER,
                id: record.Id,
                name: record.Name,
                body: record.Body || '',
                metadata: {
                    apiVersion: record.ApiVersion,
                    status: record.Status,
                    sObject: record.TableEnumOrId,
                    lastModified: record.LastModifiedDate,
                    lastModifiedBy: record.LastModifiedBy?.Name || 'Unknown'
                }
            };
        } catch (error) {
            console.error(`[FetchLatest] Failed to fetch ApexTrigger '${name}':`, error);
            throw error;
        }
    },

    /**
     * Fetch latest LWC bundle from Salesforce (all files)
     * @param {string} name - Component name (DeveloperName)
     * @returns {Promise<{success: boolean, name: string, files: Array, metadata?: object}>}
     */
    async fetchLwcBundle(name) {
        console.log(`[FetchLatest] Fetching LWC Bundle: ${name}`);

        if (!window.apiClient) {
            throw new Error('API client not initialized');
        }

        try {
            // Step 1: Get bundle metadata
            const bundleQuery = `SELECT Id, DeveloperName, ApiVersion, Description, LastModifiedDate, LastModifiedBy.Name
                                FROM LightningComponentBundle WHERE DeveloperName = '${this._sanitizeName(name)}' LIMIT 1`;
            const bundleResult = await window.apiClient.toolingQuery(bundleQuery);

            if (!bundleResult.records || bundleResult.records.length === 0) {
                throw new Error(`LWC Component '${name}' not found in org`);
            }

            const bundle = bundleResult.records[0];

            // Step 2: Get all resources in the bundle
            const resourceQuery = `SELECT Id, FilePath, Source, Format
                                  FROM LightningComponentResource
                                  WHERE LightningComponentBundleId = '${bundle.Id}'
                                  ORDER BY FilePath`;
            const resourceResult = await window.apiClient.toolingQuery(resourceQuery);

            const files = (resourceResult.records || []).map(r => ({
                id: r.Id,
                path: r.FilePath,
                fileName: r.FilePath.split('/').pop(),
                source: r.Source || '',
                format: r.Format
            }));

            return {
                success: true,
                type: this.SUPPORTED_TYPES.LWC,
                id: bundle.Id,
                name: bundle.DeveloperName,
                files: files,
                metadata: {
                    apiVersion: bundle.ApiVersion,
                    description: bundle.Description,
                    lastModified: bundle.LastModifiedDate,
                    lastModifiedBy: bundle.LastModifiedBy?.Name || 'Unknown',
                    fileCount: files.length
                }
            };
        } catch (error) {
            console.error(`[FetchLatest] Failed to fetch LWC Bundle '${name}':`, error);
            throw error;
        }
    },

    /**
     * Fetch latest Aura bundle from Salesforce (all definitions)
     * @param {string} name - Component name (DeveloperName)
     * @returns {Promise<{success: boolean, name: string, files: Array, metadata?: object}>}
     */
    async fetchAuraBundle(name) {
        console.log(`[FetchLatest] Fetching Aura Bundle: ${name}`);

        if (!window.apiClient) {
            throw new Error('API client not initialized');
        }

        try {
            // Step 1: Get bundle metadata
            const bundleQuery = `SELECT Id, DeveloperName, ApiVersion, Description, LastModifiedDate, LastModifiedBy.Name
                                FROM AuraDefinitionBundle WHERE DeveloperName = '${this._sanitizeName(name)}' LIMIT 1`;
            const bundleResult = await window.apiClient.toolingQuery(bundleQuery);

            if (!bundleResult.records || bundleResult.records.length === 0) {
                throw new Error(`Aura Component '${name}' not found in org`);
            }

            const bundle = bundleResult.records[0];

            // Step 2: Get all definitions in the bundle
            const defQuery = `SELECT Id, DefType, Format, Source
                             FROM AuraDefinition
                             WHERE AuraDefinitionBundleId = '${bundle.Id}'`;
            const defResult = await window.apiClient.toolingQuery(defQuery);

            const files = (defResult.records || []).map(r => {
                const fileInfo = this._mapAuraDefTypeToFile(r.DefType, bundle.DeveloperName);
                return {
                    id: r.Id,
                    defType: r.DefType,
                    path: `aura/${bundle.DeveloperName}/${fileInfo.fileName}`,
                    fileName: fileInfo.fileName,
                    extension: fileInfo.extension,
                    source: r.Source || '',
                    format: r.Format
                };
            });

            // Sort files by type (markup first, then JS, CSS, etc.)
            files.sort((a, b) => {
                const order = { 'cmp': 1, 'app': 1, 'intf': 1, 'evt': 1, 'tokens': 1, 'js': 2, 'css': 3, 'design': 4, 'auradoc': 5, 'svg': 6 };
                return (order[a.extension] || 99) - (order[b.extension] || 99);
            });

            return {
                success: true,
                type: this.SUPPORTED_TYPES.AURA,
                id: bundle.Id,
                name: bundle.DeveloperName,
                files: files,
                metadata: {
                    apiVersion: bundle.ApiVersion,
                    description: bundle.Description,
                    lastModified: bundle.LastModifiedDate,
                    lastModifiedBy: bundle.LastModifiedBy?.Name || 'Unknown',
                    fileCount: files.length
                }
            };
        } catch (error) {
            console.error(`[FetchLatest] Failed to fetch Aura Bundle '${name}':`, error);
            throw error;
        }
    },

    /**
     * Map Aura DefType to file name and extension
     * @private
     */
    _mapAuraDefTypeToFile(defType, bundleName) {
        const mapping = {
            'COMPONENT': { suffix: '', extension: 'cmp' },
            'APPLICATION': { suffix: '', extension: 'app' },
            'INTERFACE': { suffix: '', extension: 'intf' },
            'EVENT': { suffix: '', extension: 'evt' },
            'TOKENS': { suffix: '', extension: 'tokens' },
            'CONTROLLER': { suffix: 'Controller', extension: 'js' },
            'HELPER': { suffix: 'Helper', extension: 'js' },
            'RENDERER': { suffix: 'Renderer', extension: 'js' },
            'STYLE': { suffix: '', extension: 'css' },
            'DESIGN': { suffix: '', extension: 'design' },
            'DOCUMENTATION': { suffix: '', extension: 'auradoc' },
            'SVG': { suffix: '', extension: 'svg' }
        };

        const info = mapping[defType] || { suffix: '', extension: 'txt' };
        return {
            fileName: `${bundleName}${info.suffix}.${info.extension}`,
            extension: info.extension
        };
    },

    /**
     * Sanitize name to prevent SOQL injection
     * @private
     */
    _sanitizeName(name) {
        return name.replace(/'/g, "\\'").replace(/\\/g, '\\\\');
    },

    /**
     * Detect metadata type from file path or context
     * @param {string} path - File path or name
     * @param {string} contextType - Current metadata type context (optional)
     * @returns {string|null} - Detected type or null
     */
    detectType(path, contextType = null) {
        if (!path) return contextType;

        const lowerPath = path.toLowerCase();

        // Direct extension detection
        if (lowerPath.endsWith('.cls')) return this.SUPPORTED_TYPES.APEX_CLASS;
        if (lowerPath.endsWith('.trigger')) return this.SUPPORTED_TYPES.APEX_TRIGGER;

        // LWC folder detection
        if (lowerPath.includes('/lwc/') || lowerPath.startsWith('lwc/')) {
            return this.SUPPORTED_TYPES.LWC;
        }

        // Aura folder detection
        if (lowerPath.includes('/aura/') || lowerPath.startsWith('aura/')) {
            return this.SUPPORTED_TYPES.AURA;
        }

        // Fallback to context type
        return contextType;
    },

    /**
     * Check if a metadata type is supported for fetch
     * @param {string} type - Metadata type
     * @returns {boolean}
     */
    isSupported(type) {
        return Object.values(this.SUPPORTED_TYPES).includes(type);
    },

    /**
     * Main entry point - Fetch latest based on type
     * @param {string} type - Metadata type (ApexClass, ApexTrigger, LWC, AuraDefinitionBundle)
     * @param {string} name - Item name
     * @returns {Promise<object>} - Fetch result
     */
    async fetch(type, name) {
        switch (type) {
            case this.SUPPORTED_TYPES.APEX_CLASS:
                return this.fetchApexClass(name);
            case this.SUPPORTED_TYPES.APEX_TRIGGER:
                return this.fetchApexTrigger(name);
            case this.SUPPORTED_TYPES.LWC:
                return this.fetchLwcBundle(name);
            case this.SUPPORTED_TYPES.AURA:
                return this.fetchAuraBundle(name);
            default:
                throw new Error(`Unsupported metadata type: ${type}`);
        }
    }
};

// Export to window
window.FetchLatestService = FetchLatestService;
