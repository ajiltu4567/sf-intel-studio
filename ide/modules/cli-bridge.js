/**
 * SF-Intel CLI Bridge
 * 
 * Thin communication layer between IDE and SF-Intel CLI
 * Handles CLI discovery, health checks, command execution, and progress streaming
 */

class CLIBridge {
    constructor(backendUrl = '') {
        this.backendUrl = backendUrl || 'http://127.0.0.1:3000';
        this.healthCache = null;
        this.healthCacheTime = 0;
        this.healthCacheTTL = 60000; // 1 minute
        this.activeStreams = new Map();
    }

    /**
     * Check if CLI backend is available and get version info
     * @returns {Promise<{available: boolean, version?: string, compatible?: boolean}>}
     */
    /**
     * Check if CLI backend is available and get version info
     * @returns {Promise<{available: boolean, version?: string, compatible?: boolean}>}
     */
    async checkHealth() {
        const now = Date.now();
        
        // Return cached result if still valid
        if (this.healthCache && (now - this.healthCacheTime) < this.healthCacheTTL) {
            return this.healthCache;
        }

        try {
            // CHECK 1: Use /api/stats (most reliable endpoint)
            const response = await fetch(`${this.backendUrl}/api/stats`, {
                method: 'GET',
                signal: AbortSignal.timeout(5000)
            });

            if (response.ok) {
                // If we get ANY valid response from the server, we are connected.
                // We don't care if stats returns an error payload, the HTTP connection is alive.
                const healthInfo = {
                    available: true,
                    version: '1.0.0', // Assume v1 if we can connect
                    compatible: true,
                    mode: 'http-fallback'
                };
                
                this.healthCache = healthInfo;
                this.healthCacheTime = now;
                return healthInfo;
            }
            
            throw new Error(`HTTP ${response.status}`);
        } catch (error) {
            console.warn('[CLIBridge] Health check failed:', error);
            
            // Cache negative result briefly
            const negativeResult = { available: false };
            this.healthCache = negativeResult;
            this.healthCacheTime = now;
            
            return negativeResult;
        }
    }

    /**
     * Execute deployment command via CLI
     * @param {DeploymentIntent} intent
     * @returns {Promise<string>} Deployment ID
     */
    async executeCommand(intent) {
        try {
            const response = await fetch(`${this.backendUrl}/api/cli/deploy`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ intent: intent.toJSON() })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `Deploy command failed: ${response.status}`);
            }

            const result = await response.json();
            return result.deploymentId;

        } catch (error) {
            console.error('[CLIBridge] Execute command failed:', error);
            throw error;
        }
    }

    /**
     * Stream deployment progress via Server-Sent Events
     * @param {string} deploymentId
     * @param {Function} progressCallback
     * @returns {Promise<DeploymentResult>}
     */
    async streamProgress(deploymentId, progressCallback) {
        return new Promise((resolve, reject) => {
            const eventSource = new EventSource(`${this.backendUrl}/api/cli/deploy/${deploymentId}/stream`);
            
            this.activeStreams.set(deploymentId, eventSource);

            let finalResult = null;

            eventSource.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);

                    // Handle different message types
                    switch (data.type) {
                        case 'progress':
                            progressCallback(data);
                            break;

                        case 'log':
                            progressCallback({ type: 'log', message: data.message });
                            break;

                        case 'step':
                            progressCallback({ 
                                step: data.step, 
                                status: data.status, 
                                message: data.message 
                            });
                            break;

                        case 'result':
                            finalResult = data.result;
                            break;

                        case 'error':
                            eventSource.close();
                            this.activeStreams.delete(deploymentId);
                            reject(new Error(data.message));
                            break;

                        case 'complete':
                            eventSource.close();
                            this.activeStreams.delete(deploymentId);
                            resolve(finalResult || {
                                success: data.success || 0,
                                failed: data.failed || 0,
                                errors: data.errors || []
                            });
                            break;
                    }
                } catch (error) {
                    console.error('[CLIBridge] Failed to parse progress:', error);
                }
            };

            eventSource.onerror = (error) => {
                console.error('[CLIBridge] Stream error:', error);
                eventSource.close();
                this.activeStreams.delete(deploymentId);
                
                // If we have a final result, resolve with it
                if (finalResult) {
                    resolve(finalResult);
                } else {
                    reject(new Error('CLI stream connection failed'));
                }
            };
        });
    }

    /**
     * Cancel ongoing deployment
     * @param {string} deploymentId
     */
    async cancelDeployment(deploymentId) {
        try {
            // Close SSE stream if active
            const eventSource = this.activeStreams.get(deploymentId);
            if (eventSource) {
                eventSource.close();
                this.activeStreams.delete(deploymentId);
            }

            // Send cancel request to backend
            const response = await fetch(`${this.backendUrl}/api/cli/deploy/${deploymentId}/cancel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });

            if (!response.ok) {
                throw new Error(`Cancel failed: ${response.status}`);
            }

            return await response.json();

        } catch (error) {
            console.error('[CLIBridge] Cancel deployment failed:', error);
            throw error;
        }
    }

    /**
     * Invalidate health cache
     * Call this when you want to force a fresh health check
     */
    invalidateHealthCache() {
        this.healthCache = null;
        this.healthCacheTime = 0;
    }

    /**
     * Close all active streams
     */
    closeAllStreams() {
        this.activeStreams.forEach((eventSource, deploymentId) => {
            console.log(`[CLIBridge] Closing stream for deployment ${deploymentId}`);
            eventSource.close();
        });
        this.activeStreams.clear();
    }
}

// ==================== INITIALIZATION ====================

// Create global CLI bridge instance
if (typeof window !== 'undefined') {
    window.CLIBridge = CLIBridge;
    
    // Initialize on page load
    document.addEventListener('DOMContentLoaded', () => {
        const cliBridge = new CLIBridge();
        
        // Set up executor factory
        if (window.ExecutorFactory) {
            window.ExecutorFactory.setCLIBridge(cliBridge);
        }

        // Update CLI status indicator in status bar
        const updateCLIStatus = (health) => {
            const indicator = document.getElementById('cli-status');
            if (!indicator) return;

            indicator.classList.remove('checking', 'connected', 'disconnected');
            
            const textElement = indicator.querySelector('.status-text');

            if (health.available) {
                indicator.classList.add('connected');
                if (textElement) textElement.textContent = 'Connected';
                indicator.title = `SF-Intel CLI Connected\nVersion: ${health.version}\nClick for diagnostics`;
                console.log(`[SF-Intel] CLI available: v${health.version}`);
            } else {
                indicator.classList.add('disconnected');
                if (textElement) textElement.textContent = 'Not Available';
                indicator.title = 'SF-Intel CLI Not Available\nUsing API executor\nClick to learn more';
                console.log('[SF-Intel] CLI not available, using API executor');
            }
        };

        // Initial status - checking
        const indicator = document.getElementById('cli-status');
        if (indicator) {
            indicator.classList.add('checking');
            const textElement = indicator.querySelector('.status-text');
            if (textElement) textElement.textContent = 'Checking...';
        }

        // Perform initial health check (async, non-blocking)
        cliBridge.checkHealth().then(updateCLIStatus);

        // Optionally refresh status periodically
        setInterval(() => {
            cliBridge.invalidateHealthCache();
            cliBridge.checkHealth().then(updateCLIStatus);
        }, 60000); // Every 60 seconds

        // Cleanup on page unload
        window.addEventListener('beforeunload', () => {
            cliBridge.closeAllStreams();
        });

        // Expose update function globally for manual refresh
        window.updateCLIStatus = () => {
            indicator.classList.add('checking');
            cliBridge.invalidateHealthCache();
            cliBridge.checkHealth().then(updateCLIStatus);
        };
    });
}
