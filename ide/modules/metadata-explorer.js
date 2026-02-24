/**
 * SF-Intel Studio - Metadata Explorer Module
 */

const MetadataExplorer = {
    async loadAll() {
        if (!window.apiClient) {
            console.warn('[MetadataExplorer] API client not ready yet.');
            return;
        }

        const tree = document.getElementById('sf-intel-tree');
        if (tree) tree.innerHTML = `<div class="loading">Loading metadata...</div>`;

        try {
            const [classes, triggers, lwcs, auras] = await Promise.all([
                window.apiClient.getApexClasses(),
                window.apiClient.getApexTriggers(),
                window.apiClient.getLwcBundles(),
                window.apiClient.getAuraBundles()
            ]);

            window.metadataCache.ApexClass = classes;
            window.metadataCache.ApexTrigger = triggers;
            window.metadataCache.LWC = lwcs;
            window.metadataCache.AuraDefinitionBundle = auras;

            this.render();
        } catch (error) {
            console.error('[SF-Intel] Failed to load metadata:', error);
            if (tree) tree.innerHTML = `<div class="loading" style="color:#ff6b6b;">${error.message}</div>`;
        }
    },

    async render(filterStr = '') {
        const tree = document.getElementById('sf-intel-tree');
        if (!tree) return;

        const currentType = window.currentType;
        const items = window.metadataCache[currentType] || [];
        const filter = filterStr.toLowerCase();

        const filtered = items.filter(item => {
            const name = item.Name || item.DeveloperName;
            return name.toLowerCase().includes(filter);
        });

        if (filtered.length === 0) {
            tree.innerHTML = `<div class="loading">No ${currentType} items found.</div>`;
            return;
        }

        let html = '';
        for (const item of filtered) {
            const id = item.Id;
            const name = item.Name || item.DeveloperName;

            if (currentType === 'LWC') {
                const isExpanded = window.expandedFolders.has(id);
                html += `
                    <div class="sf-item lwc-bundle ${isExpanded ? 'expanded' : ''}" data-id="${id}" data-name="${name}">
                        <span class="folder-toggle">▶</span>
                        <span class="icon"><img src="../icons/lwc-component.svg" class="sf-icon"></span>
                        <span class="name">${name}</span>
                    </div>
                `;

                if (isExpanded && window.lwcBundleCache[id]) {
                    window.lwcBundleCache[id].forEach((file, index) => {
                        const fileName = file.FilePath.split('/').pop();
                        const isActive = window.activeTabId === file.Id;
                        html += `
                            <div class="sf-sub-item ${isActive ? 'active' : ''}" data-bundle-id="${id}" data-file-id="${file.Id}" data-index="${index}">
                                <span class="icon">${this.getFileIcon(fileName)}</span>
                                <span class="name">${fileName}</span>
                            </div>
                        `;
                    });
                } else if (isExpanded && !window.lwcBundleCache[id]) {
                    html += `<div class="sf-sub-item loading-sub-item" style="padding-left: 35px;">Loading files...</div>`;
                    this.fetchLwcBundleFiles(id);
                }
            } else if (currentType === 'AuraDefinitionBundle') {
                const isExpanded = window.expandedFolders.has(id);
                html += `
                    <div class="sf-item aura-bundle ${isExpanded ? 'expanded' : ''}" data-id="${id}" data-name="${name}">
                        <span class="folder-toggle">▶</span>
                        <span class="icon"><img src="../icons/aura-component.svg" class="sf-icon"></span>
                        <span class="name">${name}</span>
                    </div>
                `;

                if (isExpanded && window.auraBundleCache[id]) {
                    window.auraBundleCache[id].forEach((file, index) => {
                        const fileName = file.path.split('/').pop();
                        const isActive = window.activeTabId === file.Id;
                        html += `
                            <div class="sf-sub-item ${isActive ? 'active' : ''}" data-bundle-id="${id}" data-file-id="${file.Id}" data-index="${index}">
                                <span class="icon">${this.getFileIcon(fileName)}</span>
                                <span class="name">${fileName}</span>
                            </div>
                        `;
                    });
                } else if (isExpanded && !window.auraBundleCache[id]) {
                    html += `<div class="sf-sub-item loading-sub-item" style="padding-left: 35px;">Loading files...</div>`;
                    this.fetchAuraBundleFiles(id);
                }
            } else {
                let icon;
                if (currentType === 'ApexClass') {
                    icon = '<img src="../icons/apex-class.svg" class="sf-icon">';
                } else if (currentType === 'ApexTrigger') {
                    icon = '<img src="../icons/apex-trigger.svg" class="sf-icon">';
                } else {
                    icon = '<img src="../icons/apex-class.svg" class="sf-icon">';
                }
                const isActive = window.activeTabId === id;
                html += `
                    <div class="sf-item ${isActive ? 'active' : ''}" data-id="${id}" data-name="${name}">
                        <span class="icon">${icon}</span>
                        <span class="name">${name}</span>
                    </div>
                `;
            }
        }

        tree.innerHTML = html;

        // Bind events
        tree.querySelectorAll('.sf-item').forEach(el => {
            el.onclick = (e) => {
                e.stopPropagation();
                if (window.currentType === 'LWC' || window.currentType === 'AuraDefinitionBundle') {
                    this.toggleFolder(el.dataset.id);
                } else {
                    window.openItem(el.dataset.id, el.dataset.name, window.currentType);
                }
            };
        });

        tree.querySelectorAll('.sf-sub-item').forEach(el => {
            el.onclick = (e) => {
                e.stopPropagation();
                if (window.currentType === 'LWC') {
                    window.openLwcFile(el.dataset.bundleId, el.dataset.index, 'LWC');
                } else if (window.currentType === 'AuraDefinitionBundle') {
                    window.openAuraFile(el.dataset.bundleId, el.dataset.index, 'AuraDefinitionBundle');
                }
            };
        });
    },

    getFileIcon(name) {
        if (name.endsWith('.js')) return '<span class="file-icon js">JS</span>';
        if (name.endsWith('.html') || name.endsWith('.cmp')) return '<span class="file-icon html">&lt;&gt;</span>';
        if (name.endsWith('.css')) return '<span class="file-icon css">#</span>';
        if (name.endsWith('.xml')) return '<span class="file-icon xml">📡</span>';
        if (name.endsWith('.design')) return '<span class="file-icon html">&lt;&gt;</span>';
        if (name.endsWith('.app')) return '🌐';
        if (name.endsWith('.evt')) return '🔔';
        if (name.endsWith('.intf')) return '🔗';
        if (name.endsWith('.tokens')) return '🎨';
        if (name.endsWith('.auradoc')) return '📖';
        if (name.endsWith('.svg')) return '🖼️';
        return '📄';
    },

    switchType(type) {
        window.currentType = type;
        document.querySelectorAll('.sf-intel-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.type === type);
        });
        this.render(document.getElementById('sf-intel-search')?.value || '');
    },

    switchView(view) {
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === view);
        });
        document.querySelectorAll('.sidebar-panel').forEach(panel => {
            panel.classList.toggle('active', panel.id === `${view}-panel`);
        });
    },

    async toggleFolder(id) {
        if (window.expandedFolders.has(id)) {
            window.expandedFolders.delete(id);
        } else {
            window.expandedFolders.add(id);
            if (window.currentType === 'LWC' && !window.lwcBundleCache[id]) {
                await this.fetchLwcBundleFiles(id);
            } else if (window.currentType === 'AuraDefinitionBundle' && !window.auraBundleCache[id]) {
                await this.fetchAuraBundleFiles(id);
            }
        }
        this.render(document.getElementById('sf-intel-search')?.value || '');
    },

    async fetchLwcBundleFiles(bundleId) {
        try {
            window.lwcBundleCache[bundleId] = await window.apiClient.getLwcBundleFiles(bundleId);
            this.render(document.getElementById('sf-intel-search')?.value || '');
        } catch (error) {
            console.error('Failed to load LWC bundle files:', error);
            if (window.Terminal) window.Terminal.error(`Failed to load LWC bundle files for ${bundleId}: ${error.message}`);
        }
    },

    async fetchAuraBundleFiles(bundleId) {
        if (window.Terminal) window.Terminal.log(`Fetching files for Aura bundle: ${bundleId}...`);
        try {
            const files = await window.apiClient.getAuraBundleFiles(bundleId);

            // Try to find the bundle name from multiple sources
            const cachedBundle = window.metadataCache.AuraDefinitionBundle.find(b => b.Id === bundleId);
            const firstFileWithBundle = files.find(f => f.AuraDefinitionBundle && f.AuraDefinitionBundle.DeveloperName);
            const name = cachedBundle ? cachedBundle.DeveloperName : (firstFileWithBundle ? firstFileWithBundle.AuraDefinitionBundle.DeveloperName : 'Unknown');

            files.forEach(f => {
                let fileName = name + (f.Suffix || '') + '.' + f.Extension;
                f.path = `aura/${name}/${fileName}`;
                f.bundleName = name;
                f.content = f.Source;
            });

            files.sort((a, b) => {
                const extOrder = { 'cmp': 1, 'app': 1, 'intf': 1, 'evt': 1, 'tokens': 1, 'js': 2, 'css': 3, 'auradoc': 4, 'svg': 5 };
                const ea = extOrder[a.Extension] || 99;
                const eb = extOrder[b.Extension] || 99;
                return ea - eb;
            });

            window.auraBundleCache[bundleId] = files;
            this.render(document.getElementById('sf-intel-search')?.value || '');
        } catch (err) {
            if (window.Terminal) window.Terminal.error(`Failed to load Aura files: ${err.message}`);
        }
    }
};

// Export to window
window.MetadataExplorer = MetadataExplorer;
