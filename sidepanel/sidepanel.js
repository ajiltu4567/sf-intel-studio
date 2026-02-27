/**
 * SF-Intel Studio - Side Panel IDE
 * Main IDE logic for side panel
 */

class SidePanelIDE {
    constructor() {
        this.editor = null;
        this.currentFile = null;
        this.openTabs = new Map();
        this.fileTree = [];
        this.isModified = false;
    }

    /**
     * Initialize IDE
     */
    async init() {
        console.log('[IDE] Initializing...');

        // Load Monaco Editor
        try {
            await monacoLoader.load();
            console.log('[IDE] Monaco loaded');
        } catch (error) {
            console.error('[IDE] Failed to load Monaco:', error);
            this.showError('Failed to load code editor');
            return;
        }

        // Set up event listeners
        this.setupEventListeners();

        // Load files
        await this.loadFiles();

        // Check server status
        await this.checkServerStatus();

        console.log('[IDE] Initialized successfully');
    }

    /**
     * Set up event listeners
     */
    setupEventListeners() {
        // Header actions
        document.getElementById('refreshFiles').addEventListener('click', () => this.loadFiles());
        document.getElementById('openFullIDE').addEventListener('click', () => {
            chrome.tabs.create({ url: chrome.runtime.getURL('ide/ide.html') });
        });

        // File tree actions
        document.getElementById('syncOrg').addEventListener('click', () => this.syncOrg());
        document.getElementById('collapseAll').addEventListener('click', () => this.collapseAllFolders());

        // Editor actions
        document.getElementById('saveFile').addEventListener('click', () => this.saveCurrentFile());
        document.getElementById('deployFile').addEventListener('click', () => this.deployCurrentFile());

        // Intelligence panel
        document.getElementById('toggleIntelligence').addEventListener('click', () => {
            const panel = document.getElementById('intelligenceContent');
            panel.classList.toggle('collapsed');
        });
    }

    /**
     * Load files from API
     */
    async loadFiles() {
        const loading = document.getElementById('fileTreeLoading');
        const tree = document.getElementById('fileTree');
        const empty = document.getElementById('fileTreeEmpty');

        loading.style.display = 'flex';
        tree.style.display = 'none';
        empty.style.display = 'none';

        try {
            const classes = await sfIntelAPI.getClasses();
            console.log('[IDE] Loaded classes:', classes);

            if (!classes || classes.length === 0) {
                empty.style.display = 'flex';
                loading.style.display = 'none';
                return;
            }

            this.fileTree = this.organizeFiles(classes);
            this.renderFileTree();

            tree.style.display = 'block';
            loading.style.display = 'none';
        } catch (error) {
            console.error('[IDE] Failed to load files:', error);
            empty.style.display = 'flex';
            loading.style.display = 'none';
            this.showError('Failed to load files');
        }
    }

    /**
     * Organize files into tree structure
     * @param {Array} classes
     * @returns {Array}
     */
    organizeFiles(classes) {
        const tree = [
            {
                name: 'Apex Classes',
                type: 'folder',
                icon: '📁',
                expanded: true,
                children: []
            }
        ];

        // Group classes
        classes.forEach(cls => {
            const className = typeof cls === 'string' ? cls : cls.name;
            tree[0].children.push({
                name: className,
                type: 'file',
                icon: '📄',
                path: `classes/${className}.cls`
            });
        });

        // Sort alphabetically
        tree[0].children.sort((a, b) => a.name.localeCompare(b.name));

        return tree;
    }

    /**
     * Render file tree
     */
    renderFileTree() {
        const container = document.getElementById('fileTree');
        container.innerHTML = '';

        const renderNode = (node, level = 0) => {
            const item = document.createElement('div');
            item.className = 'file-tree-item';
            item.style.paddingLeft = `${level * 16 + 8}px`;

            if (node.type === 'folder') {
                item.classList.add('file-tree-folder');
                if (node.expanded) item.classList.add('expanded');

                item.innerHTML = `
          <span class="file-tree-item__toggle">${node.expanded ? '▼' : '▶'}</span>
          <span class="file-tree-item__icon">${node.icon}</span>
          <span class="file-tree-item__name">${node.name}</span>
        `;

                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    node.expanded = !node.expanded;
                    this.renderFileTree();
                });

                container.appendChild(item);

                // Render children if expanded
                if (node.expanded && node.children) {
                    node.children.forEach(child => renderNode(child, level + 1));
                }
            } else {
                item.classList.add('file-tree-file');
                item.innerHTML = `
          <span class="file-tree-item__icon">${node.icon}</span>
          <span class="file-tree-item__name">${node.name}</span>
        `;

                item.addEventListener('click', () => {
                    this.openFile(node);
                });

                container.appendChild(item);
            }
        };

        this.fileTree.forEach(node => renderNode(node));
    }

    /**
     * Open file in editor
     * @param {Object} fileNode
     */
    async openFile(fileNode) {
        console.log('[IDE] Opening file:', fileNode.name);

        // Save current file if modified
        if (this.isModified) {
            const shouldSave = confirm('Save changes before opening new file?');
            if (shouldSave) {
                await this.saveCurrentFile();
            }
        }

        try {
            // Fetch file content
            const content = await this.fetchFileContent(fileNode.name);

            // Create editor if doesn't exist
            if (!this.editor) {
                this.createEditor();
            }

            // Set content
            this.editor.setValue(content);
            this.currentFile = fileNode;
            this.isModified = false;

            // Update UI
            this.updateEditorUI();

            // Analyze file
            await this.analyzeCurrentFile();

        } catch (error) {
            console.error('[IDE] Failed to open file:', error);
            this.showError(`Failed to open ${fileNode.name}`);
        }
    }

    /**
     * Fetch file content from API
     * @param {string} className
     * @returns {Promise<string>}
     */
    async fetchFileContent(className) {
        // Try to get from API
        try {
            const response = await fetch(`http://localhost:3000/api/files/${encodeURIComponent(className)}`);
            if (response.ok) {
                const data = await response.json();
                return data.content || data.body || '';
            }
        } catch (error) {
            console.warn('[IDE] API fetch failed, using placeholder');
        }

        // Placeholder content if API doesn't have endpoint yet
        return `public class ${className} {\n    // Class content will be fetched from Salesforce\n    // Coming soon...\n}\n`;
    }

    /**
     * Create Monaco editor
     */
    createEditor() {
        const container = document.getElementById('editorContainer');
        const empty = document.getElementById('editorEmpty');

        this.editor = monacoLoader.createEditor(container, {
            value: '',
            language: 'apex',
            theme: 'vs-dark'
        });

        // Listen for changes
        this.editor.onDidChangeModelContent(() => {
            this.isModified = true;
            this.updateEditorUI();
        });

        // Listen for cursor position
        this.editor.onDidChangeCursorPosition((e) => {
            const position = document.getElementById('editorPosition');
            position.textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
        });

        // Show editor, hide empty state
        container.style.display = 'block';
        document.getElementById('editorTabs').style.display = 'flex';
        document.getElementById('editorFooter').style.display = 'flex';
        empty.style.display = 'none';

        console.log('[IDE] Editor created');
    }

    /**
     * Update editor UI (tabs, status)
     */
    updateEditorUI() {
        if (!this.currentFile) return;

        // Update modified indicator
        const modified = document.getElementById('editorModified');
        modified.style.display = this.isModified ? 'inline' : 'none';

        // Update tab (simple for now)
        const tabs = document.getElementById('editorTabs');
        tabs.innerHTML = `
      <div class="editor-tab active">
        <span class="editor-tab__icon">📄</span>
        <span class="editor-tab__name">${this.currentFile.name}</span>
        ${this.isModified ? '<span class="editor-tab__modified">●</span>' : ''}
      </div>
    `;
    }

    /**
     * Save current file
     */
    async saveCurrentFile() {
        if (!this.currentFile || !this.editor) return;

        const content = this.editor.getValue();
        console.log('[IDE] Saving file:', this.currentFile.name);

        try {
            // TODO: Implement save via API
            // For now, just mark as saved
            this.isModified = false;
            this.updateEditorUI();
            this.showSuccess('File saved locally');
        } catch (error) {
            console.error('[IDE] Save failed:', error);
            this.showError('Failed to save file');
        }
    }

    /**
     * Deploy current file to Salesforce
     */
    async deployCurrentFile() {
        if (!this.currentFile || !this.editor) return;

        const content = this.editor.getValue();
        console.log('[IDE] Deploying file:', this.currentFile.name);

        try {
            // TODO: Implement deployment via API
            this.showInfo('Deployment coming soon...');
        } catch (error) {
            console.error('[IDE] Deploy failed:', error);
            this.showError('Failed to deploy file');
        }
    }

    /**
     * Analyze current file for intelligence
     */
    async analyzeCurrentFile() {
        if (!this.currentFile) return;

        const intelligenceLoading = document.querySelector('.intelligence-loading');
        const intelligenceData = document.getElementById('intelligenceData');

        intelligenceLoading.style.display = 'flex';
        intelligenceData.style.display = 'none';

        try {
            const className = this.currentFile.name.replace('.cls', '');
            const [impact, context] = await Promise.allSettled([
                sfIntelAPI.getImpactAnalysis(className),
                sfIntelAPI.getContextAnalysis(className)
            ]);

            const impactData = impact.status === 'fulfilled' ? impact.value : null;
            const contextData = context.status === 'fulfilled' ? context.value : null;

            this.renderIntelligence(impactData, contextData);

            intelligenceLoading.style.display = 'none';
            intelligenceData.style.display = 'block';
        } catch (error) {
            console.error('[IDE] Analysis failed:', error);
            intelligenceLoading.style.display = 'none';
        }
    }

    /**
     * Render intelligence panel
     */
    renderIntelligence(impact, context) {
        const container = document.getElementById('intelligenceData');

        let html = '<div class="intelligence-sections">';

        // Impact section
        if (impact) {
            const dependents = impact.dependents || [];
            const dependencies = impact.dependencies || [];

            html += `
        <div class="intelligence-section">
          <h4>Impact</h4>
          <div class="stat-row">
            <div class="stat"><strong>${dependents.length}</strong> Dependents</div>
            <div class="stat"><strong>${dependencies.length}</strong> Dependencies</div>
          </div>
        </div>
      `;
        }

        // Context section
        if (context) {
            const methods = context.methods || [];
            const soql = context.soql_queries || [];

            html += `
        <div class="intelligence-section">
          <h4>Context</h4>
          <div class="stat-row">
            <div class="stat"><strong>${methods.length}</strong> Methods</div>
            <div class="stat"><strong>${soql.length}</strong> SOQL Queries</div>
          </div>
        </div>
      `;
        }

        html += '</div>';
        container.innerHTML = html;
    }

    /**
     * Check server status
     */
    async checkServerStatus() {
        const isRunning = await sfIntelAPI.isServerRunning();
        if (!isRunning) {
            this.showWarning('SF-Intel server is offline. Start it to enable full features.');
        }
    }

    /**
     * Collapse all folders
     */
    collapseAllFolders() {
        this.fileTree.forEach(node => {
            if (node.type === 'folder') {
                node.expanded = false;
            }
        });
        this.renderFileTree();
    }

    /**
     * Sync org (refresh from Salesforce)
     */
    async syncOrg() {
        this.showInfo('Org sync coming soon...');
    }

    /**
     * Show notification
     */
    showNotification(message, type) {
        // Simple console for now
        console.log(`[${type.toUpperCase()}]`, message);
        // TODO: Implement toast notifications
    }

    showSuccess(message) { this.showNotification(message, 'success'); }
    showError(message) { this.showNotification(message, 'error'); }
    showWarning(message) { this.showNotification(message, 'warning'); }
    showInfo(message) { this.showNotification(message, 'info'); }
}

// Initialize IDE when DOM is ready
const ide = new SidePanelIDE();

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ide.init());
} else {
    ide.init();
}

// Make IDE available globally for debugging
window.ide = ide;
