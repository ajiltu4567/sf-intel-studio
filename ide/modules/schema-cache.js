/**
 * SF-Intel Studio - Schema Cache Module
 * Caches Salesforce object/field metadata for SOQL autocomplete
 * 
 * @module SchemaCache
 */

const SchemaCache = {
    // Cache storage
    _objectCache: new Map(),      // objectName -> { fields, relationships, timestamp }
    _objectListCache: null,       // List of all sObjects
    _objectListTimestamp: 0,
    
    // Cache TTL (5 minutes)
    TTL: 300000,
    
    // Common standard objects for priority
    PRIORITY_OBJECTS: [
        'Account', 'Contact', 'Lead', 'Opportunity', 'Case', 'Task', 'Event',
        'User', 'Profile', 'PermissionSet', 'ContentDocument', 'Attachment',
        'Campaign', 'CampaignMember', 'Product2', 'PricebookEntry', 'Order',
        'Contract', 'Quote', 'Asset', 'Solution', 'Report', 'Dashboard'
    ],

    /**
     * Get list of all sObjects in the org
     * @returns {Promise<Array<{name: string, label: string, isCustom: boolean}>>}
     */
    async getObjectList() {
        // Check cache
        if (this._objectListCache && Date.now() - this._objectListTimestamp < this.TTL) {
            return this._objectListCache;
        }

        try {
            // Use window.apiClient (exposed by IDE)
            if (!window.apiClient?.getGlobalDescribe) {
                console.warn('[SchemaCache] apiClient not available');
                return [];
            }
            const result = await window.apiClient.getGlobalDescribe();
            
            if (result && result.sobjects) {
                this._objectListCache = result.sobjects
                    .filter(obj => obj.queryable)
                    .map(obj => ({
                        name: obj.name,
                        label: obj.label,
                        isCustom: obj.custom,
                        keyPrefix: obj.keyPrefix
                    }))
                    .sort((a, b) => {
                        // Priority objects first
                        const aPriority = this.PRIORITY_OBJECTS.indexOf(a.name);
                        const bPriority = this.PRIORITY_OBJECTS.indexOf(b.name);
                        if (aPriority !== -1 && bPriority === -1) return -1;
                        if (bPriority !== -1 && aPriority === -1) return 1;
                        if (aPriority !== -1 && bPriority !== -1) return aPriority - bPriority;
                        // Then standard before custom
                        if (!a.isCustom && b.isCustom) return -1;
                        if (a.isCustom && !b.isCustom) return 1;
                        return a.name.localeCompare(b.name);
                    });
                this._objectListTimestamp = Date.now();
            }
            
            return this._objectListCache || [];
        } catch (error) {
            console.error('[SchemaCache] Failed to fetch object list:', error);
            return this._objectListCache || [];
        }
    },

    /**
     * Get fields for an object
     * @param {string} objectName - API name of the object
     * @returns {Promise<Array<FieldDescriptor>>}
     */
    async getFields(objectName) {
        if (!objectName) return [];
        
        const normalized = objectName.trim();
        const cached = this._objectCache.get(normalized);
        
        if (cached && Date.now() - cached.timestamp < this.TTL) {
            return cached.fields;
        }

        try {
            if (!window.apiClient?.describeSObject) {
                console.warn('[SchemaCache] apiClient not available');
                return [];
            }
            const result = await window.apiClient.describeSObject(normalized);
            
            if (result && result.fields) {
                const fields = result.fields.map(f => ({
                    apiName: f.name,
                    label: f.label,
                    type: f.type,
                    length: f.length,
                    precision: f.precision,
                    scale: f.scale,
                    isCustom: f.custom,
                    isNillable: f.nillable,
                    isCreateable: f.createable,
                    isUpdateable: f.updateable,
                    isRelationship: f.type === 'reference',
                    isMasterDetail: f.type === 'reference' && !f.nillable,
                    relationshipName: f.relationshipName,
                    referenceTo: f.referenceTo && f.referenceTo.length > 0 ? f.referenceTo[0] : null,
                    picklistValues: f.picklistValues || []
                }));

                // Sort: Id first, then Name, then standard, then custom
                fields.sort((a, b) => {
                    if (a.apiName === 'Id') return -1;
                    if (b.apiName === 'Id') return 1;
                    if (a.apiName === 'Name') return -1;
                    if (b.apiName === 'Name') return 1;
                    if (!a.isCustom && b.isCustom) return -1;
                    if (a.isCustom && !b.isCustom) return 1;
                    return a.apiName.localeCompare(b.apiName);
                });

                // Build relationships map
                const relationships = {};
                result.fields
                    .filter(f => f.type === 'reference' && f.relationshipName)
                    .forEach(f => {
                        relationships[f.relationshipName] = {
                            fieldName: f.name,
                            targetObject: f.referenceTo && f.referenceTo[0]
                        };
                    });

                // Also add child relationships
                const childRelationships = (result.childRelationships || [])
                    .filter(cr => cr.relationshipName)
                    .map(cr => ({
                        name: cr.relationshipName,
                        childObject: cr.childSObject,
                        field: cr.field,
                        cascadeDelete: cr.cascadeDelete || false
                    }));

                this._objectCache.set(normalized, {
                    fields,
                    relationships,
                    childRelationships,
                    timestamp: Date.now()
                });

                return fields;
            }
            
            return [];
        } catch (error) {
            console.error(`[SchemaCache] Failed to describe ${objectName}:`, error);
            // Return cached even if expired
            return cached ? cached.fields : [];
        }
    },

    /**
     * Get relationship target object
     * @param {string} objectName - Current object
     * @param {string} relationshipName - Relationship name (e.g., 'Owner', 'Account')
     * @returns {Promise<string|null>}
     */
    async getRelationshipTarget(objectName, relationshipName) {
        await this.getFields(objectName); // Ensure cache is populated
        const cached = this._objectCache.get(objectName);
        
        if (cached && cached.relationships && cached.relationships[relationshipName]) {
            return cached.relationships[relationshipName].targetObject;
        }
        
        return null;
    },

    /**
     * Resolve a dot-notation path to get fields
     * e.g., "Account.Owner" -> User fields
     * @param {string} rootObject - Root object (FROM clause)
     * @param {string} path - Dot-separated path
     * @returns {Promise<Array<FieldDescriptor>>}
     */
    async resolveRelationshipPath(rootObject, path) {
        if (!path || !rootObject) return [];
        
        const parts = path.split('.');
        let currentObject = rootObject;
        
        // Traverse relationships except the last part
        for (let i = 0; i < parts.length; i++) {
            const targetObject = await this.getRelationshipTarget(currentObject, parts[i]);
            if (!targetObject) {
                console.warn(`[SchemaCache] Could not resolve relationship: ${parts[i]} on ${currentObject}`);
                return [];
            }
            currentObject = targetObject;
        }
        
        // Return fields of final object
        return this.getFields(currentObject);
    },

    /**
     * Search fields by partial name
     * @param {string} objectName 
     * @param {string} query 
     * @returns {Promise<Array<FieldDescriptor>>}
     */
    async searchFields(objectName, query) {
        const fields = await this.getFields(objectName);
        if (!query) return fields;
        
        const q = query.toLowerCase();
        
        return fields
            .filter(f => 
                f.apiName.toLowerCase().includes(q) || 
                f.label.toLowerCase().includes(q)
            )
            .sort((a, b) => {
                // Exact prefix match first
                const aStartsWith = a.apiName.toLowerCase().startsWith(q);
                const bStartsWith = b.apiName.toLowerCase().startsWith(q);
                if (aStartsWith && !bStartsWith) return -1;
                if (!aStartsWith && bStartsWith) return 1;
                // Then by position of match
                const aIndex = a.apiName.toLowerCase().indexOf(q);
                const bIndex = b.apiName.toLowerCase().indexOf(q);
                return aIndex - bIndex;
            });
    },

    /**
     * Check if API client is available
     * @returns {boolean}
     */
    isReady() {
        return !!window.apiClient?.getGlobalDescribe;
    },

    /**
     * Clear all cached data
     */
    clearCache() {
        this._objectCache.clear();
        this._objectListCache = null;
        this._objectListTimestamp = 0;
        console.log('[SchemaCache] Cache cleared');
    },

    /**
     * Clear cache for specific object
     * @param {string} objectName 
     */
    clearObjectCache(objectName) {
        this._objectCache.delete(objectName);
    }
};

window.SchemaCache = SchemaCache;
