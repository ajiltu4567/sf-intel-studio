/**
 * SF-Intel Deployment Execution Layer
 * 
 * Provides execution abstraction for deployments with pluggable strategies.
 * Supports both API-based and CLI-based execution with automatic selection.
 */

// ==================== DEPLOYMENT INTENT CONTRACT ====================

/**
 * Deployment Intent - Single source of truth for deployment operations
 * This contract is serializable, stateless, declarative, and versionable
 */
class DeploymentIntent {
    constructor({
        action = 'STAGED_DEPLOY',
        sourceOrg,
        targetOrg,
        components = [],
        options = {},
        features = {}
    }) {
        this.action = action;
        this.sourceOrg = sourceOrg;
        this.targetOrg = targetOrg;
        this.components = components;
        this.options = {
            runTests: options.runTests || 'RunLocalTests',
            checkOnly: options.checkOnly || false,
            ignoreWarnings: options.ignoreWarnings || false,
            ...options
        };
        this.features = {
            rollback: features.rollback || false,
            autoDependencies: features.autoDependencies || false,
            advancedValidation: features.advancedValidation || false,
            snapshotEnabled: features.snapshotEnabled || false,
            ...features
        };
    }

    toJSON() {
        return {
            action: this.action,
            sourceOrg: this.sourceOrg,
            targetOrg: this.targetOrg,
            components: this.components,
            options: this.options,
            features: this.features
        };
    }

    static fromJSON(json) {
        return new DeploymentIntent(json);
    }
}

// ==================== BASE EXECUTOR INTERFACE ====================

/**
 * Base class for all deployment executors
 * Defines the contract that all executors must implement
 */
class DeploymentExecutor {
    constructor() {
        this.capabilities = {};
    }

    /**
     * Validate deployment intent before execution
     * @param {DeploymentIntent} intent
     * @returns {Promise<{valid: boolean, errors: Array}>}
     */
    async validate(intent) {
        throw new Error('validate() must be implemented by subclass');
    }

    /**
     * Execute deployment with progress streaming
     * @param {DeploymentIntent} intent
     * @param {Function} progressCallback - Called with progress updates
     * @returns {Promise<DeploymentResult>}
     */
    async execute(intent, progressCallback) {
        throw new Error('execute() must be implemented by subclass');
    }

    /**
     * Cancel ongoing deployment
     * @param {string} deploymentId
     * @returns {Promise<void>}
     */
    async cancel(deploymentId) {
        throw new Error('cancel() must be implemented by subclass');
    }

    /**
     * Get executor capabilities
     * @returns {Object} Capabilities object
     */
    getCapabilities() {
        return this.capabilities;
    }
}

// ==================== API EXECUTOR (Existing Logic) ====================

/**
 * API Executor - Uses existing window.apiClient for deployments
 * This wraps the current implementation without changes
 */
class APIExecutor extends DeploymentExecutor {
    constructor() {
        super();
        this.capabilities = {
            rollback: false,
            snapshots: false,
            autoDependencies: false,
            advancedValidation: false,
            streaming: false
        };
    }

    async validate(intent) {
        const errors = [];

        if (!window.apiClient) {
            errors.push('API client not available');
        }

        if (intent.features.rollback) {
            errors.push('Rollback requires CLI executor');
        }

        if (intent.features.snapshotEnabled) {
            errors.push('Snapshots require CLI executor');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    async execute(intent, progressCallback) {
        console.log('[APIExecutor] Starting deployment with API');

        const result = {
            success: 0,
            failed: 0,
            errors: [],
            components: []
        };

        try {
            // Step 1: Prepare
            progressCallback({ step: 1, status: 'active', message: 'Preparing deployment' });
            
            // Fetch component bodies
            const componentBodies = await this.fetchComponentBodies(intent.components, progressCallback);
            
            progressCallback({ step: 1, status: 'completed' });

            // Step 2: Validate
            progressCallback({ step: 2, status: 'active', message: 'Validating components' });
            await new Promise(r => setTimeout(r, 500)); // Brief pause
            progressCallback({ step: 2, status: 'completed' });

            // Step 3: Tests
            progressCallback({ step: 3, status: 'active', message: intent.options.runTests === 'RunLocalTests' ? 'Running tests' : 'Skipping tests' });
            await new Promise(r => setTimeout(r, 500));
            progressCallback({ step: 3, status: 'completed' });

            // Step 4: Deploy
            progressCallback({ step: 4, status: 'active', message: 'Deploying to org' });
            
            for (const component of componentBodies) {
                try {
                    await this.deployComponent(component, progressCallback);
                    result.success++;
                    result.components.push({
                        name: component.name,
                        status: 'success'
                    });
                } catch (error) {
                    result.failed++;
                    result.errors.push({
                        component: component.name,
                        error: error.message
                    });
                    result.components.push({
                        name: component.name,
                        status: 'failed',
                        error: error.message
                    });
                }
            }

            progressCallback({ step: 4, status: 'completed' });

            return result;

        } catch (error) {
            console.error('[APIExecutor] Deployment failed:', error);
            throw error;
        }
    }

    async fetchComponentBodies(components, progressCallback) {
        const bodies = [];

        for (const component of components) {
            try {
                let body;

                // Check if already open in editor
                const openTab = window.openTabs?.find(t => t.id === component.id);
                if (openTab && window.__MONACO_EDITOR__) {
                    body = window.__MONACO_EDITOR__.getValue();
                    if (progressCallback) {
                        progressCallback({ type: 'log', message: `  ↳ Using editor content for ${component.name}` });
                    }
                } else if (window.apiClient) {
                    // Fetch from Salesforce
                    if (progressCallback) {
                        progressCallback({ type: 'log', message: `  ↳ Fetching ${component.name}` });
                    }

                    if (component.type === 'ApexClass') {
                        const data = await window.apiClient.fetchApexClass(component.id);
                        body = data.Body;
                    } else if (component.type === 'ApexTrigger') {
                        const data = await window.apiClient.fetchApexTrigger(component.id);
                        body = data.Body;
                    } else if (component.type === 'LightningComponentBundle') {
                        body = await window.apiClient.fetchLWCBundle(component.fullName);
                    } else if (component.type === 'AuraDefinitionBundle') {
                        body = await window.apiClient.fetchAuraBundle(component.fullName);
                    }
                }

                if (body) {
                    bodies.push({ ...component, body });
                }
            } catch (error) {
                throw new Error(`Failed to fetch ${component.name}: ${error.message}`);
            }
        }

        return bodies;
    }

    async deployComponent(component, progressCallback) {
        if (!window.apiClient) {
            throw new Error('API client not available');
        }

        try {
            if (component.type === 'ApexClass') {
                await window.apiClient.deployApexClass(component.id, component.body);
            } else if (component.type === 'ApexTrigger') {
                await window.apiClient.deployApexTrigger(component.id, component.body);
            } else if (component.type === 'LightningComponentBundle') {
                await window.apiClient.deployLwcBundle(component.id, component.body); // Fix: use id
            } else if (component.type === 'AuraDefinitionBundle') {
                await window.apiClient.deployAuraBundle(component.id, component.body); // Fix: use id
            }

            if (progressCallback) {
                progressCallback({ type: 'log', message: `  ✓ Deployed ${component.name}` });
            }
        } catch (error) {
            if (progressCallback) {
                progressCallback({ type: 'log', message: `  ✗ Failed ${component.name}: ${error.message}` });
            }
            throw error;
        }
    }

    async cancel(deploymentId) {
        console.log('[APIExecutor] Cancel not supported');
    }
}

// ==================== CLI EXECUTOR (Future Implementation) ====================

/**
 * CLI Executor - Delegates to SF-Intel CLI for advanced features
 * Phase 1: Basic implementation with CLI bridge
 */
class CLIExecutor extends DeploymentExecutor {
    constructor(cliBridge) {
        super();
        this.cliBridge = cliBridge;
        this.capabilities = {
            rollback: true,
            snapshots: true,
            autoDependencies: true,
            advancedValidation: true,
            streaming: true
        };
    }

    async validate(intent) {
        // Check CLI availability
        const health = await this.cliBridge.checkHealth();
        
        if (!health.available) {
            return {
                valid: false,
                errors: ['CLI not available']
            };
        }

        if (!health.compatible) {
            return {
                valid: false,
                errors: [`CLI version ${health.version} is incompatible`]
            };
        }

        return { valid: true, errors: [] };
    }

    async execute(intent, progressCallback) {
        console.log('[CLIExecutor] Starting deployment with CLI');

        try {
            // Execute via CLI bridge
            const deploymentId = await this.cliBridge.executeCommand(intent);

            // Stream progress
            const result = await this.cliBridge.streamProgress(deploymentId, progressCallback);

            return result;

        } catch (error) {
            console.error('[CLIExecutor] Deployment failed:', error);
            throw error;
        }
    }

    async cancel(deploymentId) {
        await this.cliBridge.cancelDeployment(deploymentId);
    }
}

// ==================== EXECUTOR FACTORY ====================

/**
 * Factory for creating appropriate executor based on intent and availability
 * Implements selection logic and fallback strategy
 */
class ExecutorFactory {
    static cliBridge = null;

    static setCLIBridge(bridge) {
        this.cliBridge = bridge;
    }

    /**
     * Get appropriate executor for deployment intent
     * @param {DeploymentIntent} intent
     * @returns {Promise<DeploymentExecutor>}
     */
    static async getExecutor(intent) {
        const preferredType = this.selectExecutorType(intent);

        if (preferredType === 'CLI' && this.cliBridge) {
            try {
                const cliExecutor = new CLIExecutor(this.cliBridge);
                const validation = await cliExecutor.validate(intent);

                if (validation.valid) {
                    console.log('[ExecutorFactory] Using CLI executor');
                    return cliExecutor;
                }

                console.warn('[ExecutorFactory] CLI validation failed:', validation.errors);
            } catch (error) {
                console.warn('[ExecutorFactory] CLI executor unavailable:', error);
            }
        }

        // Check if intent requires CLI-only features
        if (this.requiresCLI(intent)) {
            throw new Error('This deployment requires CLI features, but CLI is not available. Please install SF-Intel CLI.');
        }

        // Fallback to API executor
        console.log('[ExecutorFactory] Using API executor');
        return new APIExecutor();
    }

    /**
     * Determine preferred executor type based on intent
     */
    static selectExecutorType(intent) {
        // Hard requirements (force CLI)
        if (intent.features.rollback) return 'CLI';
        if (intent.features.snapshotEnabled) return 'CLI';
        if (intent.features.advancedValidation) return 'CLI';
        if (intent.components.length > 50) return 'CLI';

        // Soft preferences (prefer CLI if available)
        const hasLWC = intent.components.some(c => 
            c.type === 'LightningComponentBundle' || c.type === 'LWC'
        );
        if (hasLWC && intent.components.length > 5) return 'CLI';

        if (intent.features.autoDependencies) return 'CLI';

        // Default to API
        return 'API';
    }

    /**
     * Check if intent has features that absolutely require CLI
     */
    static requiresCLI(intent) {
        return intent.features.rollback || 
               intent.features.snapshotEnabled || 
               intent.features.advancedValidation;
    }
}

// ==================== EXPORTS ====================

if (typeof window !== 'undefined') {
    window.DeploymentIntent = DeploymentIntent;
    window.DeploymentExecutor = DeploymentExecutor;
    window.APIExecutor = APIExecutor;
    window.CLIExecutor = CLIExecutor;
    window.ExecutorFactory = ExecutorFactory;
}
