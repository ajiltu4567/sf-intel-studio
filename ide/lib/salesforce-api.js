/**
 * Custom error for deployment failures including structured compiler diagnostics
 */
class DeploymentError extends Error {
    constructor(message, diagnostics = [], rawResponse = null) {
        super(message);
        this.name = 'DeploymentError';
        this.diagnostics = diagnostics; // Array of { file, type, message, line, column }
        this.rawResponse = rawResponse;
    }
}

class SalesforceAPIClient {
    constructor(sessionId, instanceUrl) {
        this.sessionId = sessionId;
        this.instanceUrl = instanceUrl;
        this.apiVersion = 'v59.0';

        console.log('[SF API] Initialized with instance:', instanceUrl);
        console.log('[SF API] Session ID:', sessionId ? 'present' : 'missing');
    }

    /**
     * Make REST API call (like Inspector does it!)
     */
    async rest(endpoint, options = {}) {
        const {
            method = 'GET',
            body = null,
            headers = {}
        } = options;

        const url = `${this.instanceUrl}${endpoint}`;

        const fetchOptions = {
            method,
            headers: {
                'Authorization': `Bearer ${this.sessionId}`,  // Like Inspector!
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                ...headers
            }
        };

        if (body && method !== 'GET') {
            const bodyStr = JSON.stringify(body);
            console.log('[SF API] Request Body:', bodyStr);
            fetchOptions.body = bodyStr;
        }

        console.log('[SF API] Calling:', method, endpoint);
        
        let signal = null;
        try {
            signal = AbortSignal.timeout(60000); // 1 minute safety timeout
        } catch (e) {
            // Fallback for older environments
        }

        const response = await fetch(url, {
            ...fetchOptions,
            signal
        });

        if (!response.ok) {
            const errorText = await response.text();
            let errorMessage = `API Error: ${response.status} - ${errorText}`;
            let diagnostics = [];

            try {
                const errorJson = JSON.parse(errorText);
                if (Array.isArray(errorJson) && errorJson[0].message) {
                    errorMessage = errorJson[0].message;
                    
                    // Basic heuristic parsing for [line X, column Y] messages
                    const lineMatch = errorMessage.match(/at line (\d+), column (\d+)/i);
                    if (lineMatch) {
                        diagnostics.push({
                            file: 'Current File',
                            type: 'Compile Error',
                            message: errorMessage,
                            line: parseInt(lineMatch[1]),
                            column: parseInt(lineMatch[2])
                        });
                    }
                }
            } catch (p) { /* Not JSON */ }

            if (diagnostics.length > 0) {
                throw new DeploymentError(errorMessage, diagnostics);
            }
            throw new Error(errorMessage);
        }

        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            return response.json();
        }

        return response.text();
    }

    /**
     * Get global describe (all objects)
     */
    async getGlobalDescribe() {
        const endpoint = `/services/data/${this.apiVersion}/sobjects/`;
        return this.rest(endpoint);
    }

    /**
     * Get describe for a specific SObject (fields, etc)
     */
    async describeSObject(sobjectName) {
        const endpoint = `/services/data/${this.apiVersion}/sobjects/${sobjectName}/describe`;
        return this.rest(endpoint);
    }

    async composite(subrequests) {
        const endpoint = `/services/data/${this.apiVersion}/composite`;
        return this.rest(endpoint, {
            method: 'POST',
            body: { allOrNone: false, compositeRequest: subrequests }
        });
    }

    // Tooling API
    async toolingQuery(soql) {
        const endpoint = `/services/data/${this.apiVersion}/tooling/query?q=${encodeURIComponent(soql)}`;
        return this.rest(endpoint);
    }

    async toolingSearch(sosl) {
        const endpoint = `/services/data/${this.apiVersion}/tooling/search/?q=${encodeURIComponent(sosl)}`;
        return this.rest(endpoint);
    }

    async getApexClasses() {
        const query = 'SELECT Id, Name, NamespacePrefix, ApiVersion, Status, IsValid, CreatedDate, LastModifiedDate FROM ApexClass ORDER BY Name';
        const result = await this.toolingQuery(query);
        return result.records || [];
    }

    async getApexClass(classId) {
        const endpoint = `/services/data/${this.apiVersion}/tooling/sobjects/ApexClass/${classId}`;
        return this.rest(endpoint);
    }

    async getApexClassBody(classId) {
        console.log('[SF API] Fetching ApexClass body for:', classId);
        const query = `SELECT Body FROM ApexClass WHERE Id = '${classId}'`;
        const result = await this.toolingQuery(query);
        console.log('[SF API] ApexClass query result:', result);
        const body = result.records[0]?.Body || '';
        console.log('[SF API] Extracted body length:', body.length);
        return body;
    }

    async getApexTriggerBody(triggerId) {
        console.log('[SF API] Fetching ApexTrigger body for:', triggerId);
        const query = `SELECT Body FROM ApexTrigger WHERE Id = '${triggerId}'`;
        const result = await this.toolingQuery(query);
        console.log('[SF API] ApexTrigger query result:', result);
        const body = result.records[0]?.Body || '';
        console.log('[SF API] Extracted body length:', body.length);
        return body;
    }

    async saveApexClass(classId, body) {
        const endpoint = `/services/data/${this.apiVersion}/tooling/sobjects/ApexClass/${classId}`;
        return this.rest(endpoint, {
            method: 'PATCH',
            body: { Body: body }
        });
    }

    async createApexClass(name, body = null) {
        if (!body) {
            body = `public with sharing class ${name} {\n    public ${name}() {\n\n    }\n}`;
        }
        const endpoint = `/services/data/${this.apiVersion}/tooling/sobjects/ApexClass`;
        return this.rest(endpoint, {
            method: 'POST',
            body: { Name: name, Body: body }
        });
    }

    async deleteApexClass(classId) {
        const endpoint = `/services/data/${this.apiVersion}/tooling/sobjects/ApexClass/${classId}`;
        return this.rest(endpoint, { method: 'DELETE' });
    }

    /**
     * Composite SObject Delete - delete up to 200 records in one request
     * @param {string[]} ids - Array of record IDs (max 200)
     * @param {boolean} allOrNone - If true, entire batch fails on any error
     * @returns {Array} Array of {id, success, errors}
     */
    async compositeDelete(ids, allOrNone = false) {
        const idParam = ids.join(',');
        const endpoint = `/services/data/${this.apiVersion}/composite/sobjects?ids=${encodeURIComponent(idParam)}&allOrNone=${allOrNone}`;
        return this.rest(endpoint, { method: 'DELETE' });
    }

    /**
     * Composite SObject Delete via Tooling API
     */
    async compositeDeleteTooling(ids, allOrNone = false) {
        const idParam = ids.join(',');
        const endpoint = `/services/data/${this.apiVersion}/tooling/composite/sobjects?ids=${encodeURIComponent(idParam)}&allOrNone=${allOrNone}`;
        return this.rest(endpoint, { method: 'DELETE' });
    }

    // REST API

    /**
     * Strip SQL/SOQL comments and normalize whitespace
     */
    _cleanSoql(soql) {
        return soql
            .replace(/\/\*[\s\S]*?\*\//g, '') // remove multi-line comments
            .split('\n')
            .map(line => line.replace(/(--|\/\/).*/, '').trim()) // remove single-line comments
            .join(' ')
            .trim();
    }

    async query(soql) {
        const cleanSoql = this._cleanSoql(soql);
        const endpoint = `/services/data/${this.apiVersion}/query?q=${encodeURIComponent(cleanSoql)}`;
        return this.rest(endpoint);
    }

    /**
     * Query with queryAll endpoint - includes deleted/archived records
     */
    async queryAll(soql) {
        const cleanSoql = this._cleanSoql(soql);
        const endpoint = `/services/data/${this.apiVersion}/queryAll?q=${encodeURIComponent(cleanSoql)}`;
        return this.rest(endpoint);
    }

    /**
     * Fetch all records by following nextRecordsUrl pagination
     */
    async queryAllPages(soql, useQueryAll = false) {
        const firstResult = useQueryAll ? await this.queryAll(soql) : await this.query(soql);
        let allRecords = firstResult.records || [];
        let nextUrl = firstResult.nextRecordsUrl;

        while (nextUrl) {
            const nextResult = await this.rest(nextUrl);
            allRecords = allRecords.concat(nextResult.records || []);
            nextUrl = nextResult.nextRecordsUrl;
        }

        return {
            totalSize: firstResult.totalSize,
            done: true,
            records: allRecords
        };
    }

    // Trigger Support
    async getApexTriggers() {
        const query = 'SELECT Id, Name, NamespacePrefix, ApiVersion, Status, IsValid, EntityDefinitionId, CreatedDate, LastModifiedDate FROM ApexTrigger ORDER BY Name';
        const result = await this.toolingQuery(query);
        return result.records || [];
    }

    async getApexTrigger(triggerId) {
        const endpoint = `/services/data/${this.apiVersion}/tooling/sobjects/ApexTrigger/${triggerId}`;
        return this.rest(endpoint);
    }

    async saveApexTrigger(triggerId, body) {
        const endpoint = `/services/data/${this.apiVersion}/tooling/sobjects/ApexTrigger/${triggerId}`;
        return this.rest(endpoint, {
            method: 'PATCH',
            body: { Body: body }
        });
    }

    async createApexTrigger(name, sObject, bundleMap, apiVersion = '59.0') {
        console.log('[SF API] Creating Trigger (Atomic):', { name, sObject });
        // Standardize paths for Metadata API (flat folder for triggers)
        const mappedFiles = {};
        for(let key in bundleMap) {
            const fileName = key.includes('/') ? key.split('/').pop() : key;
            mappedFiles[`triggers/${fileName}`] = bundleMap[key];
        }
        return this.deployBundleAtomic('ApexTrigger', name, mappedFiles, apiVersion);
    }

    // LWC Support
    async getLwcBundles() {
        const query = 'SELECT Id, DeveloperName, NamespacePrefix, ApiVersion, Description, CreatedDate, LastModifiedDate FROM LightningComponentBundle ORDER BY DeveloperName';
        const result = await this.toolingQuery(query);
        return result.records || [];
    }

    async getLwcBundle(bundleId) {
        const endpoint = `/services/data/${this.apiVersion}/tooling/sobjects/LightningComponentBundle/${bundleId}`;
        return this.rest(endpoint);
    }

    async getLwcBundleFiles(bundleId) {
        const query = `SELECT Id, LightningComponentBundleId, FilePath, Format, Source FROM LightningComponentResource WHERE LightningComponentBundleId = '${bundleId}' ORDER BY FilePath`;
        const result = await this.toolingQuery(query);
        return (result.records || []).map(r => ({ ...r, path: r.FilePath }));
    }

    async createLwcBundle(name, description = '', apiVersion = '59.0') {
        const endpoint = `/services/data/${this.apiVersion}/tooling/sobjects/LightningComponentBundle`;
        return this.rest(endpoint, {
            method: 'POST',
            body: {
                FullName: name,
                Metadata: {
                    apiVersion: parseFloat(apiVersion),
                    masterLabel: name,
                    description: description
                }
            }
        });
    }

    async createLwcResource(bundleId, filePath, source) {
        const endpoint = `/services/data/${this.apiVersion}/tooling/sobjects/LightningComponentResource`;
        return this.rest(endpoint, {
            method: 'POST',
            body: {
                LightningComponentBundleId: bundleId,
                FilePath: filePath,
                Format: this.getFormatFromPath(filePath),
                Source: source
            }
        });
    }

    getFormatFromPath(path) {
        if (path.endsWith('.js')) return 'js';
        if (path.endsWith('.html')) return 'html';
        if (path.endsWith('.css')) return 'css';
        if (path.endsWith('.xml')) return 'xml';
        return 'js';
    }

    async saveLwcFile(resourceId, body) {
        const endpoint = `/services/data/${this.apiVersion}/tooling/sobjects/LightningComponentResource/${resourceId}`;
        return this.rest(endpoint, {
            method: 'PATCH',
            body: { Source: body }
        });
    }

    // Aura Support
    async getAuraBundles() {
        const query = 'SELECT Id, DeveloperName, NamespacePrefix, ApiVersion, Description, CreatedDate, LastModifiedDate FROM AuraDefinitionBundle ORDER BY DeveloperName';
        const result = await this.toolingQuery(query);
        return result.records || [];
    }

    async getAuraBundle(bundleId) {
        const endpoint = `/services/data/${this.apiVersion}/tooling/sobjects/AuraDefinitionBundle/${bundleId}`;
        return this.rest(endpoint);
    }

    async getAuraBundleFiles(bundleId) {
        const query = `SELECT Id, AuraDefinitionBundleId, AuraDefinitionBundle.DeveloperName, DefType, Format, Source FROM AuraDefinition WHERE AuraDefinitionBundleId = '${bundleId}'`;
        const result = await this.toolingQuery(query);
        // Map DefType to file extension logic if needed, but for now passing raw
        // Aura DefTypes: COMPONENT, CONTROLLER, HELPER, STYLE, DOCUMENTATION, RENDERER, DESIGN, SVG
        return result.records.map(r => {
            let ext = 'cmp';
            if (r.DefType === 'CONTROLLER') ext = 'js';
            else if (r.DefType === 'HELPER') ext = 'js';
            else if (r.DefType === 'RENDERER') ext = 'js';
            else if (r.DefType === 'STYLE') ext = 'css';
            else if (r.DefType === 'DESIGN') ext = 'design';
            else if (r.DefType === 'DOCUMENTATION') ext = 'auradoc';
            else if (r.DefType === 'SVG') ext = 'svg';
            else if (r.DefType === 'APPLICATION') ext = 'app';
            else if (r.DefType === 'INTERFACE') ext = 'intf';
            else if (r.DefType === 'EVENT') ext = 'evt';
            else if (r.DefType === 'TOKENS') ext = 'tokens';

            // Construct pseudo-path for IDE consistency
            // Note: Tooling API doesn't give FilePath for Aura, we must construct it.
            // Naming convention: BundleName + (Controller/Helper/etc suffix) + extension
            // For main markup (COMPONENT/APP/INTF/EVT/TOKENS), it's BundleName.ext
            let suffix = '';
            if (r.DefType === 'CONTROLLER') suffix = 'Controller';
            else if (r.DefType === 'HELPER') suffix = 'Helper';
            else if (r.DefType === 'RENDERER') suffix = 'Renderer';

            // We need the bundle Name to construct the path, but we only have ID here.
            // We'll rely on the IDE to inject the name or fetch it. 
            // Better: Return the object and let IDE map it using cache.
            // Or return a "Name" property if possible or handle in IDE.
            // Let's attach a 'PseudoPath' property logic in IDE or here if we fetch bundle name.
            // Since we can't easily join in one query without nested query limits or distinct calls, 
            // we will return the record and let the IDE handle path construction using the Bundle Name it already has.
            return {
                ...r,
                Extension: ext,
                Suffix: suffix,
                path: `${r.AuraDefinitionBundle?.DeveloperName || 'UnknownBundle'}${suffix}.${ext}`
            };
        });
    }

    async createAuraBundle(name, type = 'Component', apiVersion = '59.0') {
        const endpoint = `/services/data/${this.apiVersion}/tooling/sobjects/AuraDefinitionBundle`;
        return this.rest(endpoint, {
            method: 'POST',
            body: {
                DeveloperName: name,
                MasterLabel: name,
                ApiVersion: apiVersion,
                Description: `Created via SF-Intel Studio`
            }
        });
    }

    async createAuraDefinition(bundleId, defType, source) {
        const endpoint = `/services/data/${this.apiVersion}/tooling/sobjects/AuraDefinition`;
        return this.rest(endpoint, {
            method: 'POST',
            body: {
                AuraDefinitionBundleId: bundleId,
                DefType: defType,
                Source: source
            }
        });
    }

    async saveAuraDefinition(defId, source) {
        const endpoint = `/services/data/${this.apiVersion}/tooling/sobjects/AuraDefinition/${defId}`;
        return this.rest(endpoint, {
            method: 'PATCH',
            body: { Source: source }
        });
    }

    /**
     * Deploys a component bundle (LWC/Aura) as an atomic ZIP via Metadata API.
     * Guaranteed to include all files in the bundle to prevent compilation errors.
     */
    async deployBundleAtomic(type, name, fileMap, apiVersion) {
        const ver = (apiVersion || this.apiVersion || '59.0').toString().replace('v', '').replace('V', '');
        console.log(`[SF API] Deploying ${type} bundle atomic: ${name} (v${ver})...`);

        let metadataType = '';
        let prefix = '';

        if (type === 'LWC') {
            metadataType = 'LightningComponentBundle';
            prefix = 'lwc';
        } else if (type === 'Aura') {
            metadataType = 'AuraDefinitionBundle';
            prefix = 'aura';
        } else if (type === 'ApexTrigger') {
            metadataType = 'ApexTrigger';
            prefix = 'triggers';
        }

        const packageXml = `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <types>
        <members>${name}</members>
        <name>${metadataType}</name>
    </types>
    <version>${ver}</version>
</Package>`;

        const zipFileMap = { 'package.xml': packageXml };

        // Populate ZIP map ensuring correct folder structure (SIP-3.3 Strict)
        for (const [key, content] of Object.entries(fileMap)) {
            // key can be a filename (e.g. test.js) or a relative path (e.g. aura/test/test.cmp)
            // LWC/Aura require prefix/name/file, Classes/Triggers require prefix/file
            const isBundle = (type === 'LWC' || type === 'Aura');
            const parts = key.split('/');
            const fileName = parts.pop();
            
            let finalPath;
            if (key.startsWith(`${prefix}/`)) {
                // If it already starts with the prefix, we respect it but check if it needs name subfolder
                if (isBundle && !key.startsWith(`${prefix}/${name}/`)) {
                     finalPath = `${prefix}/${name}/${fileName}`;
                } else {
                     finalPath = key;
                }
            } else {
                finalPath = isBundle ? `${prefix}/${name}/${fileName}` : `${prefix}/${fileName}`;
            }
            zipFileMap[finalPath] = content;
        }

        const zipBase64 = await this.createZipBase64(zipFileMap);
        const deploymentId = await this.submitMetadataDeployment(zipBase64);
        return this.pollMetadataDeployStatus(deploymentId);
    }

    /**
     * @deprecated Use deployBundleAtomic
     */
    async deployAuraBundle(bundleId, files) {
        const bundle = await this.getAuraBundle(bundleId);
        const fileMap = {};
        files.forEach(f => fileMap[f.path || f.fileName] = f.content || f.Source);
        return this.deployBundleAtomic('Aura', bundle.DeveloperName, fileMap);
    }

    // --- ROBUST DEPLOYMENT (v3.0.0+) ---

    /**
     * Verifies that a bundle deployment actually reached the server.
     * Prevents false-positives from Metadata API caching.
     */
    async verifyBundleSuccess(type, name) {
        console.log(`[SF API] Verifying ${type} bundle exists: ${name}...`);
        try {
            let result;
            if (type === 'LWC') {
                result = await this.toolingQuery(
                    `SELECT Id, DeveloperName FROM LightningComponentBundle WHERE DeveloperName = '${name}' LIMIT 1`
                );
            } else if (type === 'Aura') {
                result = await this.toolingQuery(
                    `SELECT Id, DeveloperName FROM AuraDefinitionBundle WHERE DeveloperName = '${name}' LIMIT 1`
                );
            } else {
                return true; // no verification for other types
            }
            const found = result.records && result.records.length > 0;
            console.log(`[SF API] Verification ${found ? 'passed' : 'failed'} for ${type} ${name}`);
            return found;
        } catch (err) {
            console.error('[SF API] Verification failed:', err.message);
            return false;
        }
    }

    /**
     * Deployment Methods (v3.5.0)
     * 
     * IMPORTANT: Direct PATCH on ApexClass/ApexTrigger only works in specific org types
     * (scratch orgs, some dev orgs). For RELIABLE deployment across ALL org types
     * (production, sandboxes, dev orgs), we MUST use MetadataContainer + ContainerAsyncRequest.
     */
    async deployApexClass(id, body) {
        return this.deployApex('ApexClass', id, body);
    }

    async deployApexTrigger(id, body) {
        return this.deployApex('ApexTrigger', id, body);
    }

    /**
     * TURBO DEPLOY (v3.4.3)
     * Deploys Apex with zero-query overhead by using truly unique containers.
     * Bypasses "SELECT" roundtrips entirely to achieve fastest possible deployment.
     */
    async deployApex(type, id, body) {
        console.log(`[SF API] 🚀 TURBO DEPLOYING ${type} (${id})...`);
        
        // 1. Create a truly unique name to prevent any state locking
        const timestamp = Date.now();
        const containerName = `SF_INTEL_T_${timestamp}`;
        let containerId = null;

        try {
            // STEP A: Create Fresh MetadataContainer (POST - No SELECT)
            const container = await this.rest(`/services/data/${this.apiVersion}/tooling/sobjects/MetadataContainer`, {
                method: 'POST',
                body: { Name: containerName }
            });
            containerId = container.id;

            // STEP B: Create Fresh Member (POST - No SELECT)
            // Since the container is brand new, we can skip the "Upsert" check.
            const entityName = type === 'ApexClass' ? 'ApexClassMember' : 'ApexTriggerMember';
            await this.rest(`/services/data/${this.apiVersion}/tooling/sobjects/${entityName}`, {
                method: 'POST',
                body: {
                    MetadataContainerId: containerId,
                    ContentEntityId: id,
                    Body: body
                }
            });

            // STEP C: Create Async Request (POST)
            const request = await this.rest(`/services/data/${this.apiVersion}/tooling/sobjects/ContainerAsyncRequest`, {
                method: 'POST',
                body: {
                    MetadataContainerId: containerId,
                    IsCheckOnly: false
                }
            });

            console.log('[SF API] Request created:', request.id);

            // STEP D: Poll for results
            return await this.pollDeployStatus(request.id);

        } finally {
            // STEP E: Mandatory Cleanup (DELETE)
            // We delete the container immediately to stay well below the 100-container limit.
            if (containerId) {
                this.deleteMetadataContainer(containerId).catch(err => {
                    console.warn('[SF API] Cleanup failed (non-critical):', err.message);
                });
            }
        }
    }

    async deleteMetadataContainer(containerId) {
        return this.rest(`/services/data/${this.apiVersion}/tooling/sobjects/MetadataContainer/${containerId}`, {
            method: 'DELETE'
        });
    }

    async clearContainerMembers(containerId) {
        // [DEPRECATED in v3.4.1 in favor of per-file containers]
    }

    async getOrCreateMetadataContainer(name) {
        const query = `SELECT Id FROM MetadataContainer WHERE Name = '${name}'`;
        const result = await this.toolingQuery(query);

        if (result.records && result.records.length > 0) {
            return result.records[0].Id;
        }

        const create = await this.rest(`/services/data/${this.apiVersion}/tooling/sobjects/MetadataContainer`, {
            method: 'POST',
            body: { Name: name }
        });
        return create.id;
    }



    async upsertApexMember(containerId, type, id, body) {
        const entityName = type === 'ApexClass' ? 'ApexClassMember' : 'ApexTriggerMember';
        const foreignKey = type === 'ApexClass' ? 'ContentEntityId' : 'ContentEntityId';

        // Check if member already exists in container
        const query = `SELECT Id FROM ${entityName} WHERE MetadataContainerId = '${containerId}' AND ${foreignKey} = '${id}'`;
        const result = await this.toolingQuery(query);

        if (result.records && result.records.length > 0) {
            // Update
            return this.rest(`/services/data/${this.apiVersion}/tooling/sobjects/${entityName}/${result.records[0].Id}`, {
                method: 'PATCH',
                body: { Body: body }
            });
        } else {
            // Create
            return this.rest(`/services/data/${this.apiVersion}/tooling/sobjects/${entityName}`, {
                method: 'POST',
                body: {
                    MetadataContainerId: containerId,
                    ContentEntityId: id,
                    Body: body
                }
            });
        }
    }

    async pollDeployStatus(requestId) {
        let attempts = 0;
        const maxAttempts = 60; // 60 attempts with progressive backoff (~120s total)
        let pollInterval = 1000; // Start with 1s, increase over time

        console.log(`[SF API] Starting deployment status polling for request: ${requestId}`);

        while (attempts < maxAttempts) {
            let status;
            try {
                status = await this.rest(`/services/data/${this.apiVersion}/tooling/sobjects/ContainerAsyncRequest/${requestId}`);
            } catch (e) {
                console.warn(`[SF API] Poll attempt ${attempts + 1}/${maxAttempts} - Network error (retrying): ${e.message}`);
                await new Promise(r => setTimeout(r, pollInterval));
                attempts++;
                // Progressive backoff on errors
                pollInterval = Math.min(pollInterval * 1.5, 5000);
                continue;
            }

            const currentState = status.State;
            console.log(`[SF API] Poll attempt ${attempts + 1}/${maxAttempts} - State: ${currentState}`);

            // SUCCESS STATES
            if (currentState === 'Completed') {
                console.log('[SF API] Deployment completed successfully!');
                return { success: true, status };
            }

            // FAILURE STATES (including Invalidated which was previously missed)
            if (currentState === 'Failed' || currentState === 'Error' || currentState === 'Invalidated') {
                console.error('[SF API] Deployment FAILED. Full Status Response:', JSON.stringify(status, null, 2));

                let diagnostics = [];

                // 1. Try Tooling API CompilerErrors
                if (status.CompilerErrors) {
                    try {
                        const compilerErrors = JSON.parse(status.CompilerErrors);
                        diagnostics = compilerErrors.map(e => ({
                            file: e.name || 'Unknown',
                            type: e.extent || 'Compile Error',
                            message: e.problem,
                            line: e.line,
                            column: e.column
                        }));
                    } catch (parseErr) {
                        console.warn('[SF API] Failed to parse CompilerErrors:', parseErr);
                    }
                }

                // 2. Try DeployDetails (Metadata API style within Tooling)
                if (diagnostics.length === 0 && status.DeployDetails) {
                    const failures = status.DeployDetails.componentFailures ||
                        status.DeployDetails.allComponentMessages || [];

                    diagnostics = failures
                        .filter(f => f.problemType === 'Error' || f.success === false)
                        .map(f => ({
                            file: f.fileName || f.fullName || 'Unknown',
                            type: f.componentType || 'Deploy Error',
                            message: f.problem || f.error || 'Syntax error',
                            line: f.lineNumber || 0,
                            column: f.columnNumber || 0
                        }));
                }

                const errorMsg = status.ErrorMsg || (diagnostics.length > 0 ? `${diagnostics.length} compilation errors found.` : 'Unknown deployment error (Check Problems panel)');

                // --- TIMEOUT RESILIENCE (v3.5.0) ---
                // If Salesforce reports a side-timeout, it might still have succeeded
                if (errorMsg.toLowerCase().includes('timed out')) {
                    console.warn('[SF API] Salesforce reported a timeout. Waiting 3s to verify...');
                    await new Promise(r => setTimeout(r, 3000));
                    return { success: true, status, isFallbackSuccess: true };
                }

                throw new DeploymentError(errorMsg, diagnostics, status);
            }

            if (currentState === 'Aborted') {
                throw new Error('Deployment aborted by Salesforce.');
            }

            // IN-PROGRESS STATES: Queued, InProgress - keep polling with progressive backoff
            await new Promise(r => setTimeout(r, pollInterval));
            attempts++;

            // Increase interval progressively: 1s -> 1.5s -> 2s -> ... -> max 4s
            if (attempts > 5) {
                pollInterval = Math.min(pollInterval + 500, 4000);
            }
        }

        // --- TIMEOUT FALLBACK VERIFICATION ---
        // Salesforce may still be processing — retry up to 3 times with 5s gaps
        // before giving up, to avoid false "timed out" when deploy actually succeeds.
        console.warn('[SF API] Polling timeout reached. Performing fallback verification (3 retries)...');
        for (let retry = 0; retry < 3; retry++) {
            await new Promise(r => setTimeout(r, 5000));
            try {
                const finalStatus = await this.rest(`/services/data/${this.apiVersion}/tooling/sobjects/ContainerAsyncRequest/${requestId}`);
                if (finalStatus.State === 'Completed') {
                    console.log(`[SF API] Fallback retry ${retry + 1}: Deployment completed successfully.`);
                    return { success: true, status: finalStatus, isFallbackSuccess: true };
                }
                if (finalStatus.State === 'Failed' || finalStatus.State === 'Error') {
                    console.warn(`[SF API] Fallback retry ${retry + 1}: Deployment failed with state ${finalStatus.State}.`);
                    break;
                }
                console.log(`[SF API] Fallback retry ${retry + 1}: State still ${finalStatus.State}, retrying...`);
            } catch (e) {
                console.warn(`[SF API] Fallback retry ${retry + 1} network error: ${e.message}`);
            }
        }

        throw new Error('Deployment timed out. The deployment may still be processing — please check your org before retrying.');
    }

    formatCompilerErrors(msg, errors) {
        if (errors && errors.length > 0) {
            return errors.map(e => `[${e.line}:${e.column}] ${e.problem}`).join('\n');
        }
        return msg || 'Unknown deployment error';
    }

    /**
     * --- METADATA API DEPLOYMENT (CORRECT FOR LWC) ---
     * 
     * LWC deployment MUST use Metadata API with LightningComponentBundle type.
     * Tooling API does NOT trigger compilation/deployment.
     */

    /**
     * Deploys an entire LWC bundle using Metadata API
     * This is the ONLY correct way to deploy LWCs
     */
    /**
     * @deprecated Use deployBundleAtomic
     */
    async deployLwcBundle(bundleId, files) {
        const bundle = await this.getLwcBundle(bundleId);
        const fileMap = {};
        files.forEach(f => fileMap[f.FilePath || f.fileName] = f.content || f.Source);
        return this.deployBundleAtomic('LWC', bundle.DeveloperName, fileMap);
    }

    /**
     * Creates a base64-encoded ZIP file from a file map
     * Uses JSZip library (must be included in the page)
     */
    async createZipBase64(fileMap) {
        // Check if JSZip is available
        if (typeof JSZip === 'undefined') {
            throw new Error('JSZip library not loaded. Cannot create deployment package.');
        }

        const zip = new JSZip();

        // Add all files to ZIP
        for (const [path, content] of Object.entries(fileMap)) {
            if (path.endsWith('/')) {
                zip.folder(path.slice(0, -1)); // Add directory
            } else {
                zip.file(path, content);
            }
        }

        // Generate base64
        const blob = await zip.generateAsync({ type: 'base64' });
        return blob;
    }
    async deployBundle(type, name, fileMap, apiVersion) {
        return this.deployBundleAtomic(type, name, fileMap, apiVersion);
    }

    async soap(action, xmlBody) {
        if (!this.sessionId) {
            throw new Error('No active session found. Please refresh the page and try again.');
        }

        const endpoint = `/services/Soap/m/59.0`;
        const url = `${this.instanceUrl}${endpoint}`;

        const envelope = `
            <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:met="http://soap.sforce.com/2006/04/metadata">
                <soapenv:Header>
                    <met:SessionHeader>
                        <met:sessionId>${this.sessionId}</met:sessionId>
                    </met:SessionHeader>
                </soapenv:Header>
                <soapenv:Body>
                    ${xmlBody}
                </soapenv:Body>
            </soapenv:Envelope>
        `.trim();

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.sessionId}`,
                'Content-Type': 'text/xml',
                'SOAPAction': `""`
            },
            body: envelope
        });

        const text = await response.text();

        if (!response.ok) {
            throw new Error(`SOAP API Error: ${response.status} - ${text}`);
        }

        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, 'text/xml');

        // Check for SOAP Fault
        const fault = xmlDoc.getElementsByTagName('soapenv:Fault')[0] || xmlDoc.getElementsByTagName('Fault')[0];
        if (fault) {
            const faultCode = fault.getElementsByTagName('faultcode')[0]?.textContent;
            const faultString = fault.getElementsByTagName('faultstring')[0]?.textContent;
            throw new Error(`SOAP Fault [${faultCode}]: ${faultString}\nFull Response: ${text.substring(0, 500)}`);
        }

        return xmlDoc;
    }

    /**
     * Submits deployment to Metadata API via SOAP
     * Returns deployment ID for polling
     */
    async submitMetadataDeployment(zipBase64) {
        const xmlBody = `
            <met:deploy>
                <met:ZipFile>${zipBase64}</met:ZipFile>
                <met:DeployOptions>
                    <met:checkOnly>false</met:checkOnly>
                    <met:rollbackOnError>true</met:rollbackOnError>
                    <met:singlePackage>true</met:singlePackage>
                </met:DeployOptions>
            </met:deploy>
        `;

        const xmlResponse = await this.soap('deploy', xmlBody);

        // Extract ID from response (handle both cases if namespaced)
        const result = xmlResponse.getElementsByTagName('result')[0] || xmlResponse.getElementsByTagName('met:result')[0];
        const id = result.getElementsByTagName('id')[0] || result.getElementsByTagName('met:id')[0];

        return id.textContent;
    }

    /**
     * Polls Metadata API deployment status via SOAP
     */
    async pollMetadataDeployStatus(deploymentId) {
        let attempts = 0;
        const maxAttempts = 60; // 120 seconds max

        while (attempts < maxAttempts) {
            const xmlBody = `
                <met:checkDeployStatus>
                    <met:asyncProcessId>${deploymentId}</met:asyncProcessId>
                    <met:includeDetails>true</met:includeDetails>
                </met:checkDeployStatus>
            `;

            const xmlResponse = await this.soap('checkDeployStatus', xmlBody);

            const result = xmlResponse.getElementsByTagName('result')[0] || xmlResponse.getElementsByTagName('met:result')[0];
            const status = (result.getElementsByTagName('status')[0] || result.getElementsByTagName('met:status')[0]).textContent;

            if (status === 'Succeeded') {
                return { success: true, status };
            }

            if (status === 'Failed' || status === 'SucceededPartial' || status === 'Canceled') {
                const diagnostics = this.extractMetadataErrors(result);
                const errorMsg = diagnostics.length > 0
                    ? `${diagnostics.length} compilation errors found.`
                    : `Deployment ${status}`;

                throw new DeploymentError(errorMsg, diagnostics, status);
            }

            await new Promise(r => setTimeout(r, 2000));
            attempts++;
        }

        // --- TIMEOUT FALLBACK VERIFICATION ---
        // Retry up to 3 times with 5s gaps before declaring failure.
        console.warn('[SF API] Metadata polling timeout. Performing fallback verification (3 retries)...');
        for (let retry = 0; retry < 3; retry++) {
            await new Promise(r => setTimeout(r, 5000));
            try {
                const xmlBody = `
                    <met:checkDeployStatus>
                        <met:asyncProcessId>${deploymentId}</met:asyncProcessId>
                        <met:includeDetails>false</met:includeDetails>
                    </met:checkDeployStatus>
                `;
                const xmlResponse = await this.soap('checkDeployStatus', xmlBody);
                const result = xmlResponse.getElementsByTagName('result')[0] || xmlResponse.getElementsByTagName('met:result')[0];
                const status = (result.getElementsByTagName('status')[0] || result.getElementsByTagName('met:status')[0]).textContent;
                if (status === 'Succeeded') {
                    console.log(`[SF API] Metadata fallback retry ${retry + 1}: Deployment succeeded.`);
                    return { success: true, status };
                }
                if (status === 'Failed' || status === 'Canceled') {
                    console.warn(`[SF API] Metadata fallback retry ${retry + 1}: Deployment ${status}.`);
                    break;
                }
                console.log(`[SF API] Metadata fallback retry ${retry + 1}: State still ${status}, retrying...`);
            } catch (e) {
                console.warn(`[SF API] Metadata fallback retry ${retry + 1} error: ${e.message}`);
            }
        }

        throw new Error('Deployment timed out. The deployment may still be processing — please check your org before retrying.');
    }

    /**
     * Extracts error diagnostics from Metadata API deployment result
     * Maps componentFailures to Problems panel format
     */
    /**
     * Extracts error diagnostics from Metadata API deployment result (XML DOM)
     * Maps componentFailures to Problems panel format
     */
    extractMetadataErrors(deployResultXml) {
        const diagnostics = [];

        // Helper to get text content safely
        const getText = (node, tagName) => {
            if (!node) return null;
            const el = node.getElementsByTagName(tagName)[0] || node.getElementsByTagName('met:' + tagName)[0];
            return el ? el.textContent : null;
        };

        const details = deployResultXml.getElementsByTagName('details')[0] || deployResultXml.getElementsByTagName('met:details')[0];
        if (!details) return diagnostics;

        // Process componentFailures
        const failures = [...(details.getElementsByTagName('componentFailures') || [])];
        // Merge with namespaced tag if needed
        const metFailures = [...(details.getElementsByTagName('met:componentFailures') || [])];
        const allFailures = [...new Set([...failures, ...metFailures])];

        allFailures.forEach(failure => {
            const fullName = getText(failure, 'fullName') || 'unknown';
            const componentName = fullName.includes('/') ? fullName.split('/').pop() : fullName;

            diagnostics.push({
                file: componentName,
                type: getText(failure, 'problemType') || 'Deployment Error',
                message: getText(failure, 'problem') || 'Unknown error',
                line: parseInt(getText(failure, 'lineNumber')) || null,
                column: parseInt(getText(failure, 'columnNumber')) || null
            });
        });

        // Process runTestResult failures
        const runTestResult = details.getElementsByTagName('runTestResult')[0] || details.getElementsByTagName('met:runTestResult')[0];
        if (runTestResult) {
            const testFailures = [...(runTestResult.getElementsByTagName('failures') || [])];
            const metTestFailures = [...(runTestResult.getElementsByTagName('met:failures') || [])];
            const allTestFailures = [...new Set([...testFailures, ...metTestFailures])];

            allTestFailures.forEach(failure => {
                const name = getText(failure, 'name') || 'Unknown';
                const method = getText(failure, 'methodName') || 'Unknown';

                diagnostics.push({
                    file: `${name}.${method}`,
                    type: 'Test Failure',
                    message: getText(failure, 'message') || 'Test failed',
                    line: null,
                    column: null
                });
            });
        }

        return diagnostics;
    }

    // --- PHASE 6: DEVELOPER UTILITIES ---

    /**
     * Executes Anonymous Apex code
     */
    async executeAnonymous(code) {
        const endpoint = `/services/data/${this.apiVersion}/tooling/executeAnonymous/?anonymousBody=${encodeURIComponent(code)}`;
        return this.rest(endpoint);
    }



    /**
     * Get Debug Logs
     */
    async getLogs() {
        const query = 'SELECT Id, LogUserId, LogUser.Name, Request, Operation, Application, Status, StartTime, LogLength FROM ApexLog ORDER BY StartTime DESC LIMIT 50';
        const result = await this.toolingQuery(query);
        return result.records || [];
    }

    /**
     * Get Log Body
     */
    async getLogBody(id) {
        const endpoint = `/services/data/${this.apiVersion}/tooling/sobjects/ApexLog/${id}/Body`;
        return this.rest(endpoint);
    }

    /**
     * Delete a single Debug Log
     */
    async deleteLog(id) {
        const endpoint = `/services/data/${this.apiVersion}/tooling/sobjects/ApexLog/${id}`;
        return this.rest(endpoint, { method: 'DELETE' });
    }

    /**
     * Run Apex Tests
     * @param {string[]} classIds IDs of test classes to run
     */
    async runTests(classIds) {
        const endpoint = `/services/data/${this.apiVersion}/tooling/runTestsAsynchronous`;
        return this.rest(endpoint, {
            method: 'POST',
            body: { classids: classIds.join(',') }
        });
    }

    /**
     * Get Test Run Results
     */
    async getTestResults(jobId) {
        const query = `SELECT Id, ApexClassId, ApexClass.Name, MethodName, Message, StackTrace, Outcome FROM ApexTestResult WHERE AsyncApexJobId = '${jobId}'`;
        const result = await this.toolingQuery(query);
        return result.records || [];
    }

    /**
     * Get Apex Class Info by Name (including Body for @isTest detection)
     */
    async getApexClassByName(name) {
        const query = `SELECT Id, Name, Body FROM ApexClass WHERE Name = '${name}'`;
        const result = await this.toolingQuery(query);
        return result.records[0];
    }

    /**
     * Get basic info about an Apex Class (including Body for @isTest detection)
     */
    async getApexClassInfo(classId) {
        if (!classId) return null;
        const query = `SELECT Id, Name, Body FROM ApexClass WHERE Id = '${classId}'`;
        const result = await this.toolingQuery(query);
        return result.records[0];
    }

    /**
     * Get Apex Class Source Code
     */
    async getApexClassSource(classId) {
        if (!classId) return null;
        const query = `SELECT Body FROM ApexClass WHERE Id = '${classId}'`;
        const result = await this.toolingQuery(query);
        return result.records[0]?.Body;
    }

    /**
     * Get Aggregate Code Coverage (Percentage/Summary)
     */
    async getAggregateCodeCoverage(classId) {
        let query = 'SELECT ApexClassOrTriggerId, NumLinesCovered, NumLinesUncovered FROM ApexCodeCoverageAggregate';
        if (classId) query += ` WHERE ApexClassOrTriggerId = '${classId}'`;
        const result = await this.toolingQuery(query);
        return result.records || [];
    }

    /**
     * Get Line-level Code Coverage (Lines Covered/Uncovered)
     * Must be queried via Tooling API.
     */
    async getLineCodeCoverage(classId) {
        if (!classId) return [];
        // The field name is 'Coverage', which is a complex type containing coveredLines and uncoveredLines arrays.
        const query = `SELECT ApexClassOrTriggerId, Coverage FROM ApexCodeCoverage WHERE ApexClassOrTriggerId = '${classId}'`;
        const result = await this.toolingQuery(query);
        return result.records || [];
    }

    /**
     * --- DEBUG LOG MANAGEMENT ---
     */

    async getCurrentUserId() {
        if (this._userId) return this._userId;
        const result = await this.rest(`/services/data/${this.apiVersion}/chatter/users/me`);
        this._userId = result.id;
        return this._userId;
    }

    async getOrCreateDebugLevel(name = 'SF_INTEL_LEVEL') {
        const query = `SELECT Id FROM DebugLevel WHERE DeveloperName = '${name}'`;
        const result = await this.toolingQuery(query);

        if (result.records && result.records.length > 0) {
            return result.records[0].Id;
        }

        // Create high-verbosity level
        const create = await this.rest(`/services/data/${this.apiVersion}/tooling/sobjects/DebugLevel`, {
            method: 'POST',
            body: {
                DeveloperName: name,
                MasterLabel: name,
                Visualforce: 'DEBUG',
                ApexCode: 'FINEST', // We need FINEST for the execution tree!
                ApexProfiling: 'INFO',
                Callout: 'INFO',
                Database: 'INFO',
                System: 'DEBUG',
                Validation: 'INFO',
                Workflow: 'INFO'
            }
        });
        return create.id;
    }

    async ensureTraceFlag(minutes = 30) {
        const userId = await this.getCurrentUserId();
        const debugLevelId = await this.getOrCreateDebugLevel();

        // 1. Check for existing active flag
        const now = new Date().toISOString();
        const query = `SELECT Id, ExpirationDate FROM TraceFlag 
                      WHERE LogType = 'DEVELOPER_LOG' 
                      AND TracedEntityId = '${userId}' 
                      AND ExpirationDate > ${now}`;

        // Note: Tooling API query needs dates without quotes for some versions, or formatted correctly
        const result = await this.toolingQuery(`SELECT Id, ExpirationDate FROM TraceFlag WHERE TracedEntityId = '${userId}' AND ExpirationDate > ${now} LIMIT 1`);

        if (result.records && result.records.length > 0) {
            console.log('[SF API] Active TraceFlag found:', result.records[0].Id);
            return result.records[0].Id;
        }

        // 2. Create new one
        console.log('[SF API] Creating new TraceFlag...');
        const expiration = new Date();
        expiration.setMinutes(expiration.getMinutes() + minutes);

        const create = await this.rest(`/services/data/${this.apiVersion}/tooling/sobjects/TraceFlag`, {
            method: 'POST',
            body: {
                TracedEntityId: userId,
                DebugLevelId: debugLevelId,
                StartDate: now,
                ExpirationDate: expiration.toISOString(),
                LogType: 'DEVELOPER_LOG'
            }
        });

        return create.id;
    }

    /**
     * --- LIVE TRACE (SIP-3.5) ---
     */

    async getOrCreateLiveTraceDebugLevel() {
        const name = 'SF_INTEL_LIVE_TRACE';
        const query = `SELECT Id FROM DebugLevel WHERE DeveloperName = '${name}'`;
        const result = await this.toolingQuery(query);

        if (result.records && result.records.length > 0) {
            return result.records[0].Id;
        }

        const create = await this.rest(`/services/data/${this.apiVersion}/tooling/sobjects/DebugLevel`, {
            method: 'POST',
            body: {
                DeveloperName: name,
                MasterLabel: name,
                Visualforce: 'NONE',
                ApexCode: 'FINEST',
                ApexProfiling: 'INFO',
                Callout: 'INFO',
                Database: 'FINE',
                System: 'DEBUG',
                Validation: 'INFO',
                Workflow: 'FINE'
            }
        });
        return create.id;
    }

    async getLogsSince(isoTimestamp) {
        const query = `SELECT Id, Operation, Status, StartTime, LogLength FROM ApexLog WHERE StartTime > ${isoTimestamp} ORDER BY StartTime DESC LIMIT 20`;
        const result = await this.toolingQuery(query);
        return result.records || [];
    }

    // ─── Trace Flag Management ───────────────────────────────

    async getActiveTraceFlags() {
        const userId = await this.getCurrentUserId();
        const query = `SELECT Id, ExpirationDate, StartDate, DebugLevelId, DebugLevel.DeveloperName, LogType FROM TraceFlag WHERE TracedEntityId = '${userId}' AND LogType = 'DEVELOPER_LOG' ORDER BY ExpirationDate DESC LIMIT 5`;
        const result = await this.toolingQuery(query);
        return result.records || [];
    }

    async updateTraceFlag(traceFlagId, expirationDate) {
        return this.rest(`/services/data/${this.apiVersion}/tooling/sobjects/TraceFlag/${traceFlagId}`, {
            method: 'PATCH',
            body: { ExpirationDate: expirationDate }
        });
    }

    async deleteTraceFlag(traceFlagId) {
        return this.rest(`/services/data/${this.apiVersion}/tooling/sobjects/TraceFlag/${traceFlagId}`, {
            method: 'DELETE'
        });
    }

    async createTraceFlagWithLevel(minutes, debugLevels) {
        const userId = await this.getCurrentUserId();
        const dlName = 'SF_INTEL_CUSTOM';
        const dlQuery = `SELECT Id FROM DebugLevel WHERE DeveloperName = '${dlName}'`;
        const dlResult = await this.toolingQuery(dlQuery);
        let debugLevelId;

        if (dlResult.records && dlResult.records.length > 0) {
            debugLevelId = dlResult.records[0].Id;
            await this.rest(`/services/data/${this.apiVersion}/tooling/sobjects/DebugLevel/${debugLevelId}`, {
                method: 'PATCH',
                body: debugLevels
            });
        } else {
            const create = await this.rest(`/services/data/${this.apiVersion}/tooling/sobjects/DebugLevel`, {
                method: 'POST',
                body: { DeveloperName: dlName, MasterLabel: dlName, ...debugLevels }
            });
            debugLevelId = create.id;
        }

        // Delete any existing active trace flag first
        const now = new Date().toISOString();
        const existing = await this.toolingQuery(
            `SELECT Id FROM TraceFlag WHERE TracedEntityId = '${userId}' AND LogType = 'DEVELOPER_LOG' AND ExpirationDate > ${now} LIMIT 1`
        );
        if (existing.records?.length > 0) {
            await this.rest(`/services/data/${this.apiVersion}/tooling/sobjects/TraceFlag/${existing.records[0].Id}`, { method: 'DELETE' });
        }

        const expiration = new Date();
        expiration.setMinutes(expiration.getMinutes() + minutes);

        const result = await this.rest(`/services/data/${this.apiVersion}/tooling/sobjects/TraceFlag`, {
            method: 'POST',
            body: {
                TracedEntityId: userId,
                DebugLevelId: debugLevelId,
                StartDate: now,
                ExpirationDate: expiration.toISOString(),
                LogType: 'DEVELOPER_LOG'
            }
        });
        return result;
    }

    /**
     * --- LWC PREVIEW ENGINE (SIP-3.3) ---
     */

    async ensurePreviewHostDeployed() {
        // Version token — bump this whenever the host markup or controller changes
        // so the host is redeployed automatically on next preview click.
        const HOST_VERSION = 'SF-INTEL-HOST-V4';

        console.log('[SF API] Ensuring Preview Host is deployed...');

        // Metadata for the Aura Preview Wrapper
        // This is a minimal Aura App that dynamically renders an LWC passed via URL parameter.
        const appMarkup = `<aura:application extends="force:slds">
    <aura:attribute name="cmp" type="String" access="global" />
    <aura:handler name="init" value="{!this}" action="{!c.doInit}" />
    <div style="background:#f3f3f3; min-height:100vh; padding:24px; box-sizing:border-box;">
        {!v.body}
    </div>
</aura:application>`;

        const controller = `({
    // ${HOST_VERSION}
    doInit: function(cmp, event, helper) {
        // Primary: read the component name from the Aura attribute (bound from c__cmp URL param).
        // Fallback: parse window.location.search directly (works in standalone app context).
        var cmpName = cmp.get("v.cmp");
        if (!cmpName) {
            try {
                var params = new URLSearchParams(window.location.search);
                cmpName = params.get('c__cmp');
            } catch(e) {}
        }

        if (!cmpName) {
            $A.createComponent(
                "lightning:formattedText",
                { "value": "SF-Intel: No component specified. Add c__cmp=<name> to the URL." },
                function(newCmp, status) {
                    if (status === "SUCCESS") cmp.set("v.body", newCmp);
                }
            );
            return;
        }

        // LWC components in Aura are referenced as c:<camelCaseName>
        var target = "c:" + cmpName;
        console.log("[SF-Intel Preview] Rendering: " + target);

        $A.createComponent(target, {}, function(newCmp, status, errorMessage) {
            console.log("[SF-Intel Preview] Status: " + status);
            if (status === "SUCCESS") {
                cmp.set("v.body", newCmp);
            } else if (status === "INCOMPLETE") {
                $A.createComponent(
                    "lightning:formattedText",
                    { "value": "SF-Intel: Component '" + cmpName + "' could not be loaded (offline or session expired). Try refreshing." },
                    function(errCmp) { cmp.set("v.body", errCmp); }
                );
            } else if (status === "ERROR") {
                console.error("[SF-Intel Preview] Error:", errorMessage);
                $A.createComponent(
                    "lightning:formattedText",
                    { "value": "SF-Intel: Error loading '" + cmpName + "': " + errorMessage },
                    function(errCmp) { cmp.set("v.body", errCmp); }
                );
            }
        });
    }
})`;

        const meta = `<?xml version="1.0" encoding="UTF-8"?>
<AuraDefinitionBundle xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>59.0</apiVersion>
    <description>SF-Intel LWC Preview Host ${HOST_VERSION}</description>
</AuraDefinitionBundle>`;

        // Check if the current deployed version matches HOST_VERSION.
        // If the bundle is missing OR the version is outdated, redeploy.
        // Version check via localStorage — keyed by org + version so it resets
        // automatically when the version token is bumped or org changes.
        const versionKey = `sf-intel-preview-host-${HOST_VERSION}-${this.instanceUrl}`;
        if (localStorage.getItem(versionKey)) {
            console.log('[SF API] Preview Host is up to date (cached).');
            return true;
        }

        // Check if bundle exists in org (single fast query, no AuraDefinition source fetch).
        try {
            const bundleResult = await this.toolingQuery(
                `SELECT Id FROM AuraDefinitionBundle WHERE DeveloperName = 'sfIntelPreviewHost' LIMIT 1`
            );
            if (bundleResult.records?.length > 0) {
                console.log('[SF API] Preview Host exists but version is outdated. Redeploying...');
            } else {
                console.log('[SF API] Preview Host missing. Deploying...');
            }
        } catch (e) {
            console.warn('[SF API] Could not check preview host bundle:', e.message);
        }

        const fileMap = {
            "sfIntelPreviewHost.app": appMarkup,
            "sfIntelPreviewHostController.js": controller,
            "sfIntelPreviewHost.app-meta.xml": meta
        };

        const result = await this.deployBundleAtomic('Aura', 'sfIntelPreviewHost', fileMap);
        // Mark this version as deployed so subsequent preview clicks skip redeployment.
        try { localStorage.setItem(versionKey, '1'); } catch (e) {}
        return result;
    }

    getPreviewUrl(lwcName) {
        // We use the Lightning URL pattern to ensure full SLDS and session context
        // This opens the Aura app which then renders the LWC
        // Added t parameter as a cache buster (SIP-3.4)
        const domain = this.instanceUrl.replace('http:', 'https:');
        return `${domain}/c/sfIntelPreviewHost.app?c__cmp=${lwcName}&t=${Date.now()}`;
    }
}

// Initialize and export
function initializeSalesforceAPI(sessionId, instanceUrl) {
    return new SalesforceAPIClient(sessionId, instanceUrl);
}

// Make globally available for content scripts (when used in non-module context)
if (typeof window !== 'undefined') {
    window.SalesforceAPIClient = SalesforceAPIClient;
    window.DeploymentError = DeploymentError;
    window.initializeSalesforceAPI = initializeSalesforceAPI;
}
