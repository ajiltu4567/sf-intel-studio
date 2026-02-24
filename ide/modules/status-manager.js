/**
 * Status Manager
 * 
 * Manages IDE status bar display with Native Messaging state indicators
 * Shows: 🟢 Ready | 🟡 Starting | 🔴 Unavailable
 */

class StatusManager {
    constructor(connectionManager) {
        this.connectionManager = connectionManager;
        this.statusEl = document.getElementById('cliStatus');
        this.lastCheck = null;
        this.monitoringInterval = null;
    }
    
    /**
     * Initialize and start monitoring connection status
     */
    async initialize() {
        if (!this.statusEl) {
            console.warn('[StatusManager] Status element not found');
            return;
        }
        
        // Initial status check
        await this.updateStatus();
        
        // Monitor every 10 seconds
        this.startMonitoring();
        
        // Setup click handler for status element
        this.setupClickHandler();
    }
    
    /**
     * Start periodic status monitoring
     */
    startMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
        }
        
        this.monitoringInterval = setInterval(() => {
            this.updateStatus().catch(err => {
                console.warn('[StatusManager] Status update failed:', err);
            });
        }, 10000); // Check every 10s
    }
    
    /**
     * Stop monitoring
     */
    stopMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }
    }
    
    /**
     * Update status display
     */
    async updateStatus() {
        this.lastCheck = new Date();
        const status = this.connectionManager.getStatus();
        
        if (status.connected) {
            const isNative = status.type === 'native';
            this.setStatus({
                icon: status.icon || '🟢',
                text: isNative ? 'SFintel Engine: Ready' : 'SFintel Engine: Ready (HTTP)',
                tooltip: this.buildTooltip(status, isNative),
                clickable: !isNative,
                connectionType: status.type
            });
        } else if (status.error) {
            this.setStatus({
                icon: '🔴',
                text: `SFintel Engine: ${status.error.userMessage}`,
                tooltip: this.buildErrorTooltip(status.error),
                clickable: true,
                error: status.error
            });
        } else {
            this.setStatus({
                icon: '🟡',
                text: 'SFintel Engine: Starting...',
                tooltip: 'Connecting to native host',
                clickable: false
            });
        }
    }
    
    /**
     * Build tooltip text
     */
    buildTooltip(status, isNative) {
        const lines = [];
        
        if (isNative) {
            lines.push('✅ Native Messaging (Secure)');
            lines.push('No network permissions required');
        } else {
            lines.push('⚠️ HTTP Fallback (Development)');
            lines.push('Using localhost:3000');
        }
        
        lines.push('');
        lines.push(`Last check: ${this.lastCheck.toLocaleTimeString()}`);
        
        if (!isNative) {
            lines.push('');
            lines.push('Click to switch to Native Messaging');
        }
        
        return lines.join('\n');
    }
    
    /**
     * Build error tooltip
     */
    buildErrorTooltip(error) {
        const lines = [`❌ ${error.userMessage}`];
        
        if (error.action === 'install') {
            lines.push('');
            lines.push('Click to install SFintel CLI');
        } else if (error.action === 'help') {
            lines.push('');
            lines.push('Click for troubleshooting help');
        } else if (error.action === 'restart') {
            lines.push('');
            lines.push('Click to restart connection');
        }
        
        return lines.join('\n');
    }
    
    /**
     * Set status display
     */
    setStatus(config) {
        if (!this.statusEl) return;

        // Map emoji icons to CSS dot colors
        const dotColorMap = { '🟢': '#2ecc71', '🟡': '#f39c12', '🔴': '#e74c3c' };
        const dotColor = dotColorMap[config.icon] || '#888';
        this.statusEl.innerHTML = `<span class="status-dot" style="background:${dotColor}"></span> ${config.text}`;
        
        // Update tooltip
        this.statusEl.title = config.tooltip || config.text;
        
        // Update cursor
        this.statusEl.style.cursor = config.clickable ? 'pointer' : 'default';
        
        // Store error for click handler
        this.statusEl.dataset.error = config.error ? JSON.stringify(config.error) : '';
        this.statusEl.dataset.connectionType = config.connectionType || 'none';
    }
    
    /**
     * Setup click handler for status actions
     */
    setupClickHandler() {
        if (!this.statusEl) return;
        
        this.statusEl.addEventListener('click', async () => {
            const errorData = this.statusEl.dataset.error;
            const connectionType = this.statusEl.dataset.connectionType;
            
            // Handle HTTP fallback click - suggest native messaging
            if (connectionType === 'http') {
                const install = confirm(
                    'You\'re using HTTP fallback. Would you like to switch to Native Messaging for better security?\n\n' +
                    'This requires installing the SFintel CLI.'
                );
                if (install) {
                    window.open('https://sfintel.io/install', '_blank');
                }
                return;
            }
            
            // Handle error click
            if (errorData) {
                try {
                    const error = JSON.parse(errorData);
                    this.handleErrorAction(error);
                } catch (e) {
                    console.error('[StatusManager] Failed to parse error:', e);
                }
            }
        });
    }
    
    /**
     * Handle error action click
     */
    async handleErrorAction(error) {
        switch (error.action) {
            case 'install':
                window.open(error.actionUrl || 'https://sfintel.io/install', '_blank');
                break;
                
            case 'update':
                window.open(error.actionUrl || 'https://sfintel.io/install', '_blank');
                break;
                
            case 'help':
                window.open(error.actionUrl || 'https://sfintel.io/troubleshooting', '_blank');
                break;
                
            case 'restart':
                console.log('[StatusManager] Restarting connection...');
                try {
                    await this.connectionManager.reconnect();
                    await this.updateStatus();
                } catch (err) {
                    console.error('[StatusManager] Reconnect failed:', err);
                }
                break;
                
            case 'retry':
                console.log('[StatusManager] Retrying connection...');
                await this.updateStatus();
                break;
        }
    }
    
    /**
     * Cleanup
     */
    destroy() {
        this.stopMonitoring();
    }
}

// Export for use in IDE
window.StatusManager = StatusManager;
