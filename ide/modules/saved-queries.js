/**
 * SF-Intel Studio - Saved & Recent Queries Manager
 * Handles persistence, UI panels, and Save/Load for SOQL queries.
 */

window.SavedQueries = {
    STORAGE_KEY: 'sf-intel-saved-queries',
    RECENT_KEY: 'sf-intel-recent-queries',
    MAX_RECENT: 30,

    _savedQueries: [],    // { id, name, soql, description, createdAt, modifiedAt }
    _recentQueries: [],   // { soql, objectName, timestamp }
    _activeQueryId: null,  // ID of saved query currently in editor
    _panelOpen: null,      // 'saved' | 'recent' | null

    // --- Initialization ---

    init() {
        this._loadFromStorage();
        this._bindUI();
        console.log(`[SavedQueries] Initialized: ${this._savedQueries.length} saved, ${this._recentQueries.length} recent`);
    },

    // --- Storage ---

    _loadFromStorage() {
        try {
            const saved = localStorage.getItem(this.STORAGE_KEY);
            if (saved) this._savedQueries = JSON.parse(saved);
        } catch (e) {
            console.warn('[SavedQueries] Failed to load saved queries:', e);
        }
        try {
            const recent = localStorage.getItem(this.RECENT_KEY);
            if (recent) this._recentQueries = JSON.parse(recent);
        } catch (e) {
            console.warn('[SavedQueries] Failed to load recent queries:', e);
        }
    },

    _persistSaved() {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this._savedQueries));
        } catch (e) {
            console.error('[SavedQueries] Failed to save:', e);
            if (window.Terminal) window.Terminal.error('Failed to save query: storage unavailable');
        }
    },

    _persistRecent() {
        try {
            localStorage.setItem(this.RECENT_KEY, JSON.stringify(this._recentQueries));
        } catch (e) {
            console.warn('[SavedQueries] Failed to persist recent queries:', e);
        }
    },

    // --- Save Query ---

    saveQuery(name, soql, description) {
        if (!name || !name.trim()) return { ok: false, error: 'Name is required' };
        if (!soql || !soql.trim()) return { ok: false, error: 'Query is empty' };

        const trimName = name.trim();
        const existing = this._savedQueries.find(q => q.name.toLowerCase() === trimName.toLowerCase());
        if (existing) return { ok: false, error: 'A query with this name already exists' };

        const query = {
            id: 'sq-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
            name: trimName,
            soql: soql.trim(),
            description: (description || '').trim(),
            createdAt: new Date().toISOString(),
            modifiedAt: new Date().toISOString()
        };

        this._savedQueries.unshift(query);
        this._persistSaved();
        this._activeQueryId = query.id;

        if (window.Terminal) window.Terminal.success(`Query "${trimName}" saved successfully`);
        return { ok: true, query };
    },

    updateQuery(id, soql) {
        const query = this._savedQueries.find(q => q.id === id);
        if (!query) return { ok: false, error: 'Query not found' };

        query.soql = soql.trim();
        query.modifiedAt = new Date().toISOString();
        this._persistSaved();

        if (window.Terminal) window.Terminal.success(`Query "${query.name}" updated`);
        return { ok: true, query };
    },

    deleteQuery(id) {
        const idx = this._savedQueries.findIndex(q => q.id === id);
        if (idx === -1) return;

        const name = this._savedQueries[idx].name;
        this._savedQueries.splice(idx, 1);
        this._persistSaved();

        if (this._activeQueryId === id) this._activeQueryId = null;
        if (window.Terminal) window.Terminal.log(`Query "${name}" deleted`);
    },

    renameQuery(id, newName) {
        if (!newName || !newName.trim()) return { ok: false, error: 'Name is required' };
        const query = this._savedQueries.find(q => q.id === id);
        if (!query) return { ok: false, error: 'Query not found' };

        const trimName = newName.trim();
        const dup = this._savedQueries.find(q => q.id !== id && q.name.toLowerCase() === trimName.toLowerCase());
        if (dup) return { ok: false, error: 'Name already exists' };

        query.name = trimName;
        query.modifiedAt = new Date().toISOString();
        this._persistSaved();
        return { ok: true };
    },

    // --- Recent Queries ---

    addRecent(soql) {
        if (!soql || !soql.trim()) return;
        const trimmed = soql.trim();

        // Remove duplicate if exists
        this._recentQueries = this._recentQueries.filter(q => q.soql !== trimmed);

        const fromMatch = trimmed.match(/FROM\s+(\w+)/i);
        this._recentQueries.unshift({
            soql: trimmed,
            objectName: fromMatch ? fromMatch[1] : null,
            timestamp: new Date().toISOString()
        });

        // Keep max
        if (this._recentQueries.length > this.MAX_RECENT) {
            this._recentQueries = this._recentQueries.slice(0, this.MAX_RECENT);
        }

        this._persistRecent();
    },

    clearRecent() {
        this._recentQueries = [];
        this._persistRecent();
    },

    // --- Load Query into Editor ---

    loadQuery(soql, savedQueryId) {
        if (!soql) return;

        this._activeQueryId = savedQueryId || null;

        if (window.sendToEditor) {
            window.sendToEditor({ type: 'SET_VALUE', value: soql }, 'utility');
        }

        // Close panel
        this.closePanel();
    },

    // --- Get Active Query ID ---

    getActiveQueryId() {
        return this._activeQueryId;
    },

    getActiveQuery() {
        if (!this._activeQueryId) return null;
        return this._savedQueries.find(q => q.id === this._activeQueryId) || null;
    },

    clearActiveQuery() {
        this._activeQueryId = null;
    },

    // --- Panel UI ---

    openPanel(type) {
        // Close any open panel first
        this.closePanel();

        this._panelOpen = type;
        const panelId = type === 'saved' ? 'soql-saved-panel' : 'soql-recent-panel';
        const panel = document.getElementById(panelId);
        if (!panel) return;

        // Render list
        if (type === 'saved') {
            this._renderSavedList();
        } else {
            this._renderRecentList();
        }

        // Open with animation
        requestAnimationFrame(() => {
            panel.classList.add('open');
        });

        // Highlight active button
        const btnId = type === 'saved' ? 'soql-action-saved' : 'soql-action-recent';
        const btn = document.getElementById(btnId);
        if (btn) btn.classList.add('active');
    },

    closePanel() {
        const panels = document.querySelectorAll('.soql-queries-panel');
        panels.forEach(p => p.classList.remove('open'));

        document.querySelectorAll('#soql-action-saved, #soql-action-recent').forEach(b => b.classList.remove('active'));
        this._panelOpen = null;
    },

    togglePanel(type) {
        if (this._panelOpen === type) {
            this.closePanel();
        } else {
            this.openPanel(type);
        }
    },

    // --- Render Saved Queries List ---

    _renderSavedList(filter) {
        const container = document.getElementById('soql-saved-list');
        if (!container) return;

        let queries = this._savedQueries;
        if (filter) {
            const lower = filter.toLowerCase();
            queries = queries.filter(q =>
                q.name.toLowerCase().includes(lower) ||
                q.soql.toLowerCase().includes(lower)
            );
        }

        if (queries.length === 0) {
            container.innerHTML = `<div class="soql-queries-empty">${filter ? 'No matching queries' : 'No saved queries yet'}</div>`;
            return;
        }

        container.innerHTML = queries.map(q => {
            const preview = q.soql.length > 100 ? q.soql.substring(0, 100) + '...' : q.soql;
            const date = new Date(q.modifiedAt).toLocaleDateString();
            const isActive = q.id === this._activeQueryId;
            return `
                <div class="soql-query-item ${isActive ? 'active' : ''}" data-id="${q.id}">
                    <div class="soql-query-item-header">
                        <span class="soql-query-item-name">${this._escapeHtml(q.name)}</span>
                        <div class="soql-query-item-actions">
                            <button class="soql-query-item-btn" data-action="delete" data-id="${q.id}" title="Delete">
                                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1h2.5a1 1 0 0 1 1 1v1zM4.118 4L4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg>
                            </button>
                        </div>
                    </div>
                    <div class="soql-query-item-preview">${this._escapeHtml(preview)}</div>
                    <div class="soql-query-item-meta">${date}</div>
                </div>
            `;
        }).join('');

        // Bind click handlers
        container.querySelectorAll('.soql-query-item').forEach(item => {
            item.onclick = (e) => {
                // Don't load if clicking action buttons
                if (e.target.closest('.soql-query-item-btn')) return;
                const id = item.dataset.id;
                const query = this._savedQueries.find(q => q.id === id);
                if (query) this.loadQuery(query.soql, query.id);
            };
        });

        container.querySelectorAll('.soql-query-item-btn[data-action="delete"]').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const query = this._savedQueries.find(q => q.id === id);
                if (query && confirm(`Delete "${query.name}"?`)) {
                    this.deleteQuery(id);
                    this._renderSavedList(document.getElementById('soql-saved-search')?.value);
                }
            };
        });
    },

    // --- Render Recent Queries List ---

    _renderRecentList() {
        const container = document.getElementById('soql-recent-list');
        if (!container) return;

        if (this._recentQueries.length === 0) {
            container.innerHTML = '<div class="soql-queries-empty">No recent queries</div>';
            return;
        }

        container.innerHTML = this._recentQueries.map((q, i) => {
            const preview = q.soql.length > 100 ? q.soql.substring(0, 100) + '...' : q.soql;
            const time = this._formatRelativeTime(q.timestamp);
            const objLabel = q.objectName ? `<span class="soql-query-item-object">${q.objectName}</span>` : '';
            return `
                <div class="soql-query-item" data-index="${i}">
                    <div class="soql-query-item-header">
                        ${objLabel}
                        <span class="soql-query-item-time">${time}</span>
                    </div>
                    <div class="soql-query-item-preview">${this._escapeHtml(preview)}</div>
                </div>
            `;
        }).join('') + `
            <div class="soql-queries-panel-footer">
                <button id="soql-clear-recent" class="soql-queries-clear-btn">Clear Recent</button>
            </div>
        `;

        container.querySelectorAll('.soql-query-item').forEach(item => {
            item.onclick = () => {
                const idx = parseInt(item.dataset.index);
                const q = this._recentQueries[idx];
                if (q) this.loadQuery(q.soql, null);
            };
        });

        const clearBtn = document.getElementById('soql-clear-recent');
        if (clearBtn) {
            clearBtn.onclick = () => {
                this.clearRecent();
                this._renderRecentList();
            };
        }
    },

    // --- Save Modal ---

    showSaveModal() {
        // Check if editor has content
        const modelId = window.UtilsPanel?.activeSoqlTab?.modelId || 'util-soql-1';

        // Get current content from editor
        window.sendToEditor({ type: 'GET_CONTENT', modelId }, 'utility');

        const handler = (event) => {
            if (event.origin !== window.location.origin) return; // P0 Security: origin validation
            const msg = event.data;
            if (msg.type === 'CONTENT_RESULT' && msg.id === modelId) {
                window.removeEventListener('message', handler);
                const soql = (msg.value || '').trim();

                if (!soql) {
                    if (window.Terminal) window.Terminal.warn('Cannot save: editor is empty');
                    return;
                }

                const activeQuery = this.getActiveQuery();
                if (activeQuery) {
                    // Query already saved - offer Update or Save As New
                    this._showUpdateOrSaveNew(activeQuery, soql);
                } else {
                    // New query - show save modal
                    this._showSaveNewModal(soql);
                }
            }
        };
        window.addEventListener('message', handler);
        setTimeout(() => window.removeEventListener('message', handler), 3000);
    },

    _showSaveNewModal(soql) {
        this._removeModal();

        const modal = document.createElement('div');
        modal.id = 'soql-save-modal';
        modal.className = 'sf-intel-modal-overlay';
        modal.innerHTML = `
            <div class="sf-intel-modal soql-save-modal">
                <div class="sf-intel-modal-header">Save Query</div>
                <div class="sf-intel-modal-body">
                    <div class="soql-save-field">
                        <label>Query Name <span style="color:#e74c3c">*</span></label>
                        <input type="text" id="soql-save-name" placeholder="e.g. Active Accounts" autofocus />
                        <div class="soql-save-error" id="soql-save-name-error"></div>
                    </div>
                    <div class="soql-save-field">
                        <label>Description (optional)</label>
                        <input type="text" id="soql-save-desc" placeholder="Brief description..." />
                    </div>
                    <div class="soql-save-preview">
                        <label>Query</label>
                        <pre>${this._escapeHtml(soql.length > 200 ? soql.substring(0, 200) + '...' : soql)}</pre>
                    </div>
                </div>
                <div class="sf-intel-modal-footer">
                    <button id="soql-save-cancel" class="modal-btn modal-btn-cancel">Cancel</button>
                    <button id="soql-save-confirm" class="modal-btn modal-btn-primary">Save</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // Focus name input
        setTimeout(() => document.getElementById('soql-save-name')?.focus(), 50);

        // Bind handlers
        const nameInput = document.getElementById('soql-save-name');
        const errorEl = document.getElementById('soql-save-name-error');
        const confirmBtn = document.getElementById('soql-save-confirm');

        document.getElementById('soql-save-cancel').onclick = () => this._removeModal();
        modal.onclick = (e) => { if (e.target === modal) this._removeModal(); };

        // Enter to save
        nameInput.onkeydown = (e) => {
            if (e.key === 'Enter') confirmBtn.click();
            if (e.key === 'Escape') this._removeModal();
        };

        confirmBtn.onclick = () => {
            const name = nameInput.value.trim();
            const desc = document.getElementById('soql-save-desc')?.value || '';

            if (!name) {
                errorEl.textContent = 'Name is required';
                nameInput.focus();
                return;
            }

            const result = this.saveQuery(name, soql, desc);
            if (!result.ok) {
                errorEl.textContent = result.error;
                nameInput.focus();
                return;
            }

            this._removeModal();
        };
    },

    _showUpdateOrSaveNew(activeQuery, soql) {
        this._removeModal();

        const modal = document.createElement('div');
        modal.id = 'soql-save-modal';
        modal.className = 'sf-intel-modal-overlay';
        modal.innerHTML = `
            <div class="sf-intel-modal soql-save-modal">
                <div class="sf-intel-modal-header">Update Query</div>
                <div class="sf-intel-modal-body">
                    <p style="color:#ccc; margin:0 0 12px 0">
                        The editor contains <strong>"${this._escapeHtml(activeQuery.name)}"</strong>.
                    </p>
                    <div class="soql-save-preview">
                        <label>Updated Query</label>
                        <pre>${this._escapeHtml(soql.length > 200 ? soql.substring(0, 200) + '...' : soql)}</pre>
                    </div>
                </div>
                <div class="sf-intel-modal-footer soql-update-footer">
                    <button id="soql-save-cancel" class="modal-btn modal-btn-cancel">Cancel</button>
                    <button id="soql-save-as-new" class="modal-btn modal-btn-secondary">Save as New</button>
                    <button id="soql-save-update" class="modal-btn modal-btn-primary">Update</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        document.getElementById('soql-save-cancel').onclick = () => this._removeModal();
        modal.onclick = (e) => { if (e.target === modal) this._removeModal(); };

        document.getElementById('soql-save-update').onclick = () => {
            this.updateQuery(activeQuery.id, soql);
            this._removeModal();
        };

        document.getElementById('soql-save-as-new').onclick = () => {
            this._removeModal();
            this._showSaveNewModal(soql);
        };
    },

    _removeModal() {
        const modal = document.getElementById('soql-save-modal');
        if (modal) modal.remove();
    },

    // --- UI Bindings ---

    _bindUI() {
        // Save button
        const saveBtn = document.getElementById('soql-save-query-btn');
        if (saveBtn) {
            saveBtn.onclick = () => this.showSaveModal();
        }

        // Saved Queries panel toggle
        const savedBtn = document.getElementById('soql-action-saved');
        if (savedBtn) {
            savedBtn.onclick = () => this.togglePanel('saved');
        }

        // Recent Queries panel toggle
        const recentBtn = document.getElementById('soql-action-recent');
        if (recentBtn) {
            recentBtn.onclick = () => this.togglePanel('recent');
        }

        // Panel close buttons
        const savedClose = document.getElementById('soql-saved-panel-close');
        if (savedClose) savedClose.onclick = () => this.closePanel();

        const recentClose = document.getElementById('soql-recent-panel-close');
        if (recentClose) recentClose.onclick = () => this.closePanel();

        // Saved queries search
        const searchInput = document.getElementById('soql-saved-search');
        if (searchInput) {
            searchInput.oninput = () => {
                this._renderSavedList(searchInput.value);
            };
        }

        // Escape to close panels
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this._panelOpen) {
                this.closePanel();
            }
        });

        // Inline search in editor
        const inlineSearch = document.getElementById('soql-inline-search');
        if (inlineSearch) {
            inlineSearch.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    // Trigger Monaco find
                    window.sendToEditor?.({ type: 'EXECUTE_ACTION', action: 'actions.find' }, 'utility');
                }
            };
        }
    },

    // --- Helpers ---

    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    _formatRelativeTime(isoString) {
        const now = new Date();
        const then = new Date(isoString);
        const diffMs = now - then;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return then.toLocaleDateString();
    }
};
