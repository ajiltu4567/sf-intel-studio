/**
 * SF-Intel Studio - Fetch Latest UI Module
 *
 * Handles context menu integration and UI feedback for Fetch Latest feature.
 * Works with FetchLatestService for actual data fetching.
 *
 * @module FetchLatestUI
 * @version 1.0.0
 */

const FetchLatestUI = {
    /**
     * Context menu element reference
     */
    menuElement: null,

    /**
     * Currently targeted item for fetch
     */
    currentTarget: {
        id: null,
        name: null,
        type: null
    },

    /**
     * Initialize the Fetch Latest UI
     */
    init() {
        this._createContextMenu();
        this._bindTreeContextMenu();
        this._bindDismissHandlers();
        console.log('[FetchLatestUI] Initialized');
    },

    /**
     * Create the context menu element
     * @private
     */
    _createContextMenu() {
        // Remove existing if any
        const existing = document.getElementById('fetch-latest-context-menu');
        if (existing) existing.remove();

        const menu = document.createElement('div');
        menu.id = 'fetch-latest-context-menu';
        menu.className = 'fetch-context-menu';
        menu.innerHTML = `
            <div class="context-menu-item" data-action="fetch-latest">
                <span class="context-menu-icon">⬇️</span>
                <span class="context-menu-label">Fetch Latest from Salesforce</span>
            </div>
            <div class="context-menu-separator"></div>
            <div class="context-menu-item" data-action="fetch-latest-force">
                <span class="context-menu-icon">🔄</span>
                <span class="context-menu-label">Force Refresh (Skip Cache)</span>
            </div>
        `;
        menu.style.display = 'none';
        document.body.appendChild(menu);

        this.menuElement = menu;

        // Bind menu item clicks
        menu.querySelectorAll('.context-menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = item.dataset.action;
                this._handleMenuAction(action);
            });
        });
    },

    /**
     * Bind context menu to metadata tree items
     * @private
     */
    _bindTreeContextMenu() {
        const tree = document.getElementById('sf-intel-tree');
        if (!tree) {
            console.warn('[FetchLatestUI] Tree element not found, will retry...');
            setTimeout(() => this._bindTreeContextMenu(), 1000);
            return;
        }

        tree.addEventListener('contextmenu', (e) => {
            const itemEl = e.target.closest('.sf-item, .sf-sub-item');
            if (!itemEl) return;

            e.preventDefault();
            e.stopPropagation();

            // Extract item info
            const id = itemEl.dataset.id || itemEl.dataset.bundleId || itemEl.dataset.fileId;
            const name = itemEl.dataset.name || itemEl.querySelector('.name')?.textContent;
            const type = this._detectItemType(itemEl);

            if (!this._isTypeSupported(type)) {
                console.log(`[FetchLatestUI] Type '${type}' not supported for fetch`);
                return;
            }

            this.currentTarget = { id, name, type };
            this._showMenu(e.clientX, e.clientY);
        });
    },

    /**
     * Detect item type from element
     * @private
     */
    _detectItemType(element) {
        // Check current global type
        const globalType = window.currentType;

        // Check element classes for bundle types
        if (element.classList.contains('lwc-bundle') || element.closest('.lwc-bundle')) {
            return 'LWC';
        }
        if (element.classList.contains('aura-bundle') || element.closest('.aura-bundle')) {
            return 'AuraDefinitionBundle';
        }

        // For sub-items, check parent bundle
        if (element.classList.contains('sf-sub-item')) {
            const bundleId = element.dataset.bundleId;
            if (window.lwcBundleCache && window.lwcBundleCache[bundleId]) {
                return 'LWC';
            }
            if (window.auraBundleCache && window.auraBundleCache[bundleId]) {
                return 'AuraDefinitionBundle';
            }
        }

        return globalType;
    },

    /**
     * Check if type is supported
     * @private
     */
    _isTypeSupported(type) {
        const supported = ['ApexClass', 'ApexTrigger', 'LWC', 'AuraDefinitionBundle'];
        return supported.includes(type);
    },

    /**
     * Show context menu at position
     * @private
     */
    _showMenu(x, y) {
        if (!this.menuElement) return;

        // Position menu
        this.menuElement.style.left = `${x}px`;
        this.menuElement.style.top = `${y}px`;
        this.menuElement.style.display = 'block';

        // Adjust if off-screen
        const rect = this.menuElement.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            this.menuElement.style.left = `${window.innerWidth - rect.width - 10}px`;
        }
        if (rect.bottom > window.innerHeight) {
            this.menuElement.style.top = `${window.innerHeight - rect.height - 10}px`;
        }
    },

    /**
     * Hide context menu
     */
    hideMenu() {
        if (this.menuElement) {
            this.menuElement.style.display = 'none';
        }
        this.currentTarget = { id: null, name: null, type: null };
    },

    /**
     * Bind dismiss handlers
     * @private
     */
    _bindDismissHandlers() {
        // Click outside
        document.addEventListener('mousedown', (e) => {
            if (this.menuElement && !this.menuElement.contains(e.target)) {
                this.hideMenu();
            }
        });

        // Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideMenu();
            }
        });

        // Scroll
        document.getElementById('sf-intel-tree')?.addEventListener('scroll', () => {
            this.hideMenu();
        });
    },

    /**
     * Handle menu action
     * @private
     */
    async _handleMenuAction(action) {
        this.hideMenu();

        const { id, name, type } = this.currentTarget;
        if (!name || !type) {
            this._showToast('Error: No item selected', 'error');
            return;
        }

        const skipCache = action === 'fetch-latest-force';

        // Show confirmation dialog
        const confirmed = await this._showConfirmDialog(name, type);
        if (!confirmed) return;

        // Perform fetch
        await this._performFetch(type, name, id, skipCache);
    },

    /**
     * Show confirmation dialog
     * @private
     */
    _showConfirmDialog(name, type) {
        return new Promise((resolve) => {
            const typeLabel = this._getTypeLabel(type);
            const message = `This will overwrite local changes for ${typeLabel} "${name}" with the latest version from Salesforce.\n\nContinue?`;

            // Use native confirm for simplicity, can be replaced with custom modal
            const result = confirm(message);
            resolve(result);
        });
    },

    /**
     * Get human-readable type label
     * @private
     */
    _getTypeLabel(type) {
        const labels = {
            'ApexClass': 'Apex Class',
            'ApexTrigger': 'Apex Trigger',
            'LWC': 'LWC Component',
            'AuraDefinitionBundle': 'Aura Component'
        };
        return labels[type] || type;
    },

    /**
     * Perform the actual fetch operation
     * @private
     */
    async _performFetch(type, name, id, skipCache = false) {
        const typeLabel = this._getTypeLabel(type);

        // Show loading toast
        this._showToast(`Fetching ${typeLabel} "${name}"...`, 'info');

        try {
            // Check if FetchLatestService is available
            if (!window.FetchLatestService) {
                throw new Error('FetchLatestService not loaded');
            }

            const result = await window.FetchLatestService.fetch(type, name);

            if (result.success) {
                // Update local cache and editor
                await this._applyFetchResult(result, id);

                const details = result.metadata
                    ? `Last modified: ${new Date(result.metadata.lastModified).toLocaleString()} by ${result.metadata.lastModifiedBy}`
                    : '';

                this._showToast(
                    `✓ ${typeLabel} "${name}" updated successfully!\n${details}`,
                    'success'
                );

                // Log to terminal if available
                if (window.Terminal) {
                    window.Terminal.success(`Fetched latest: ${name} (${typeLabel})`);
                    if (result.files) {
                        window.Terminal.log(`  Files: ${result.files.map(f => f.fileName).join(', ')}`);
                    }
                }
            }
        } catch (error) {
            console.error('[FetchLatestUI] Fetch failed:', error);
            this._showToast(`✗ Failed to fetch "${name}": ${error.message}`, 'error');

            if (window.Terminal) {
                window.Terminal.error(`Fetch failed: ${name} - ${error.message}`);
            }
        }
    },

    /**
     * Apply fetch result to local cache and editor
     * @private
     */
    async _applyFetchResult(result, originalId) {
        const { type, id, name, body, files } = result;

        switch (type) {
            case 'ApexClass':
            case 'ApexTrigger':
                // Update open tab if exists
                this._updateOpenTab(originalId || id, name, body, type);
                break;

            case 'LWC':
                // Update LWC bundle cache
                if (window.lwcBundleCache && (originalId || id)) {
                    window.lwcBundleCache[originalId || id] = files.map(f => ({
                        Id: f.id,
                        FilePath: f.path,
                        Source: f.source,
                        Format: f.format,
                        path: f.path
                    }));
                }
                // Update open tabs for any files in this bundle
                files.forEach(f => {
                    this._updateOpenTabByPath(f.path, f.source);
                });
                // Re-render tree
                if (window.MetadataExplorer) {
                    window.MetadataExplorer.render();
                }
                break;

            case 'AuraDefinitionBundle':
                // Update Aura bundle cache
                if (window.auraBundleCache && (originalId || id)) {
                    window.auraBundleCache[originalId || id] = files.map(f => ({
                        Id: f.id,
                        DefType: f.defType,
                        Source: f.source,
                        Extension: f.extension,
                        Suffix: '',
                        path: f.path,
                        content: f.source
                    }));
                }
                // Update open tabs for any files in this bundle
                files.forEach(f => {
                    this._updateOpenTabByPath(f.path, f.source);
                });
                // Re-render tree
                if (window.MetadataExplorer) {
                    window.MetadataExplorer.render();
                }
                break;
        }
    },

    /**
     * Update an open tab with new content
     * @private
     */
    _updateOpenTab(id, name, body, type) {
        if (!window.openTabs) return;

        const tab = window.openTabs.find(t => t.id === id || t.name === name);
        if (tab) {
            tab.body = body;
            tab.originalBody = body;
            tab.isDirty = false;

            // If this tab is currently active, update editor
            if (window.activeTabId === tab.id) {
                this._updateEditorContent(body);
            }

            // Update tab UI (remove dirty indicator)
            const tabEl = document.querySelector(`.ide-tab[data-id="${tab.id}"]`);
            if (tabEl) {
                tabEl.classList.remove('dirty');
                const indicator = tabEl.querySelector('.dirty-indicator');
                if (indicator) indicator.remove();
            }
        }
    },

    /**
     * Update open tab by file path
     * @private
     */
    _updateOpenTabByPath(path, source) {
        if (!window.openTabs) return;

        const tab = window.openTabs.find(t => t.path === path || t.name === path.split('/').pop());
        if (tab) {
            tab.body = source;
            tab.originalBody = source;
            tab.isDirty = false;

            if (window.activeTabId === tab.id) {
                this._updateEditorContent(source);
            }

            const tabEl = document.querySelector(`.ide-tab[data-id="${tab.id}"]`);
            if (tabEl) {
                tabEl.classList.remove('dirty');
            }
        }
    },

    /**
     * Update Monaco editor content
     * @private
     */
    _updateEditorContent(content) {
        const editorFrame = document.getElementById('editor-iframe');
        if (editorFrame && editorFrame.contentWindow) {
            try {
                if (typeof editorFrame.contentWindow.setEditorValue === 'function') {
                    editorFrame.contentWindow.setEditorValue(content);
                } else if (editorFrame.contentWindow.monacoEditor) {
                    editorFrame.contentWindow.monacoEditor.setValue(content);
                }
            } catch (e) {
                console.warn('[FetchLatestUI] Could not update editor:', e);
            }
        }
    },

    /**
     * Show toast notification
     * @private
     */
    _showToast(message, type = 'info') {
        // Remove existing toast
        const existing = document.querySelector('.fetch-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = `fetch-toast fetch-toast--${type}`;
        toast.innerHTML = `
            <div class="fetch-toast__content">
                <span class="fetch-toast__message">${message.replace(/\n/g, '<br>')}</span>
                <button class="fetch-toast__close" onclick="this.parentElement.parentElement.remove()">×</button>
            </div>
        `;

        document.body.appendChild(toast);

        // Auto-dismiss after 5 seconds (longer for errors)
        const duration = type === 'error' ? 8000 : 5000;
        setTimeout(() => {
            if (toast.parentElement) {
                toast.classList.add('fetch-toast--fade-out');
                setTimeout(() => toast.remove(), 300);
            }
        }, duration);
    }
};

// Export to window
window.FetchLatestUI = FetchLatestUI;

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => FetchLatestUI.init());
} else {
    // DOM already loaded, initialize after a short delay to ensure tree is rendered
    setTimeout(() => FetchLatestUI.init(), 500);
}
