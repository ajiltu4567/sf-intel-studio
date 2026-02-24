/**
 * SF-Intel Studio - Schema Manager (Sandbox Version)
 * Handles dynamic fetching and caching of SObject and field metadata via Bridge.
 * Provides SchemaCache-compatible API for SOQL autocomplete modules.
 */

window.SchemaManager = {
    globalDescribe: null,
    sobjectCache: {}, // { SObjectName: { label, fields: [...] } }
    pendingRequests: {}, // { id -> resolvePromise }

    /**
     * Fetches all objects in the Org (Global Describe)
     */
    init: function () {
        if (this.globalDescribe) return;
        console.log('[SF-Intel Schema] Initializing Global Describe via Bridge...');
        window.parent.postMessage({ type: 'GET_GLOBAL_DESCRIBE' }, window.location.origin);
    },

    /**
     * Gets describe metadata for a specific object, fetching if not cached.
     */
    describeSObject: async function (sobjectName) {
        if (!sobjectName) return null;

        // Return from cache if available
        if (this.sobjectCache[sobjectName]) {
            return this.sobjectCache[sobjectName];
        }

        return new Promise((resolve) => {
            const requestId = `describe-${sobjectName}`;
            this.pendingRequests[requestId] = resolve;

            console.log(`[SF-Intel Schema] Requesting describe for ${sobjectName} via Bridge...`);
            window.parent.postMessage({ type: 'DESCRIBE_SOBJECT', sobjectName }, window.location.origin);

            // Timeout safety
            setTimeout(() => {
                if (this.pendingRequests[requestId]) {
                    delete this.pendingRequests[requestId];
                    resolve(null);
                }
            }, 5000);
        });
    },

    /**
     * SchemaCache-compatible: Get list of all queryable objects
     */
    getObjectList: async function () {
        if (this.globalDescribe) return this.globalDescribe;

        return new Promise((resolve) => {
            this.pendingRequests['objectList'] = resolve;
            window.parent.postMessage({ type: 'GET_GLOBAL_DESCRIBE' }, window.location.origin);

            setTimeout(() => {
                if (this.pendingRequests['objectList']) {
                    delete this.pendingRequests['objectList'];
                    resolve(this.globalDescribe || []);
                }
            }, 5000);
        });
    },

    /**
     * SchemaCache-compatible: Get fields for an object
     */
    getFields: async function (objectName) {
        const describe = await this.describeSObject(objectName);
        return describe?.fields || [];
    },

    /**
     * SchemaCache-compatible: Resolve a relationship path (e.g., "Owner.Name")
     * Returns fields of the target object at the end of the path
     */
    resolveRelationshipPath: async function (rootObject, path) {
        const parts = path.split('.');
        let currentObject = rootObject;

        // Walk each segment except the last (which is the field being completed)
        for (const part of parts.slice(0, -1)) {
            const describe = await this.describeSObject(currentObject);
            if (!describe || !describe.fields) break;

            const relField = describe.fields.find(f =>
                f.relationshipName && f.relationshipName.toLowerCase() === part.toLowerCase()
            );

            if (relField && relField.referenceTo && relField.referenceTo.length > 0) {
                currentObject = relField.referenceTo[0];
            } else {
                break;
            }
        }

        return this.getFields(currentObject);
    },

    /**
     * SchemaCache-compatible: Search fields by partial name match
     */
    searchFields: async function (objectName, query) {
        const fields = await this.getFields(objectName);
        if (!query) return fields;
        const lower = query.toLowerCase();
        return fields.filter(f => f.name.toLowerCase().includes(lower));
    },

    /**
     * SchemaCache-compatible: Get relationship target object
     */
    getRelationshipTarget: async function (objectName, relationshipName) {
        const describe = await this.describeSObject(objectName);
        if (!describe || !describe.fields) return null;

        const relField = describe.fields.find(f =>
            f.relationshipName && f.relationshipName.toLowerCase() === relationshipName.toLowerCase()
        );

        return relField?.referenceTo?.[0] || null;
    },

    /**
     * Handle results returned from the main IDE window
     */
    handleBridgeResult: function (msg) {
        if (msg.type === 'GLOBAL_DESCRIBE_RESULT') {
            if (msg.result && msg.result.sobjects) {
                this.globalDescribe = msg.result.sobjects
                    .filter(obj => obj.queryable)
                    .map(obj => ({
                        name: obj.name,
                        apiName: obj.name,
                        label: obj.label,
                        custom: obj.custom,
                        isCustom: obj.custom,
                        keyPrefix: obj.keyPrefix
                    }));
                console.log(`[SF-Intel Schema] Cached ${this.globalDescribe.length} objects.`);

                // Resolve pending objectList request
                if (this.pendingRequests['objectList']) {
                    this.pendingRequests['objectList'](this.globalDescribe);
                    delete this.pendingRequests['objectList'];
                }
            }
        } else if (msg.type === 'DESCRIBE_RESULT') {
            const sobjectName = msg.sobjectName;
            if (msg.result && msg.result.fields) {
                const describe = {
                    name: msg.result.name,
                    label: msg.result.label,
                    fields: msg.result.fields.map(f => ({
                        name: f.name,
                        apiName: f.name,
                        label: f.label,
                        type: f.type,
                        custom: f.custom,
                        isCustom: f.custom,
                        length: f.length,
                        precision: f.precision,
                        scale: f.scale,
                        nillable: f.nillable,
                        isNillable: f.nillable,
                        createable: f.createable,
                        updateable: f.updateable,
                        relationshipName: f.relationshipName,
                        referenceTo: f.referenceTo,
                        isRelationship: !!(f.relationshipName && f.referenceTo && f.referenceTo.length > 0),
                        picklistValues: f.picklistValues
                    }))
                };
                this.sobjectCache[sobjectName] = describe;

                const requestId = `describe-${sobjectName}`;
                if (this.pendingRequests[requestId]) {
                    this.pendingRequests[requestId](describe);
                    delete this.pendingRequests[requestId];
                }
            }
        }
    },

    /**
     * Returns list of object names matching a prefix
     */
    searchObjects: function (prefix) {
        if (!this.globalDescribe) return [];
        const lowerPrefix = prefix.toLowerCase();
        return this.globalDescribe
            .filter(obj => obj.name.toLowerCase().startsWith(lowerPrefix))
            .map(obj => obj.name);
    },

    /**
     * Check if the schema manager is ready (has apiClient connection)
     */
    isReady: function () {
        return true; // Always ready since we use bridge
    }
};

// Expose as SchemaCache for compatibility with soql-parser.js and soql-autocomplete.js
if (!window.SchemaCache) {
    window.SchemaCache = window.SchemaManager;
}
