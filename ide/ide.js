/**
 * SF-Intel Studio - Main IDE Orchestrator
 * Coordinates between modules: workspace, metadata-explorer, utils-panel, terminal
 */

console.log('[SF-Intel] IDE Core Starting - v3.6.2');
const CURRENT_VERSION = '3.6.2';

// SVG icon constants for header buttons
const SVG_SAVE = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2 1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4.414a2 2 0 0 0-.586-1.414L12 .586A2 2 0 0 0 10.586 0H2zm0 1h8.586L13 4.414V14H3V2H2zm2 9a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v3H4v-3z"/></svg>';
const SVG_PLAY = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2l10 6-10 6V2z"/></svg>';
const SVG_CHART = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4 11H2v3h2v-3zm5-4H7v7h2V7zm5-5h-2v12h2V2z"/></svg>';
// --- GLOBAL STATE ---
window.metadataCache = { ApexClass: [], ApexTrigger: [], LWC: [], AuraDefinitionBundle: [] };
window.currentType = 'ApexClass';
window.isSaving = false;
window.activeUtilId = null;
window.activeViewMode = 'editor';
window.expandedFolders = new Set();
window.lwcBundleCache = {};
window.auraBundleCache = {};
window.openTabs = []; // { id, name, mode, content, isDirty }
window.activeTabId = null;
window.lastOpenedLogId = null;
window.apiClient = null; // SalesforceAPIClient instance

// --- CODE COVERAGE STATE (v2.3.0) ---
window.isCoverageEnabled = false;
window.latestCoverageRunId = null;

// --- DIAGNOSTICS STATE (SIP-3.1) ---
window.diagnosticsByFile = new Map(); // modelId -> [{message, severity, line, file}]
window.isMinimapEnabled = false; // SIP-3.4

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    console.log('[SF-Intel] IDE Initializing...');

    setupResizers();
    setupSoqlEditorActions();
    setupApexEditorActions();
    setupNavigation();
    setupSandboxBridge();

    // Initialize Saved Queries Manager
    if (window.SavedQueries) window.SavedQueries.init();

    // Get context from background script
    chrome.runtime.sendMessage({ action: 'get-active-context' }, async (response) => {
        if (response && response.sessionId) {
            console.log('[SF-Intel] Context received, initializing API client.');
            window.apiClient = new SalesforceAPIClient(response.sessionId, response.instanceUrl);

            // Modular Extension: Initialize Record API without touching core (v2.4.2)
            if (window.extendApiClientWithRecordMethods) {
                window.extendApiClientWithRecordMethods(window.apiClient);
            }
            if (window.extendApiClientWithWorkflowMethods) {
                window.extendApiClientWithWorkflowMethods(window.apiClient);
            }
            document.getElementById('instance-url').textContent = response.instanceUrl.replace('https://', '');

            // Update status bar org name
            const statusOrgName = document.querySelector('#current-org .org-name');
            if (statusOrgName) {
                const orgName = response.instanceUrl.replace('https://', '').split('.')[0];
                statusOrgName.textContent = orgName;
            }

            // ── Org environment detection (via OrgEnvironment module) ────────
            // Computed once per session, cached in window._orgEnvironmentResult
            window.apiClient.query('SELECT Id, IsSandbox, OrganizationType, Name FROM Organization LIMIT 1')
                .then(res => {
                    const org = res?.records?.[0];
                    if (window.OrgEnvironment) {
                        window.OrgEnvironment.renderBadge(
                            window.OrgEnvironment.classify(org, response.instanceUrl)
                        );
                    }
                })
                .catch(() => {
                    if (window.OrgEnvironment) {
                        window.OrgEnvironment.renderBadge(
                            window.OrgEnvironment.classify(null, response.instanceUrl)
                        );
                    }
                });

            // Context-received callback handles initial load.
            if (window.MetadataExplorer) {
                await window.MetadataExplorer.loadAll();
            }

            // Initialize Native Messaging Connection (v3.3.0)
            if (window.ConnectionManager) {
                window.connectionManager = new ConnectionManager();
                await window.connectionManager.initialize();
                console.log('[SF-Intel] Connection type:', window.connectionManager.getConnectionType());
                
                // Initialize Status Manager (shows connection state)
                if (window.StatusManager) {
                    window.statusManager = new StatusManager(window.connectionManager);
                    await window.statusManager.initialize();
                }
            }

            if (window.Terminal) {
                window.Terminal.log(`SF-Intel Studio v${CURRENT_VERSION} loaded.`);
                window.Terminal.success('System Ready.');
            }

            // Initialize Modules
            if (window.TestRunner) window.TestRunner.init();
            if (window.AnalysisPanel) window.AnalysisPanel.init();
            if (window.SchemaExplorer) window.SchemaExplorer.init();

            // Bind Global Runner Button (v1.8.3 CSP Compliant)
            const runTestBtn = document.getElementById('sf-intel-run-test');
            if (runTestBtn) {
                runTestBtn.addEventListener('click', () => {
                    if (window.TestRunner) window.TestRunner.runCurrentClass();
                });
            }

            // Bind Coverage Toggle Button (v2.3.0)
            const coverageBtn = document.getElementById('sf-intel-coverage-toggle');
            if (coverageBtn) {
                coverageBtn.addEventListener('click', () => {
                    toggleCoverage();
                });
            }
        } else {
            console.error('[SF-Intel] Failed to get active context.');
            if (window.Terminal) {
                window.Terminal.error('Failed to connect to Salesforce. Please open the extension from a Salesforce tab.');
            }
        }
        
        // Report Issue button
        const reportIssueBtn = document.getElementById('report-issue-status');
        if (reportIssueBtn) {
            reportIssueBtn.addEventListener('click', () => {
                window.open('https://github.com/Ajil5467/sf-intel-studio-issues/issues/new', '_blank');
            });
        }

        // Check for Release Notes (SIP-3.4)
        checkReleaseNotes();
    });

    // Inspector Tab Switching (SIP-3.0)
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.onclick = () => {
            const view = btn.dataset.view;
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
            document.querySelectorAll('.inspector-view').forEach(v => {
                v.classList.toggle('active', v.id === `view-${view}`);
            });
        };
    });

    // Inspector Clear Button
    const clearInspecBtn = document.getElementById('inspector-clear-btn');
    if (clearInspecBtn) {
        clearInspecBtn.onclick = () => {
            ['view-tree', 'view-raw', 'view-timeline', 'view-errors', 'view-limits'].forEach(v => {
                const el = document.getElementById(v);
                if (el) el.innerHTML = '';
            });
            if (window.Terminal) window.Terminal.log('Log Inspector cleared.');
        };
    }

    console.log('[SF-Intel] setupNavigation calling (guarded)...');
    // setupNavigation() is already called on line 24.

    // Global Header Toggle (Emergency UX)
    const panelHeader = document.getElementById('bottom-panel-header');
    if (panelHeader) {
        panelHeader.addEventListener('click', (e) => {
            // Only toggle if we didn't click an actual button or tab
            if (!e.target.closest('button') && !e.target.closest('.bottom-tab')) {
                console.log('[SF-Intel] Toggle Bottom Panel from header click');
                if (window.Terminal) window.Terminal.toggle();
            }
        });
    }

    // Editor Toolbar Actions
    const edToggleMinimap = document.getElementById('ed-toggle-minimap');
    if (edToggleMinimap) {
        edToggleMinimap.onclick = () => {
             window.isMinimapEnabled = !window.isMinimapEnabled;
             edToggleMinimap.classList.toggle('active', window.isMinimapEnabled);
             sendToEditor({ type: 'TOGGLE_MINIMAP', enabled: window.isMinimapEnabled });
        };
    }

    const edToggleSidebar = document.getElementById('ed-toggle-sidebar');
    if (edToggleSidebar) {
        edToggleSidebar.onclick = () => {
            const sidebar = document.getElementById('sidebar-panels');
            const nav = document.getElementById('sidebar-nav');
            const isHidden = sidebar.style.display === 'none';
            sidebar.style.display = isHidden ? 'flex' : 'none';
            nav.style.display = isHidden ? 'flex' : 'none';
        };
    }

    const edZoomIn = document.getElementById('ed-zoom-in');
    if (edZoomIn) {
        edZoomIn.onclick = () => sendToEditor({ type: 'EXECUTE_ACTION', action: 'editor.action.fontZoomIn' });
    }

    const edZoomOut = document.getElementById('ed-zoom-out');
    if (edZoomOut) {
        edZoomOut.onclick = () => sendToEditor({ type: 'EXECUTE_ACTION', action: 'editor.action.fontZoomOut' });
    }

    const edFullscreen = document.getElementById('ed-fullscreen');
    if (edFullscreen) {
        edFullscreen.onclick = () => {
            const editorArea = document.getElementById('editor-area');
            if (!document.fullscreenElement) {
                editorArea.requestFullscreen().catch(err => {
                    console.error(`[SF-Intel] Fullscreen error: ${err.message}`);
                });
            } else {
                document.exitFullscreen();
            }
        };
    }

    const edPreviewLwc = document.getElementById('ed-preview-lwc');
    if (edPreviewLwc) {
        edPreviewLwc.onclick = handleLwcPreview;
    }
});

// --- NAVIGATION & UI HANDLERS ---
function setupNavigation() {
    // Event Delegation for Tabs
    const tabList = document.getElementById('sf-intel-tabs-list');
    if (tabList) {
        tabList.onclick = (e) => {
            const tabEl = e.target.closest('.ide-tab');
            if (!tabEl) return;

            const tabId = tabEl.dataset.id;
            if (e.target.classList.contains('tab-close')) {
                e.stopPropagation();
                closeTab(tabId);
            } else {
                switchTab(tabId);
            }
        };

        // Right-click context menu for tabs
        tabList.addEventListener('contextmenu', (e) => {
            const tabEl = e.target.closest('.ide-tab');
            if (!tabEl) return;

            e.preventDefault();
            const tabId = tabEl.dataset.id;
            showTabContextMenu(e.clientX, e.clientY, tabId);
        });
    }

    // Close context menu on click outside, Escape key, or editor focus
    document.addEventListener('mousedown', (e) => {
        const menu = document.getElementById('tab-context-menu');
        if (menu && !menu.contains(e.target)) {
            hideTabContextMenu();
        }
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hideTabContextMenu();

        // Cmd+Enter (Mac) / Ctrl+Enter (Win): Run SOQL/Apex utility
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            const utilId = window.activeUtilId;
            if ((utilId === 'soql' || utilId === 'apex') && window.UtilsPanel) {
                e.preventDefault();
                window.UtilsPanel.run(utilId);
            }
        }
    });
    // Close when hovering over editor area
    const editorArea = document.getElementById('sf-intel-monaco-container');
    if (editorArea) {
        editorArea.addEventListener('mouseenter', hideTabContextMenu);
    }

    // Sidebar types delegation
    const typesList = document.querySelector('.tab-selector');
    if (typesList) {
        typesList.onclick = (e) => {
            const typeEl = e.target.closest('.sf-intel-tab');
            if (typeEl && window.MetadataExplorer) {
                window.MetadataExplorer.switchType(typeEl.dataset.type);
            }
        };
    }
    // Sidebar View (Files, Search, Analysis)
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.onclick = () => {
            const view = btn.dataset.view;
            const sidebarPanels = document.getElementById('sidebar-panels');
            const isAlreadyActive = btn.classList.contains('active');

            // Smart collapse: for utilities and admin panels
            if ((view === 'utilities' || view === 'admin') && isAlreadyActive) {
                sidebarPanels.classList.toggle('collapsed');
                return;
            }

            // Switching to a different panel — ensure expanded
            sidebarPanels.classList.remove('collapsed');

            // Update active state for nav buttons
            document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Handle different views
            if (view === 'analysis' && window.AnalysisPanel) {
                window.AnalysisPanel.toggle();
            } else if (window.MetadataExplorer) {
                window.MetadataExplorer.switchView(view);
                // Hide analysis panel if it's open
                if (window.AnalysisPanel) {
                    window.AnalysisPanel.hide();
                }
                // Restore editor workspace when switching away from admin/schema
                if (view === 'explorer' && window.activeViewMode === 'schema') {
                    window.switchViewMode('editor');
                }
            }
        };
    });

    // Search
    const search = document.getElementById('sf-intel-search');
    if (search) {
        search.oninput = (e) => window.MetadataExplorer.render(e.target.value);
    }

    // Utility Quick Access
    document.querySelectorAll('.util-item').forEach(item => {
        item.onclick = () => {
            const utilId = item.dataset.util;
            
            // Schema Explorer - opens in dedicated workspace
            if (utilId === 'schema-explorer') {
                window.switchViewMode('schema');
                if (window.SchemaExplorer) window.SchemaExplorer.render();
                return;
            }

            // Special handling for deploy utility - opens full-screen utility window
            if (utilId === 'deploy') {
                if (window.UtilityWindowManager) {
                    window.UtilityWindowManager.open('staged-deploy');
                } else {
                    console.error('[SF-Intel] Deployment utility not available - UtilityWindowManager not loaded');
                    if (window.Terminal) window.Terminal.error('Deployment utility not available');
                }
            } else {
                // Regular utilities use the utils panel
                window.UtilsPanel.open(utilId);
            }
        };
    });

    // Bottom Panel Tabs delegation
    const bottomTabs = document.querySelector('.bottom-panel-tabs');
    if (bottomTabs) {
        bottomTabs.onclick = (e) => {
            const tabBtn = e.target.closest('.bottom-tab');
            if (tabBtn) {
                console.log('[SF-Intel] Bottom Tab Clicked:', tabBtn.dataset.panel);
                switchBottomTab(tabBtn.dataset.panel);
            }
        };
    }

    // Bottom Panel Actions
    const toggleBottom = document.getElementById('toggle-bottom-panel');
    if (toggleBottom) {
        toggleBottom.onclick = (e) => {
            e.stopPropagation();
            console.log('[SF-Intel] Toggle Button Clicked');
            if (window.Terminal) window.Terminal.toggle();
        };
    }

    const clearBottom = document.getElementById('clear-bottom-panel');
    if (clearBottom) {
        clearBottom.onclick = () => {
            const activePanel = document.querySelector('.bottom-tab.active')?.dataset.panel;
            if (activePanel === 'terminal') window.Terminal.clear();
            else if (activePanel === 'problems') window.Problems.clear();
        };
    }

    // Save Button
    const saveBtn = document.getElementById('sf-intel-save');
    if (saveBtn) {
        saveBtn.onclick = () => saveCurrentTab();
    }

    // Create New Dropdown (Hover-Based v1.8.9)
    document.querySelectorAll('.dropdown-content a').forEach(link => {
        link.onclick = (e) => {
            e.preventDefault();
            const action = link.dataset.action;
            openCreateModal(action);
        };
    });

    // Modal Cancel Buttons
    document.getElementById('apex-cancel')?.addEventListener('click', () => closeModal());
    document.getElementById('trigger-cancel')?.addEventListener('click', () => closeModal());
    document.getElementById('lwc-cancel')?.addEventListener('click', () => closeModal());
    document.getElementById('aura-cancel')?.addEventListener('click', () => closeModal());
    document.getElementById('modal-overlay')?.addEventListener('click', (e) => {
        if (e.target.id === 'modal-overlay') closeModal();
    });

    // Modal Create Buttons
    document.getElementById('apex-create')?.addEventListener('click', () => handleCreateApex());
    document.getElementById('trigger-create')?.addEventListener('click', () => handleCreateTrigger());
    document.getElementById('lwc-create')?.addEventListener('click', () => handleCreateLwc());
    document.getElementById('aura-create')?.addEventListener('click', () => handleCreateAura());

    // Modal Validation Listeners
    ['apex-name'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', () => validateForm('apex'));
    });
    ['trigger-name', 'trigger-sobject'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', () => validateForm('trigger'));
    });
    document.querySelectorAll('.trigger-event').forEach(el => {
        el.addEventListener('change', () => validateForm('trigger'));
    });
    ['lwc-name', 'lwc-api'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', () => validateForm('lwc'));
    });
    document.getElementById('lwc-exposed')?.addEventListener('change', () => validateForm('lwc'));
    document.querySelectorAll('.lwc-target').forEach(el => {
        el.addEventListener('change', () => validateForm('lwc'));
    });
    ['aura-name'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', () => validateForm('aura'));
    });

    // Tree Create Button (Shortcut)
    document.getElementById('tree-create-btn')?.addEventListener('click', () => {
        const type = window.currentType;
        console.log(`[SF-Intel] Tree Create Shortcut clicked. Current Type: ${type}`);
        if (type === 'ApexClass') openCreateModal('new-apex');
        else if (type === 'ApexTrigger') openCreateModal('new-trigger');
        else if (type === 'LWC') openCreateModal('new-lwc');
        else if (type === 'AuraDefinitionBundle') openCreateModal('new-aura');
        else {
            window.Terminal.log(`[SF-Intel] Shortcut not supported for ${type}. Use CREATE NEW dropdown instead.`);
        }
    });
}

function switchViewMode(mode) {
    console.log(`[SF-Intel] Switching view mode to: ${mode}`);
    window.activeViewMode = mode;
    const editorWs = document.getElementById('editor-workspace');
    const utilityWs = document.getElementById('utility-workspace');
    const inspectorWs = document.getElementById('inspector-workspace');

    // Handle Editor Workspace
    if (editorWs) {
        editorWs.style.display = mode === 'editor' ? 'flex' : 'none';
        editorWs.classList.toggle('hidden', mode !== 'editor');
    }

    // Handle Utility Workspace
    if (utilityWs) {
        utilityWs.style.display = mode === 'utility' ? 'flex' : 'none';
        utilityWs.classList.toggle('hidden', mode !== 'utility');
    }

    // Handle Inspector Workspace (SIP-3.0)
    if (inspectorWs) {
        inspectorWs.style.display = mode === 'inspector' ? 'flex' : 'none';
        inspectorWs.classList.toggle('hidden', mode !== 'inspector');
    }

    // Handle Schema Explorer Workspace
    const schemaWs = document.getElementById('schema-workspace');
    if (schemaWs) {
        schemaWs.style.display = mode === 'schema' ? 'flex' : 'none';
    }

    document.querySelectorAll('.view-mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    // Hide global editor actions (Save & Deploy, Coverage, Create New) in utility/inspector mode
    const isEditorMode = mode === 'editor';
    const createNewDropdown = document.getElementById('create-new-btn')?.closest('.dropdown');
    const saveBtn = document.getElementById('sf-intel-save');
    const coverageBtn = document.getElementById('sf-intel-coverage-toggle');
    const runTestBtn = document.getElementById('sf-intel-run-test');
    if (!isEditorMode) {
        if (createNewDropdown) createNewDropdown.style.display = 'none';
        if (saveBtn) saveBtn.style.display = 'none';
        if (coverageBtn) coverageBtn.style.display = 'none';
        if (runTestBtn) runTestBtn.style.display = 'none';
    } else {
        // Restore: show Create New, let checkTestContext restore the rest based on active tab
        if (createNewDropdown) createNewDropdown.style.display = '';
        const activeTab = window.openTabs?.find(t => t.isActive);
        if (activeTab) {
            checkTestContext(activeTab);
        } else {
            // No active tab — show Save & Deploy disabled, hide coverage/run test
            if (saveBtn) { saveBtn.style.display = 'inline-flex'; saveBtn.disabled = true; }
            if (coverageBtn) coverageBtn.style.display = 'none';
            if (runTestBtn) runTestBtn.style.display = 'none';
        }
    }
}

function switchBottomTab(panelId) {
    console.log('[SF-Intel] switchBottomTab:', panelId);
    document.querySelectorAll('.bottom-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.panel === panelId);
    });

    // Auto-expand if collapsed
    const panel = document.getElementById('bottom-panel');
    if (panel) {
        if (panel.classList.contains('collapsed')) {
            console.log('[SF-Intel] Expanding bottom panel');
            panel.classList.remove('collapsed');
        }
    }

    const terminalPanel = document.getElementById('terminal-output');
    const problemsPanel = document.getElementById('problems-panel');

    if (terminalPanel) {
        terminalPanel.classList.toggle('active', panelId === 'terminal');
        terminalPanel.style.display = panelId === 'terminal' ? 'block' : 'none';
    }
    if (problemsPanel) {
        problemsPanel.classList.toggle('active', panelId === 'problems');
        problemsPanel.style.display = panelId === 'problems' ? 'block' : 'none';
    }
}

// --- TAB MANAGEMENT ---
function openItem(id, name, type, bundleId) {
    const existing = window.openTabs.find(t => t.id === id);
    if (existing) {
        switchTab(id);
        return;
    }

    window.Terminal.log(`Opening ${name}...`);

    const tab = {
        id,
        name,
        type: type || window.currentType,
        bundleId: bundleId || null,  // CRITICAL: Store bundle ID for deployment
        isDirty: false,
        content: 'Loading...'
    };
    window.openTabs.push(tab);
    renderTabs();
    switchTab(id);

    // Fetch content
    fetchItemContent(id);
}

async function fetchItemContent(id) {
    try {
        const tab = window.openTabs.find(t => t.id === id);
        if (!tab) return;

        const type = tab.type;
        let content = '';

        if (type === 'ApexClass') content = await window.apiClient.getApexClassBody(id);
        else if (type === 'ApexTrigger') content = await window.apiClient.getApexTriggerBody(id);
        else if (type === 'LWC') {
            // Search in cache first
            let found = false;
            let bundleId = null;

            for (const bid in window.lwcBundleCache) {
                const file = window.lwcBundleCache[bid].find(f => f.Id === id);
                if (file) {
                    content = file.Source;
                    bundleId = bid;
                    found = true;
                    break;
                }
            }

            // CRITICAL FIX: Auto-populate cache if not found
            if (!found && tab.bundleId) {
                window.Terminal.log(`⚡ Auto-fetching LWC bundle for deployment...`);
                try {
                    window.lwcBundleCache[tab.bundleId] = await window.apiClient.getLwcBundleFiles(tab.bundleId);
                    const file = window.lwcBundleCache[tab.bundleId].find(f => f.Id === id);
                    if (file) {
                        content = file.Source;
                        window.Terminal.success(`✓ LWC bundle cached: ${tab.bundleId}`);
                    }
                } catch (err) {
                    window.Terminal.error(`Failed to fetch LWC bundle: ${err.message}`);
                }
            }
        }
        else if (type === 'AuraDefinitionBundle') {
            // Search in cache first
            let found = false;
            let bundleId = null;

            for (const bid in window.auraBundleCache) {
                const file = window.auraBundleCache[bid].find(f => f.Id === id);
                if (file) {
                    content = file.Source;
                    bundleId = bid;
                    found = true;
                    break;
                }
            }

            // CRITICAL FIX: Auto-populate cache if not found
            if (!found && tab.bundleId) {
                window.Terminal.log(`⚡ Auto-fetching Aura bundle for deployment...`);
                try {
                    window.auraBundleCache[tab.bundleId] = await window.apiClient.getAuraBundleFiles(tab.bundleId);
                    const file = window.auraBundleCache[tab.bundleId].find(f => f.Id === id);
                    if (file) {
                        content = file.Source;
                        window.Terminal.success(`✓ Aura bundle cached: ${tab.bundleId}`);
                    }
                } catch (err) {
                    window.Terminal.error(`Failed to fetch Aura bundle: ${err.message}`);
                }
            }
        }

        tab.content = content;
        if (window.activeTabId === id) {
            sendToEditor({
                type: 'OPEN_MODEL',
                id: id,
                value: content,
                language: getLanguageForFile(tab.name, tab.type)
            });
            const saveBtn = document.getElementById('sf-intel-save');
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.classList.add('enabled');
                saveBtn.innerHTML = `${SVG_SAVE} SAVE & DEPLOY`;
            }
        }
    } catch (err) {
        window.Terminal.error(`Failed to load content for ${id}: ${err.message}`);
    }
}

function getLanguageForFile(fileName, type) {
    if (type === 'ApexClass' || type === 'ApexTrigger') return 'apex';
    if (!fileName) return 'javascript';
    const ext = fileName.split('.').pop().toLowerCase();
    if (ext === 'cls' || ext === 'trigger' || ext === 'apex') return 'apex';
    if (ext === 'html' || ext === 'cmp' || ext === 'app') return 'html';
    if (ext === 'css') return 'css';
    if (ext === 'xml') return 'xml';
    if (ext === 'sql' || ext === 'soql') return 'soql';
    return 'javascript';
}

function getTabIconColor(type) {
    switch(type) {
        case 'ApexClass': return '#c98a4e';
        case 'ApexTrigger': return '#cc6633';
        case 'LWC': return '#51b6c3';
        case 'AuraDefinitionBundle': return '#e8bf6a';
        default: return '#888';
    }
}

function renderTabs() {
    const container = document.getElementById('sf-intel-tabs-list');
    if (!container) return;
    container.innerHTML = window.openTabs.map(t => {
        const iconColor = getTabIconColor(t.type);
        return `
        <div class="ide-tab ${t.id === window.activeTabId ? 'active' : ''} ${t.isDirty ? 'dirty' : ''}" data-id="${t.id}">
            <span class="tab-icon" style="color:${iconColor}">&#9679;</span>
            <span class="tab-label">${_escapeHtml(t.name)}</span>
            <span class="tab-close">&times;</span>
        </div>
    `;
    }).join('');
}

function switchTab(id) {
    window.activeTabId = id;
    renderTabs();
    switchViewMode('editor');

    const tab = window.openTabs.find(t => t.id === id);
    const editorIframe = document.getElementById('editor-iframe');
    const monacoContainer = document.getElementById('sf-intel-monaco-container');
    let viewerEl = document.getElementById('sf-html-viewer');

    // Default: Show Editor, Hide HTML Viewer
    if (editorIframe) editorIframe.style.display = 'block';
    if (viewerEl) viewerEl.style.display = 'none';

    if (tab) {
        // HTML / Release Notes (SIP-3.4) Rendering
        if (tab.type === 'HTML') {
            if (!viewerEl && monacoContainer) {
                 viewerEl = document.createElement('div');
                 viewerEl.id = 'sf-html-viewer';
                 viewerEl.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:#1e1e1e;z-index:100;overflow:auto;padding:20px;box-sizing:border-box;display:none;';
                 monacoContainer.appendChild(viewerEl);
            }
            
            if (editorIframe) editorIframe.style.display = 'none';
            if (viewerEl) {
                viewerEl.style.display = 'block';
                if (tab.structuredData) {
                    renderReleaseNotesDOM(tab.structuredData, viewerEl);
                } else {
                    viewerEl.innerHTML = tab.content || '';
                }
            }
            
            const saveBtn = document.getElementById('sf-intel-save');
            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.innerHTML = 'READ ONLY';
            }
        } 
        // Normal Code Editor
        else if (tab.content !== 'Loading...') {
            sendToEditor({
                type: 'OPEN_MODEL',
                id: id,
                value: tab.content,
                language: getLanguageForFile(tab.name, tab.type)
            });
            const saveBtn = document.getElementById('sf-intel-save');
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.classList.add('enabled');
                saveBtn.innerHTML = (tab.name && tab.name.toLowerCase().includes('test')) ? `${SVG_SAVE} SAVE` : `${SVG_SAVE} SAVE & DEPLOY`;
            }
        }
    }

    // Default Save Button state if no tab or loading
    if (!tab || (tab && tab.type !== 'HTML' && tab.content === 'Loading...')) {
        const saveBtn = document.getElementById('sf-intel-save');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.classList.remove('enabled');
        }
    }

    // Toggle placeholder
    const placeholder = document.getElementById('monaco-placeholder');
    if (placeholder) placeholder.style.display = 'none';

    // Toggle Preview Button (SIP-3.3)
    const previewBtn = document.getElementById('ed-preview-lwc');
    if (previewBtn) {
        if (tab && tab.type === 'LWC') {
            previewBtn.style.display = 'flex';
        } else {
            previewBtn.style.display = 'none';
        }
    }

    // Update file path header (Match v2.0.7 Screenshot)
    const pathHeader = document.getElementById('file-path');
    if (pathHeader && tab) {
        const type = tab.type || 'Unknown';
        const name = tab.name || 'Untitled';
        const version = window.apiClient?.apiVersion || 'v59.0';
        pathHeader.innerHTML = `<span class="bc-type">${_escapeHtml(type)}</span> <span class="bc-sep">></span> <span class="bc-file">${_escapeHtml(name)}</span> • <span class="bc-version">${_escapeHtml(version)}</span>`;
    }

    // Milestone 24: Check for Test Context
    checkTestContext(tab);

}

window.checkTestContext = checkTestContext;
function checkTestContext(tab) {
    const runBtn = document.getElementById('sf-intel-run-test');
    const saveBtn = document.getElementById('sf-intel-save');
    if (!runBtn || !saveBtn) return;

    if (!tab || (tab.type !== 'ApexClass' && tab.type !== 'ApexTrigger')) {
        runBtn.style.display = 'none';
        saveBtn.style.display = 'inline-flex';
        saveBtn.innerHTML = `${SVG_SAVE} SAVE & DEPLOY`;
        // Hide coverage button and clear highlights for non-Apex types
        const covBtn = document.getElementById('sf-intel-coverage-toggle');
        if (covBtn) covBtn.style.display = 'none';
        if (window.isCoverageEnabled) {
            sendToEditor({ type: 'SET_COVERAGE_VISIBILITY', visible: false });
        }
        return;
    }

    const isTestByName = tab.name && tab.name.toLowerCase().includes('test');
    const isTestByContent = tab.content && (tab.content.includes('@isTest') || tab.content.includes('@IsTest'));

    if (isTestByName || isTestByContent) {
        runBtn.style.display = 'inline-flex';
        runBtn.classList.add('enabled');
        runBtn.innerHTML = `${SVG_PLAY} RUN TEST`;
        saveBtn.style.display = 'inline-flex';
        saveBtn.innerHTML = `${SVG_SAVE} SAVE`;
    } else {
        runBtn.style.display = 'none';
        saveBtn.style.display = 'inline-flex';
        saveBtn.innerHTML = `${SVG_SAVE} SAVE & DEPLOY`;
    }

    // Toggle Coverage Button (v2.3.0) - Only show when THIS class has coverage data
    const covBtn = document.getElementById('sf-intel-coverage-toggle');
    if (covBtn) {
        const isApex = tab.type === 'ApexClass' || tab.type === 'ApexTrigger';
        const hasCoverageForThis = window.TestRunner && window.TestRunner.coveredClassIds && window.TestRunner.coveredClassIds.has(tab.id);
        if (isApex && hasCoverageForThis) {
            covBtn.style.display = 'inline-flex';
            updateCoverageUI();
        } else {
            covBtn.style.display = 'none';
            // Switching to a class with no coverage — clear highlights if coverage was on
            if (window.isCoverageEnabled) {
                sendToEditor({ type: 'SET_COVERAGE_VISIBILITY', visible: false });
            }
        }
    }
}

/**
 * Toggle Code Coverage Highlighting (v2.3.0)
 */
function toggleCoverage(forceState = null) {
    window.isCoverageEnabled = forceState !== null ? forceState : !window.isCoverageEnabled;
    console.log(`[SF-Intel] Coverage toggled: ${window.isCoverageEnabled}`);

    updateCoverageUI();

    // Notify Editor
    if (window.isCoverageEnabled) {
        // If enabled, try to fetch/display if we have the class ID
        if (window.TestRunner) window.TestRunner.refreshCoverageForActiveTab();
    } else {
        // If disabled, just hide the highlights (Gutter Reservation logic)
        sendToEditor({ type: 'SET_COVERAGE_VISIBILITY', visible: false });
    }
}

function updateCoverageUI() {
    const btn = document.getElementById('sf-intel-coverage-toggle');
    if (!btn) return;

    if (window.isCoverageEnabled) {
        btn.innerHTML = `${SVG_CHART} COVERAGE: ON`;
        btn.style.background = '#27ae60';
        btn.style.color = 'white';
        btn.style.borderColor = '#2ecc71';
    } else {
        btn.innerHTML = `${SVG_CHART} COVERAGE: OFF`;
        btn.style.background = 'rgba(39, 174, 96, 0.1)';
        btn.style.color = '#2ecc71';
        btn.style.borderColor = 'rgba(46, 204, 113, 0.3)';
    }
}

function closeTab(id) {
    window.openTabs = window.openTabs.filter(t => t.id !== id);
    if (window.activeTabId === id) {
        window.activeTabId = window.openTabs.length > 0 ? window.openTabs[0].id : null;
        if (window.activeTabId) switchTab(window.activeTabId);
        else {
            sendToEditor({ type: 'SET_VALUE', value: '' });
            document.getElementById('sf-intel-save').disabled = true;
        }
    }
    renderTabs();
}

function closeAllTabs() {
    // Check for unsaved changes
    const dirtyTabs = window.openTabs.filter(t => t.isDirty);
    if (dirtyTabs.length > 0) {
        if (!confirm(`You have ${dirtyTabs.length} unsaved file(s). Close all tabs anyway?`)) {
            return;
        }
    }

    window.openTabs = [];
    window.activeTabId = null;
    sendToEditor({ type: 'SET_VALUE', value: '' });
    document.getElementById('sf-intel-save').disabled = true;
    renderTabs();
}

function closeOtherTabs(keepTabId) {
    // Check for unsaved changes in tabs being closed
    const dirtyTabs = window.openTabs.filter(t => t.id !== keepTabId && t.isDirty);
    if (dirtyTabs.length > 0) {
        if (!confirm(`You have ${dirtyTabs.length} unsaved file(s). Close other tabs anyway?`)) {
            return;
        }
    }

    window.openTabs = window.openTabs.filter(t => t.id === keepTabId);
    if (window.activeTabId !== keepTabId) {
        switchTab(keepTabId);
    }
    renderTabs();
}

// --- TAB CONTEXT MENU ---
function showTabContextMenu(x, y, tabId) {
    hideTabContextMenu();

    const menu = document.createElement('div');
    menu.id = 'tab-context-menu';
    menu.className = 'tab-context-menu';
    menu.innerHTML = `
        <div class="context-menu-item" data-action="close">Close</div>
        <div class="context-menu-item" data-action="close-others">Close Other Tabs</div>
        <div class="context-menu-item" data-action="close-all">Close All Tabs</div>
    `;

    // Position menu
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    // Handle menu item clicks
    menu.addEventListener('click', (e) => {
        const item = e.target.closest('.context-menu-item');
        if (!item) return;

        const action = item.dataset.action;
        if (action === 'close') {
            closeTab(tabId);
        } else if (action === 'close-others') {
            closeOtherTabs(tabId);
        } else if (action === 'close-all') {
            closeAllTabs();
        }
        hideTabContextMenu();
    });

    document.body.appendChild(menu);

    // Adjust position if menu goes off-screen
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
        menu.style.left = `${window.innerWidth - rect.width - 5}px`;
    }
    if (rect.bottom > window.innerHeight) {
        menu.style.top = `${window.innerHeight - rect.height - 5}px`;
    }
}

function hideTabContextMenu() {
    const existing = document.getElementById('tab-context-menu');
    if (existing) existing.remove();
}

// --- LOG INSPECTOR (SIP-3.0) ---
window.viewLog = async function (logId) {
    if (!window.apiClient) return;

    window.lastOpenedLogId = logId;

    window.Terminal.log(`Opening Log ${logId}...`);
    switchViewMode('inspector');

    try {
        const logBody = await window.apiClient.getLogBody(logId);

        // 1. Create Log Entry for Tree View
        const treeView = document.getElementById('view-tree');
        if (treeView) {
            treeView.innerHTML = ''; // Clear existing logs (Single-Session Mode)

            if (window.LogParser) {
                const tree = window.LogParser.parse(logBody);
                window.LogParser.renderTree(tree, treeView);
            }
        }

        // 2. Create Log Entry for Raw View
        const rawView = document.getElementById('view-raw');
        if (rawView) {
            rawView.innerHTML = `<pre class="log-session-raw">${_escapeHtml(logBody)}</pre>`; // Clear existing logs
        }

    } catch (err) {
        window.Terminal.error(`Failed to load log: ${err.message}`);
    }
};

// --- EDITOR BRIDGE ---
function setupSandboxBridge() {
    window.addEventListener('message', async (event) => {
        if (event.origin !== window.location.origin) return; // P0 Security: origin validation
        const msg = event.data;
        if (msg.type === 'EDITOR_READY') {
            console.log('[SF-Intel] Editor iframe ready.');
            window.editorReady = true;
            if (window.activeTabId) {
                switchTab(window.activeTabId);
            }
        }
        else if (msg.type === 'CONTENT_RESULT') {
            console.log('[SF-Intel] CONTENT_RESULT received:', msg.id);
            // Check for pending bundle co-deploy resolvers (sibling tab content flush)
            if (window._pendingContentResolvers && window._pendingContentResolvers[msg.id]) {
                const resolver = window._pendingContentResolvers[msg.id];
                delete window._pendingContentResolvers[msg.id];
                resolver(msg.value);
                return;
            }
            // Skip if diff content fetch is pending (handled by promise listener)
            if (window._diffContentPending) return;
            // Skip execution if a non-run action (copy/prettify) is pending
            if (window._soqlActionPending) {
                window._soqlActionPending = false;
                return;
            }
            if (msg.id && msg.id.startsWith('util-')) {
                const utilId = msg.id.replace('util-', '');
                console.log('[SF-Intel] Dispatching to UtilsPanel:', utilId);
                if (window.UtilsPanel) window.UtilsPanel.executeLogic(utilId, msg.value);
                else console.error('[SF-Intel] UtilsPanel not found for dispatch!');
            } else {
                handleSave(msg.value);
            }
        }
        else if (msg.type === 'SELECTION_RESULT') {
            console.log('[SF-Intel] SELECTION_RESULT received:', msg.id);
            if (msg.id && msg.id.startsWith('util-soql')) {
                if (window.UtilsPanel) window.UtilsPanel.executeLogic('soql', msg.value);
            }
        }
        else if (msg.type === 'RUN_UTILITY') {
            const utilId = window.activeUtilId;
            if ((utilId === 'soql' || utilId === 'apex') && window.UtilsPanel) {
                window.UtilsPanel.run(utilId);
            }
        }
        else if (msg.type === 'CONTENT_CHANGED') {
            const tab = window.openTabs.find(t => t.id === msg.modelId);
            if (tab) {
                tab.isDirty = true;
                renderTabs(); // Refresh tabs to show dirty indicator

                const saveBtn = document.getElementById('sf-intel-save');
                if (saveBtn && window.activeTabId === msg.modelId) {
                    saveBtn.disabled = false;
                    saveBtn.classList.add('enabled');
                    saveBtn.innerHTML = `${SVG_SAVE} SAVE & DEPLOY`;
                }
            }
        }
        else if (msg.type === 'GET_GLOBAL_DESCRIBE') {
            if (window.apiClient) {
                const result = await window.apiClient.getGlobalDescribe();
                sendToEditor({ type: 'GLOBAL_DESCRIBE_RESULT', result });
                sendToEditor({ type: 'GLOBAL_DESCRIBE_RESULT', result }, 'utility');
            }
        }
        else if (msg.type === 'DESCRIBE_SOBJECT') {
            if (window.apiClient) {
                const result = await window.apiClient.describeSObject(msg.sobjectName);
                sendToEditor({ type: 'DESCRIBE_RESULT', result, sobjectName: msg.sobjectName });
                sendToEditor({ type: 'DESCRIBE_RESULT', result, sobjectName: msg.sobjectName }, 'utility');
            }
        }
        else if (msg.type === 'GET_APEX_CLASSES') {
            // Fetch all active Apex class names for LWC @salesforce/apex/ import completions.
            // Cached per session in the editor iframe (LWCIntelliSense._apexClassCache).
            if (window.apiClient) {
                try {
                    const result = await window.apiClient.toolingQuery(
                        "SELECT Id, Name FROM ApexClass WHERE Status = 'Active' ORDER BY Name LIMIT 2000"
                    );
                    const payload = { type: 'APEX_CLASSES_RESULT', requestId: msg.requestId, records: result.records || [] };
                    sendToEditor(payload, 'main');
                    sendToEditor(payload, 'utility');
                } catch (e) {
                    const payload = { type: 'APEX_CLASSES_RESULT', requestId: msg.requestId, records: [] };
                    sendToEditor(payload, 'main');
                    sendToEditor(payload, 'utility');
                }
            }
        }
        else if (msg.type === 'VALIDATE_CODE') {
            console.log('[Bridge] VALIDATE_CODE received for:', msg.modelId);
            if (window.sfIntelAPI && window.sfIntelAPI.validateCode) {
                try {
                    const result = await window.sfIntelAPI.validateCode(msg.value);
                    console.log('[Bridge] Validation API result:', result);
                    
                    // Backend returns array directly or {errors: []}
                    const errors = Array.isArray(result) ? result : (result.errors || []);
                    console.log('[Bridge] Extracted errors:', errors.length);

                    // 1. Update Problems Panel UI (Parent)
                    if (window.Problems) {
                        const problems = errors.map(err => ({
                            file: msg.modelId.split('/').pop() || 'temp.cls',
                            fileId: msg.modelId,
                            line: err.line,
                            message: err.message,
                            severity: 8 // Error
                        }));
                        window.Problems.update(problems);
                    }

                    // 2. Send back to Editor (Iframe)
                    sendToEditor({ 
                        type: 'VALIDATE_RESULT', 
                        result: { results: errors }, // editor.js expects results property
                        modelId: msg.modelId 
                    });
                } catch (err) {
                    console.error('[SF-Intel] Validation error:', err);
                }
            }
        }
        else if (msg.type === 'SWITCH_MODEL') {
            switchTab(msg.id);
        }
        else if (msg.type === 'MARKERS_UPDATE' || msg.type === 'LSP_DIAGNOSTICS') {
            sendToEditor(msg);
        }
        else if (msg.type === 'MARKERS_UPDATE_EVENT') {
            console.log('[SF-Intel] Markers update received for:', msg.modelId);
            const tab = window.openTabs.find(t => t.id === msg.modelId);
            const fileName = tab ? tab.name : msg.modelId;

            // Map markers to Problem structure
            const problems = msg.diagnostics.map(d => ({
                fileId: msg.modelId,
                file: fileName,
                line: d.startLineNumber,
                message: d.message,
                severity: d.severity // 8=Error, 4=Warning, 1=Hint
            }));

            window.diagnosticsByFile.set(msg.modelId, problems);

            // Flatten all diagnostics for the UI
            const allProblems = [];
            for (const pList of window.diagnosticsByFile.values()) {
                allProblems.push(...pList);
            }

            if (window.Problems) {
                console.log('[SF-Intel] Updating Problems panel with count:', allProblems.length);
                window.Problems.update(allProblems);
            }
        }
        else if (msg.type === 'UPDATE_BREADCRUMB') {
            const pathHeader = document.getElementById('file-path');
            if (pathHeader) {
                const tab = window.openTabs.find(t => t.id === window.activeTabId);
                const fileName = tab ? tab.name : '';
                const type = tab ? tab.type : 'Unknown';
                const version = window.apiClient?.apiVersion || 'v59.0';
                pathHeader.innerHTML = `<span class="bc-type">${_escapeHtml(type)}</span> <span class="bc-sep">></span> <span class="bc-file">${_escapeHtml(fileName)}</span><span class="bc-path">${msg.breadcrumb ? ' > ' + _escapeHtml(msg.breadcrumb) : ''}</span> • <span class="bc-version">${_escapeHtml(version)}</span>`;
            }
        }
        else if (msg.type === 'SHOW_FLOW') {
            if (window.AnalysisPanel) {
                window.AnalysisPanel.show();
                window.AnalysisPanel.switchView('flow');
                window.AnalysisPanel.loadFlow(msg.className);
            }
        }
        else if (msg.type === 'OPEN_DASHBOARD') {
            if (window.AnalysisPanel) {
                window.AnalysisPanel.openDashboard(msg.className);
            }
        }
        // ========================================
        // FETCH LATEST FROM SALESFORCE (Editor Context Menu)
        // ========================================
        else if (msg.type === 'FETCH_LATEST_CURRENT') {
            const tab = window.openTabs.find(t => t.id === window.activeTabId);
            if (!tab) {
                if (window.FetchLatestUI) {
                    window.FetchLatestUI._showToast('No file currently open', 'error');
                }
                return;
            }

            // Determine the type and name for fetch
            const type = tab.type;
            let name = tab.name;

            // For bundle files (LWC/Aura), resolve the DeveloperName (not the file name)
            if (type === 'LWC' || type === 'AuraDefinitionBundle') {
                const cacheKey = type === 'LWC' ? 'LWC' : 'AuraDefinitionBundle';
                // 1. Prefer metadataCache lookup via bundleId
                if (tab.bundleId && Array.isArray(window.metadataCache?.[cacheKey])) {
                    const meta = window.metadataCache[cacheKey].find(b => b.Id === tab.bundleId);
                    if (meta?.DeveloperName) name = meta.DeveloperName;
                }
                // 2. Fallback: strip file extension (works for LWC; e.g. 'myComp.html' → 'myComp')
                if (name === tab.name) {
                    if (type === 'LWC') {
                        name = tab.name.replace(/\.[^.]+$/, '');
                    } else {
                        // Aura: strip extension then Controller/Helper/Renderer suffix
                        name = tab.name.replace(/\.[^.]+$/, '').replace(/(Controller|Helper|Renderer)$/, '');
                    }
                }
            }

            // Check if FetchLatestService is available
            if (!window.FetchLatestService) {
                if (window.FetchLatestUI) {
                    window.FetchLatestUI._showToast('FetchLatestService not available', 'error');
                }
                return;
            }

            // Check if type is supported
            if (!window.FetchLatestService.isSupported(type)) {
                if (window.FetchLatestUI) {
                    window.FetchLatestUI._showToast(`Fetch not supported for type: ${type}`, 'error');
                }
                return;
            }

            // Show confirmation
            const typeLabel = {
                'ApexClass': 'Apex Class',
                'ApexTrigger': 'Apex Trigger',
                'LWC': 'LWC Component',
                'AuraDefinitionBundle': 'Aura Component'
            }[type] || type;

            const confirmed = confirm(`This will overwrite local changes for ${typeLabel} "${name}" with the latest version from Salesforce.\n\nContinue?`);
            if (!confirmed) return;

            // Perform fetch
            try {
                if (window.FetchLatestUI) {
                    window.FetchLatestUI._showToast(`Fetching ${typeLabel} "${name}"...`, 'info');
                }

                const result = await window.FetchLatestService.fetch(type, name);

                if (result.success) {
                    // Update editor content
                    if (type === 'ApexClass' || type === 'ApexTrigger') {
                        // Single file - update directly
                        tab.body = result.body;
                        tab.originalBody = result.body;
                        tab.isDirty = false;
                        sendToEditor({ type: 'SET_VALUE', modelId: tab.id, value: result.body });
                    } else if (type === 'LWC' || type === 'AuraDefinitionBundle') {
                        // Bundle - update cache and current file
                        const cacheKey = tab.bundleId || tab.id;
                        if (type === 'LWC' && window.lwcBundleCache) {
                            window.lwcBundleCache[cacheKey] = result.files.map(f => ({
                                Id: f.id,
                                FilePath: f.path,
                                Source: f.source,
                                Format: f.format,
                                path: f.path
                            }));
                        } else if (type === 'AuraDefinitionBundle' && window.auraBundleCache) {
                            window.auraBundleCache[cacheKey] = result.files.map(f => ({
                                Id: f.id,
                                DefType: f.defType,
                                Source: f.source,
                                Extension: f.extension,
                                path: f.path,
                                content: f.source
                            }));
                        }

                        // Update the current tab and all other open tabs in this bundle
                        const bundleTabId = tab.bundleId;
                        for (const openTab of window.openTabs) {
                            if (openTab.type !== type) continue;
                            if (bundleTabId && openTab.bundleId !== bundleTabId && openTab.id !== tab.id) continue;
                            const matchFile = result.files.find(f => f.id === openTab.id || f.fileName === openTab.name);
                            if (matchFile) {
                                openTab.body = matchFile.source;
                                openTab.originalBody = matchFile.source;
                                openTab.isDirty = false;
                                sendToEditor({ type: 'SET_VALUE', modelId: openTab.id, value: matchFile.source });
                            }
                        }
                    }

                    // Update tab UI
                    renderTabs();

                    // Show success
                    const details = result.metadata
                        ? `Last modified: ${new Date(result.metadata.lastModified).toLocaleString()}`
                        : '';
                    if (window.FetchLatestUI) {
                        window.FetchLatestUI._showToast(`✓ ${typeLabel} "${name}" updated!\n${details}`, 'success');
                    }
                    if (window.Terminal) {
                        window.Terminal.success(`Fetched latest: ${name}`);
                    }
                }
            } catch (error) {
                console.error('[SF-Intel] Fetch latest failed:', error);
                if (window.FetchLatestUI) {
                    window.FetchLatestUI._showToast(`✗ Failed to fetch "${name}": ${error.message}`, 'error');
                }
                if (window.Terminal) {
                    window.Terminal.error(`Fetch failed: ${error.message}`);
                }
            }
        }
        // ========================================
        // DIFF AGAINST ORG (Editor Context Menu)
        // ========================================
        else if (msg.type === 'DIFF_AGAINST_ORG') {
            const tab = window.openTabs.find(t => t.id === window.activeTabId);
            if (!tab) {
                if (window.Terminal) window.Terminal.error('No file currently open');
                return;
            }

            const type = tab.type;
            let name = tab.name;
            if (tab.bundleName) {
                name = tab.bundleName;
            } else if (tab.path) {
                const pathParts = tab.path.split('/');
                if (pathParts.length >= 2) name = pathParts[pathParts.length - 2] || name;
            }
            // For LWC/Aura: resolve DeveloperName from metadataCache (tab.name is a file name like 'myComp.html')
            if ((type === 'LWC' || type === 'AuraDefinitionBundle') && name === tab.name) {
                const cacheKey = type === 'LWC' ? 'LWC' : 'AuraDefinitionBundle';
                if (tab.bundleId && Array.isArray(window.metadataCache?.[cacheKey])) {
                    const meta = window.metadataCache[cacheKey].find(b => b.Id === tab.bundleId);
                    if (meta?.DeveloperName) name = meta.DeveloperName;
                }
                if (name === tab.name) {
                    // Last resort: strip file extension (and Aura controller/helper/renderer suffixes)
                    name = type === 'LWC'
                        ? tab.name.replace(/\.[^.]+$/, '')
                        : tab.name.replace(/\.[^.]+$/, '').replace(/(Controller|Helper|Renderer)$/, '');
                }
            }

            // Unsupported type → send edge case to diff viewer
            if (!window.FetchLatestService || !window.FetchLatestService.isSupported(type)) {
                sendToEditor({
                    type: 'SHOW_DIFF',
                    localContent: '', orgContent: '',
                    fileName: tab.name, metadata: null,
                    tabType: type, tabId: tab.id,
                    edgeCaseType: 'unsupported'
                });
                return;
            }

            try {
                if (window.Terminal) window.Terminal.log(`Fetching org version of "${name}" for diff...`);

                // Get current editor content via promise
                const localContent = await new Promise((resolve) => {
                    const handler = (e) => {
                        if (e.origin !== window.location.origin) return; // P0 Security: origin validation
                        if (e.data.type === 'CONTENT_RESULT' && e.data.id === tab.id) {
                            window.removeEventListener('message', handler);
                            resolve(e.data.value);
                        }
                    };
                    window.addEventListener('message', handler);
                    window._diffContentPending = true;
                    sendToEditor({ type: 'GET_CONTENT', modelId: tab.id });
                });
                window._diffContentPending = false;

                // Fetch org version
                const result = await window.FetchLatestService.fetch(type, name);
                let orgContent = '';

                if (type === 'ApexClass' || type === 'ApexTrigger') {
                    orgContent = result.body || '';
                } else if (type === 'LWC' || type === 'AuraDefinitionBundle') {
                    const currentFileName = tab.name;
                    const matchingFile = result.files.find(f => f.fileName === currentFileName);
                    orgContent = matchingFile ? matchingFile.source : '';
                    if (!matchingFile) {
                        if (window.Terminal) window.Terminal.warning(`File "${currentFileName}" not found in org bundle`);
                    }
                }

                // Detect edge cases
                let edgeCaseType = null;
                if (!orgContent && localContent) edgeCaseType = 'new_in_local';
                if (!localContent && orgContent) edgeCaseType = 'deleted_locally';

                sendToEditor({
                    type: 'SHOW_DIFF',
                    localContent: localContent,
                    orgContent: orgContent,
                    fileName: tab.name,
                    metadata: result.metadata || null,
                    tabType: type,
                    tabId: tab.id,
                    edgeCaseType: edgeCaseType
                });

                if (window.Terminal) window.Terminal.success(`Diff loaded for "${tab.name}"`);
            } catch (error) {
                console.error('[SF-Intel] Diff against org failed:', error);
                window._diffContentPending = false;
                if (window.Terminal) window.Terminal.error(`Diff failed: ${error.message}`);
                // Send fetch_error to diff viewer with retry support
                sendToEditor({
                    type: 'SHOW_DIFF',
                    localContent: '', orgContent: '',
                    fileName: tab.name, metadata: null,
                    tabType: type, tabId: tab.id,
                    edgeCaseType: 'fetch_error',
                    errorMessage: error.message
                });
            }
        }
        // ========================================
        // DIFF QUICK ACTIONS
        // ========================================
        else if (msg.type === 'DIFF_DEPLOY_LOCAL') {
            // Trigger standard save/deploy for the active tab
            saveCurrentTab();
        }
        else if (msg.type === 'DIFF_RETRIEVE_ORG') {
            const tab = window.openTabs.find(t => t.id === window.activeTabId);
            if (!tab) return;
            const confirmed = confirm(`Replace local "${tab.name}" with the org version?\nThis will overwrite your local changes.`);
            if (!confirmed) return;

            tab.body = msg.orgContent;
            tab.isDirty = true;
            sendToEditor({ type: 'SET_VALUE', modelId: tab.id, value: msg.orgContent });
            sendToEditor({ type: 'CLOSE_DIFF' });
            renderTabs();
            if (window.Terminal) window.Terminal.success(`Accepted org version for "${tab.name}"`);
        }
        else if (msg.type === 'DIFF_CONTENT_CHANGED') {
            // Silent sync from revert arrows — update tab body only
            const tabId = msg.tabId || window.activeTabId;
            const tab = window.openTabs.find(t => t.id === tabId);
            if (tab) {
                tab.body = msg.content;
                tab.isDirty = true;
                renderTabs();
            }
        }
        else if (msg.type === 'DIFF_APPLY_TO_EDITOR') {
            // Explicit "Apply to Editor" — update tab body AND main editor model
            const tabId = msg.tabId || window.activeTabId;
            const tab = window.openTabs.find(t => t.id === tabId);
            if (tab) {
                tab.body = msg.content;
                tab.isDirty = true;
                sendToEditor({ type: 'SET_VALUE', modelId: tab.id, value: msg.content });
                renderTabs();
                if (window.Terminal) window.Terminal.success(`Applied diff changes to "${tab.name}"`);
            }
        }
        else if (msg.type === 'DIFF_REFRESH') {
            // Re-trigger the diff flow
            window.postMessage({ type: 'DIFF_AGAINST_ORG' }, window.location.origin);
        }
        else if (msg.type === 'DIFF_FULLSCREEN') {
            const editorIframe = document.getElementById('editor-iframe');
            if (!document.fullscreenElement) {
                editorIframe.requestFullscreen().catch(err => {
                    console.error('[SF-Intel] Diff fullscreen error:', err.message);
                });
            } else {
                document.exitFullscreen();
            }
        }
    });
}


// Returns true if the error is our controlled polling timeout (not a network/abort error)
function isTimeoutError(err) {
    return err && err.message && err.message.startsWith('Deployment timed out');
}

/**
 * --- SAVE INFRASTRUCTURE (v3.4.2+) ---
 * Bridges UI events to the Editor Content Request
 */
function saveCurrentTab() {
    const tabId = window.activeTabId;
    if (!tabId) return;

    // 1. Clear previous problems
    if (window.Problems) window.Problems.clear();

    // 2. Request content from editor (triggers CONTENT_RESULT -> handleSave)
    const saveBtn = document.getElementById('sf-intel-save');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = 'DEPLOYING...';
    }

    sendToEditor({
        type: 'GET_CONTENT',
        modelId: tabId
    });
}

/**
 * Fetches the current content of any open Monaco model by ID.
 * Used to flush unsaved edits from sibling bundle tabs before a bundle deploy.
 */
window._pendingContentResolvers = {};
function getEditorContentForModel(modelId) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            delete window._pendingContentResolvers[modelId];
            reject(new Error(`Timeout fetching content for model ${modelId}`));
        }, 5000);
        window._pendingContentResolvers[modelId] = (value) => {
            clearTimeout(timer);
            resolve(value);
        };
        sendToEditor({ type: 'GET_CONTENT', modelId });
    });
}

async function handleSave(content) {

    const tabId = window.activeTabId;
    const tab = window.openTabs.find(t => t.id === tabId);
    if (!tab) return;
    const type = tab.type;

    // Show in-progress toast immediately — gives instant feedback before the
    // Salesforce API round-trip begins. Transitions to success/error on resolve.
    const deployHandle = DeployToast.showPending(tab.name, type);

    try {
        if (window.Terminal) {
            window.Terminal.open();
            window.Terminal.log(`Saving ${tab.name}...`);
        }
        if (window.Problems) window.Problems.clear();

        // --- CLEAR COVERAGE ON SAVE (v2.3.0) ---
        if (window.sendToEditor) {
            window.sendToEditor({ type: 'CLEAR_COVERAGE' });
        }

        if (type === 'ApexClass') {
            window.Terminal.log('Deploying Apex Class (Tooling API)...');
            await window.apiClient.deployApexClass(tabId, content);
        }
        else if (type === 'ApexTrigger') {
            window.Terminal.log('Deploying Apex Trigger (Tooling API)...');
            await window.apiClient.deployApexTrigger(tabId, content);
        }
        else if (type === 'LWC') {
            let bundleId = null;
            for (const bid in window.lwcBundleCache) {
                if (window.lwcBundleCache[bid].find(f => f.Id === tabId)) { bundleId = bid; break; }
            }

            if (bundleId) {
                // Flush unsaved edits from other open bundle tabs into the cache before deploying
                const dirtySiblings = window.openTabs.filter(t =>
                    t.type === 'LWC' && t.bundleId === bundleId && t.id !== tabId && t.isDirty
                );
                for (const st of dirtySiblings) {
                    try {
                        const freshContent = await getEditorContentForModel(st.id);
                        const cacheEntry = window.lwcBundleCache[bundleId].find(f => f.Id === st.id);
                        if (cacheEntry && freshContent != null) cacheEntry.Source = freshContent;
                    } catch (e) { /* timeout — fall back to cached Source */ }
                }

                const files = window.lwcBundleCache[bundleId].map(f => f.Id === tabId ? { ...f, content } : { ...f, content: f.Source });
                await window.apiClient.deployLwcBundle(bundleId, files);
                // deployLwcBundle throws on any failure — if we reach here, deployment succeeded
                window.lwcBundleCache[bundleId].find(f => f.Id === tabId).Source = content;
                dirtySiblings.forEach(st => { st.isDirty = false; });
            } else {
                throw new Error('Cannot deploy LWC: Bundle ID not found.');
            }
        }
        else if (type === 'AuraDefinitionBundle') {
            let bundleId = null;
            for (const bid in window.auraBundleCache) {
                if (window.auraBundleCache[bid].find(f => f.Id === tabId)) { bundleId = bid; break; }
            }

            if (bundleId) {
                // Flush unsaved edits from other open bundle tabs into the cache before deploying
                const dirtySiblings = window.openTabs.filter(t =>
                    t.type === 'AuraDefinitionBundle' && t.bundleId === bundleId && t.id !== tabId && t.isDirty
                );
                for (const st of dirtySiblings) {
                    try {
                        const freshContent = await getEditorContentForModel(st.id);
                        const cacheEntry = window.auraBundleCache[bundleId].find(f => f.Id === st.id);
                        if (cacheEntry && freshContent != null) cacheEntry.Source = freshContent;
                    } catch (e) { /* timeout — fall back to cached Source */ }
                }

                const files = window.auraBundleCache[bundleId].map(f => f.Id === tabId ? { ...f, content } : { ...f, content: f.Source });
                await window.apiClient.deployAuraBundle(bundleId, files);
                // deployAuraBundle throws on any failure — if we reach here, deployment succeeded
                window.auraBundleCache[bundleId].find(f => f.Id === tabId).Source = content;
                dirtySiblings.forEach(st => { st.isDirty = false; });
            } else {
                throw new Error('Cannot deploy Aura: Bundle ID not found.');
            }
        }

        // Only reach here for Apex Class/Trigger (single-file deployments)
        tab.isDirty = false;
        tab.content = content;
        renderTabs();
        window.Terminal.success(`${tab.name} saved successfully.`);
        deployHandle.resolve(true);

        // --- LIVE AUTO-SYNC (SIP-3.4) ---
        if (type === 'LWC') {
            // Resolve DeveloperName so the preview tab navigates to the currently
            // active component, not whichever was previously previewed.
            let liveBundleName = null;
            try {
                // 1. Prefer explicit bundleId → DeveloperName lookup
                if (tab.bundleId && Array.isArray(window.metadataCache?.LWC)) {
                    const rec = window.metadataCache.LWC.find(b => b.Id === tab.bundleId);
                    if (rec?.DeveloperName) liveBundleName = rec.DeveloperName;
                }
                // 2. Fallback: derive from file name (e.g. "accountDetail.html" → "accountDetail")
                if (!liveBundleName && tab.name) {
                    liveBundleName = tab.name.split('.')[0] || null;
                }
            } catch (e) {
                console.warn('[SF-Intel] Live sync: could not resolve bundle name', e);
            }

            let livePreviewUrl = null;
            try {
                if (liveBundleName && window.apiClient?.instanceUrl) {
                    livePreviewUrl = window.apiClient.getPreviewUrl(liveBundleName);
                }
            } catch (e) {
                console.warn('[SF-Intel] Live sync: getPreviewUrl failed', e);
            }

            chrome.runtime.sendMessage(
                { action: 'reload-preview-tabs', previewUrl: livePreviewUrl },
                (response) => {
                    if (chrome.runtime.lastError) return; // SW not running or no listener
                    if (response?.count > 0) {
                        window.Terminal.log(`⚡ Live Sync: ${response.count} preview tab(s) refreshed.`);
                    }
                }
            );
        }
        
        // --- UX REFRESH (v3.0.0+) ---
        checkTestContext(tab);

        // --- POST-SAVE ACTION (SIP-3.4) ---
        if (window.postSaveAction) {
            const action = window.postSaveAction;
            window.postSaveAction = null;
            action();
        }

    } catch (err) {
        if (isTimeoutError(err)) {
            window.Terminal.warn(`Deploy timed out — ${err.message}`);
            deployHandle.resolve(false, err.message, true); // true = warn not error
        } else {
            window.Terminal.error(`Save Failed: ${err.message}`);
            deployHandle.resolve(false, err.message);
            if (err.diagnostics) {
                window.Problems.update(err.diagnostics);
                switchBottomTab('problems');
            }
        }
        window.postSaveAction = null; // Clear on error
    } finally {
        const saveBtn = document.getElementById('sf-intel-save');
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.classList.add('enabled');
            // Logic handled by checkTestContext now to keep state consistent
            checkTestContext(window.openTabs.find(t => t.id === window.activeTabId));
        }
    }
}

function openCreateModal(action) {
    const overlay = document.getElementById('modal-overlay');
    const modals = document.querySelectorAll('.modal-content');
    if (!overlay) return;

    modals.forEach(m => m.style.display = 'none');
    overlay.style.display = 'flex';

    const api = (window.apiClient?.apiVersion || 'v59.0').replace('v', '');

    if (action === 'new-apex') {
        document.getElementById('apex-name').value = '';
        document.getElementById('new-apex-modal').style.display = 'flex';
        document.getElementById('apex-name').focus();
        validateForm('apex');
    } else if (action === 'new-trigger') {
        // Reset stale state before showing
        document.getElementById('trigger-name').value = '';
        document.getElementById('trigger-sobject').value = '';
        document.querySelectorAll('.trigger-event').forEach(cb => cb.checked = false);
        const errPanel = document.getElementById('trigger-compiler-errors');
        if (errPanel) errPanel.style.display = 'none';
        document.getElementById('new-trigger-modal').style.display = 'flex';
        document.getElementById('trigger-name').focus();
        validateForm('trigger');
    } else if (action === 'new-lwc') {
        document.getElementById('lwc-name').value = '';
        const lwcErrPanel = document.getElementById('lwc-compiler-errors');
        if (lwcErrPanel) lwcErrPanel.style.display = 'none';
        document.getElementById('new-lwc-modal').style.display = 'flex';
        const apiInput = document.getElementById('lwc-api');
        if (apiInput) apiInput.value = api;
        document.getElementById('lwc-name').focus();
        validateForm('lwc');
    } else if (action === 'new-aura') {
        document.getElementById('new-aura-modal').style.display = 'flex';
        // Add API input for Aura if it exists in HTML
        const apiInput = document.getElementById('aura-api');
        if (apiInput) apiInput.value = api;
        document.getElementById('aura-name').focus();
        validateForm('aura');
    }
}

function validateForm(type) {
    let isValid = false;
    if (type === 'apex') {
        const name = document.getElementById('apex-name').value.trim();
        isValid = name.length > 0 && /^[a-zA-Z][a-zA-Z0-9_]*$/.test(name);
        document.getElementById('apex-create').disabled = !isValid;
    } else if (type === 'trigger') {
        const name = document.getElementById('trigger-name').value.trim();
        const sobject = document.getElementById('trigger-sobject').value.trim();
        const events = Array.from(document.querySelectorAll('.trigger-event:checked')).map(e => e.value);
        isValid = name.length > 0 && sobject.length > 0 && events.length > 0 && /^[a-zA-Z][a-zA-Z0-9_]*$/.test(name);
        document.getElementById('trigger-create').disabled = !isValid;
    } else if (type === 'lwc') {
        const nameInput = document.getElementById('lwc-name');
        const name = nameInput.value.trim();
        const exposed = document.getElementById('lwc-exposed').checked;
        const targets = Array.from(document.querySelectorAll('.lwc-target:checked')).map(e => e.value);

        let isValidName = name.length > 0 && /^[a-z][a-zA-Z0-9]*$/.test(name);
        let isValidTargets = !exposed || targets.length > 0;

        isValid = isValidName && isValidTargets;

        // Show/hide specific validation error messages
        const targetError = document.getElementById('lwc-target-error');
        if (targetError) {
            targetError.style.display = (exposed && !isValidTargets) ? 'block' : 'none';
        }

        document.getElementById('lwc-create').disabled = !isValid;
    } else if (type === 'aura') {
        const name = document.getElementById('aura-name').value.trim();
        isValid = name.length > 0 && /^[a-zA-Z][a-zA-Z0-9_]*$/.test(name);
        document.getElementById('aura-create').disabled = !isValid;
    }
}

const Scaffolder = {
    getApex(name, sharing, sobject) {
        if (sobject) {
            return `public ${sharing} class ${name} {\n    public static void handle(${sobject} record) {\n\n    }\n}`;
        }
        return `public ${sharing} class ${name} {\n    public ${name}() {\n\n    }\n}`;
    },
    getTrigger(name, sobject, events, api = '59.0') {
        // SAFE DEFAULT: Generate minimal, empty trigger
        // Single event only, no boilerplate, no context checks
        const event = events[0]; // Always single event now (radio buttons)

        const bundle = {};
        bundle[`triggers/${name}.trigger`] = `trigger ${name} on ${sobject} (${event}) {\n    \n}`;
        bundle[`triggers/${name}.trigger-meta.xml`] = `<?xml version="1.0" encoding="UTF-8"?>
<ApexTrigger xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>${api}</apiVersion>
    <status>Active</status>
</ApexTrigger>`;

        return bundle;
    },
    getLwc(name, exposed, targets, api = '59.0') {
        const bundle = {};
        const className = name.charAt(0).toUpperCase() + name.slice(1);

        bundle[`${name}.html`] = `<template>\n    <lightning-card title="${name}">\n        <div class="slds-p-around_medium">\n        </div>\n    </lightning-card>\n</template>`;
        bundle[`${name}.js`] = `import { LightningElement } from 'lwc';\n\nexport default class ${className} extends LightningElement {\n}`;

        // Ensure targets are clean and filtered
        const validTargets = (targets || []).filter(t => t && t.trim().length > 0);

        let targetXml = '';
        if (exposed && validTargets.length > 0) {
            targetXml = `\n    <targets>\n${validTargets.map(t => `        <target>${t}</target>`).join('\n')}\n    </targets>`;
        } else if (exposed) {
            // This should ideally be caught by UI validation but adding as safe-guard
            console.error(`[Scaffolder] LWC isExposed is true but no valid targets provided for ${name}`);
        }

        bundle[`${name}.js-meta.xml`] = `<?xml version="1.0" encoding="UTF-8"?>\n<LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata">\n    <apiVersion>${api}</apiVersion>\n    <isExposed>${exposed}</isExposed>${targetXml}\n</LightningComponentBundle>`;
        return bundle;
    },
    getAura(name, api = '59.0') {
        const bundle = {};
        bundle[`${name}.cmp`] = `<aura:component>\n\n</aura:component>`;
        bundle[`${name}Controller.js`] = `({\n    myAction : function(component, event, helper) {\n\n    }\n})`;
        bundle[`${name}Helper.js`] = `({\n    helperMethod : function() {\n\n    }\n})`;
        bundle[`${name}.css`] = `.THIS {\n}`;
        bundle[`${name}.design`] = `<design:component>\n</design:component>`;
        bundle[`${name}.svg`] = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<svg width="120px" height="120px" viewBox="0 0 120 120" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">\n    <g stroke="none" stroke-width="1" fill="none" fill-rule="evenodd">\n        <circle fill="#04844b" cx="60" cy="60" r="52"></circle>\n    </g>\n</svg>`;
        bundle[`${name}.cmp-meta.xml`] = `<?xml version="1.0" encoding="UTF-8"?>\n<AuraDefinitionBundle xmlns="http://soap.sforce.com/2006/04/metadata">\n    <apiVersion>${api}</apiVersion>\n    <description>Created via SF-Intel Studio</description>\n</AuraDefinitionBundle>`;
        return bundle;
    }
};

const PRIMARY_FILE_EXT = {
    'ApexClass': '.cls',
    'ApexTrigger': '.trigger',
    'LWC': '.html',
    'AuraDefinitionBundle': '.cmp'
};

async function autoOpenCreated(type, name) {
    window.Terminal.log(`[SF-Intel] Resolving newly created ${type}: ${name}...`);

    let attempts = 0;
    const maxAttempts = 5;
    const delay = 1500; // Increased delay to 1.5s for reliability

    while (attempts < maxAttempts) {
        attempts++;
        if (attempts > 1) {
            window.Terminal.log(`[SF-Intel] Retrying resolution (Attempt ${attempts}/${maxAttempts})...`);
        }

        // 1. Refresh global metadata cache
        if (window.MetadataExplorer) await window.MetadataExplorer.loadAll();

        try {
            let itemId = null;
            let fileName = '';

            if (type === 'ApexClass' || type === 'ApexTrigger') {
                const query = `SELECT Id FROM ${type} WHERE Name = '${name}' AND NamespacePrefix = null LIMIT 1`;
                const result = await window.apiClient.toolingQuery(query);
                if (result.records && result.records[0]) {
                    itemId = result.records[0].Id;
                    fileName = name; // No extension — tab shows clean name only
                }
            } else if (type === 'LWC') {
                const query = `SELECT Id FROM LightningComponentBundle WHERE DeveloperName = '${name}' AND NamespacePrefix = null LIMIT 1`;
                const result = await window.apiClient.toolingQuery(query);
                if (result.records && result.records[0]) {
                    const bundleId = result.records[0].Id;
                    const files = await window.apiClient.getLwcBundleFiles(bundleId);
                    window.lwcBundleCache[bundleId] = files;
                    const primaryFile = files.find(f => f.FilePath.endsWith(PRIMARY_FILE_EXT[type])) || files[0];
                    if (primaryFile) {
                        itemId = primaryFile.Id;
                        fileName = primaryFile.FilePath.split('/').pop();
                    }
                }
            } else if (type === 'AuraDefinitionBundle') {
                const query = `SELECT Id FROM AuraDefinitionBundle WHERE DeveloperName = '${name}' AND NamespacePrefix = null LIMIT 1`;
                const result = await window.apiClient.toolingQuery(query);
                if (result.records && result.records[0]) {
                    const bundleId = result.records[0].Id;
                    const files = await window.apiClient.getAuraBundleFiles(bundleId);
                    window.auraBundleCache[bundleId] = files;
                    const primaryFile = files.find(f => f.Extension === PRIMARY_FILE_EXT[type].replace('.', '')) || files[0];
                    if (primaryFile) {
                        itemId = primaryFile.Id;
                        fileName = primaryFile.path.split('/').pop();
                    }
                }
            }

            if (itemId) {
                window.Terminal.success(`[SF-Intel] Resource found: ${fileName}. Opening in editor...`);
                window.openItem(itemId, fileName, type);

                // Focus and set cursor to Line 1 (Wait for content load)
                setTimeout(() => {
                    sendToEditor({ type: 'SET_CURSOR', line: 1, column: 1 });
                    sendToEditor({ type: 'FOCUS' });
                }, 1000);
                return; // Success! Exit loop
            }
        } catch (err) {
            console.warn('[SF-Intel] Resolution attempt failed:', err);
        }

        await new Promise(r => setTimeout(r, delay));
    }

    window.Terminal.error(`[SF-Intel] Could not automatically resolve ${name} after ${maxAttempts} attempts. Please refresh the file tree manually.`);
}


function closeModal() {
    const overlay = document.getElementById('modal-overlay');
    if (overlay) overlay.style.display = 'none';

    // Clear inputs and reset buttons
    document.querySelectorAll('.modal-content input').forEach(i => i.value = '');
    document.querySelectorAll('.error-msg').forEach(e => e.innerText = '');

    // Reset all create buttons to original state
    ['apex-create', 'trigger-create', 'lwc-create', 'aura-create'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.innerHTML = 'CREATE';
            btn.disabled = false;
        }
    });

    // Reset validation states
    ['apex', 'trigger', 'lwc', 'aura'].forEach(type => validateForm(type));
}

let isCreating = false;

async function handleCreateApex() {
    if (isCreating) return;
    const name = document.getElementById('apex-name').value.trim();
    const sharing = document.getElementById('apex-sharing').value;
    const sobject = document.getElementById('apex-sobject').value.trim();
    if (!name) return;

    isCreating = true;
    const createBtn = document.getElementById('apex-create');
    if (createBtn) {
        createBtn.disabled = true;
        createBtn.innerHTML = '⏳ CREATING...';
    }

    window.Terminal.log(`[SF-Intel] Creating Apex Class ${name}...`);
    const deployHandle = DeployToast.showPending(name, 'ApexClass');
    try {
        const body = Scaffolder.getApex(name, sharing, sobject);
        await window.apiClient.createApexClass(name, body);
        window.Terminal.success(`[SF-Intel] Apex Class ${name} created successfully.`);
        deployHandle.resolve(true);
        closeModal();
        await autoOpenCreated('ApexClass', name);
    } catch (err) {
        deployHandle.resolve(false, err.message, isTimeoutError(err));
        if (isTimeoutError(err)) {
            window.Terminal.warn(`Deploy timed out — ${err.message}`);
        } else {
            window.Terminal.error(`Creation Failed: ${err.message}`);
            document.getElementById('apex-name-error').innerText = err.message;
            document.getElementById('apex-name-error').style.display = 'block';
        }
        if (createBtn) {
            createBtn.disabled = false;
            createBtn.innerHTML = 'CREATE';
        }
    } finally {
        isCreating = false;
    }
}

async function handleCreateTrigger() {
    if (isCreating) return;
    const name = document.getElementById('trigger-name').value.trim();
    const sobject = document.getElementById('trigger-sobject').value.trim();
    const events = Array.from(document.querySelectorAll('.trigger-event:checked')).map(e => e.value);

    if (!name || !sobject || events.length === 0) return;

    isCreating = true;
    const createBtn = document.getElementById('trigger-create');
    if (createBtn) {
        createBtn.disabled = true;
        createBtn.innerHTML = '⏳ CREATING...';
    }

    // Hide previous errors
    const errorPanel = document.getElementById('trigger-compiler-errors');
    if (errorPanel) errorPanel.style.display = 'none';

    window.Terminal.log(`[SF-Intel] Creating Apex Trigger ${name} on ${sobject} (Atomic)...`);
    const deployHandle = DeployToast.showPending(name, 'ApexTrigger');
    try {
        const api = window.apiClient.apiVersion.replace('v', '') || '59.0';
        const bundleMap = Scaffolder.getTrigger(name, sobject, events, api);
        await window.apiClient.createApexTrigger(name, sobject, bundleMap, api);
        window.Terminal.success(`[SF-Intel] Trigger ${name} created successfully via Metadata API.`);
        deployHandle.resolve(true);
        closeModal();
        await autoOpenCreated('ApexTrigger', name);
    } catch (err) {
        deployHandle.resolve(false, err.message, isTimeoutError(err));
        if (isTimeoutError(err)) {
            window.Terminal.warn(`Deploy timed out — ${err.message}`);
        } else {
        // Check if this is a DeploymentError with diagnostics
        if (err.diagnostics && Array.isArray(err.diagnostics) && err.diagnostics.length > 0) {
            const count = err.diagnostics.length;
            console.log('[DEBUG] Diagnostics count:', count);
            console.log('[DEBUG] Error panel element:', errorPanel);

            // Display structured compiler errors inline in modal
            const errorCount = document.getElementById('trigger-error-count');
            const errorList = document.getElementById('trigger-error-list');

            console.log('[DEBUG] errorCount element:', errorCount);
            console.log('[DEBUG] errorList element:', errorList);

            if (errorCount && errorList && errorPanel) {
                errorCount.textContent = `${count} Compilation Error${count > 1 ? 's' : ''}`;

                // Build error list HTML
                let errorsHtml = '';
                err.diagnostics.forEach((diag, index) => {
                    const lineInfo = diag.line ? `<strong>Line ${diag.line}</strong>${diag.column ? `, Column ${diag.column}` : ''}` : '';
                    const fileInfo = diag.file ? `<span style="color: #888;">[${_escapeHtml(diag.file)}]</span>` : '';

                    errorsHtml += `
                        <div style="margin-bottom: ${index < count - 1 ? '10px' : '0'}; padding-bottom: ${index < count - 1 ? '10px' : '0'}; border-bottom: ${index < count - 1 ? '1px solid rgba(255,255,255,0.1)' : 'none'};">
                            ${fileInfo}
                            ${lineInfo ? `<div style="color: #ffcc00; font-size: 11px; margin-top: 2px;">${lineInfo}</div>` : ''}
                            <div style="margin-top: 4px; color: #fff;">${_escapeHtml(diag.message || 'Unknown error')}</div>
                        </div>
                    `;
                });

                console.log('[DEBUG] errorsHtml:', errorsHtml);
                errorList.innerHTML = errorsHtml;
                errorPanel.style.display = 'block';
                console.log('[DEBUG] Error panel should now be visible');
            } else {
                console.error('[DEBUG] Missing elements - errorCount:', errorCount, 'errorList:', errorList, 'errorPanel:', errorPanel);
            }

            window.Terminal.error(`[SF-Intel] Trigger Creation Failed: ${count} compiler error${count > 1 ? 's' : ''} found`);
        } else {
            console.log('[DEBUG] No diagnostics, showing generic error');
            // Generic error without diagnostics
            window.Terminal.error(`[SF-Intel] Trigger Creation Failed: ${err.message}`);

            // Show simple error message
            if (errorPanel) {
                const errorCount = document.getElementById('trigger-error-count');
                const errorList = document.getElementById('trigger-error-list');

                if (errorCount && errorList) {
                    errorCount.textContent = 'Creation Failed';
                    errorList.innerHTML = `<div style="color: #fff;">${_escapeHtml(err.message)}</div>`;
                    errorPanel.style.display = 'block';
                }
            }
        }
        } // end if (!isTimeoutError)

        // Keep modal open and re-enable create button for retry
        if (createBtn) {
            createBtn.disabled = false;
            createBtn.innerHTML = 'CREATE';
        }
    } finally {
        isCreating = false;
    }
}

// ── Deploy Toast System ───────────────────────────────────────────────────
// Manages pending → success | error toast lifecycle with progressive messaging.
const DeployToast = (() => {
    const SUCCESS_DURATION = 4500;
    const BADGE = { LWC: 'lwc', Aura: 'aura', AuraDefinitionBundle: 'aura', ApexClass: 'apex', ApexTrigger: 'trigger' };
    const LABEL = { LWC: 'LWC', Aura: 'Aura', AuraDefinitionBundle: 'Aura', ApexClass: 'Apex', ApexTrigger: 'Trigger' };

    function _repack() {
        document.querySelectorAll('.deploy-toast').forEach((t, i) => {
            t.style.bottom = `${24 + i * 72}px`;
        });
    }

    function _dismiss(toast) {
        if (!toast.parentElement) return;
        toast.classList.add('deploy-toast--out');
        setTimeout(() => { toast.remove(); _repack(); }, 210);
    }

    // Show an in-progress toast immediately. Returns a handle with .resolve(ok, msg).
    function showPending(name, type) {
        const badgeClass = BADGE[type] || 'apex';
        const label      = LABEL[type] || type;
        const stackOffset = document.querySelectorAll('.deploy-toast').length * 72;

        const toast = document.createElement('div');
        toast.className = 'deploy-toast deploy-toast--pending';
        toast.style.bottom = `${24 + stackOffset}px`;
        toast.innerHTML = `
            <div class="deploy-toast__body">
                <div class="deploy-toast__icon"><div class="deploy-toast__spinner"></div></div>
                <div class="deploy-toast__text">
                    <div class="deploy-toast__title">Deploying</div>
                    <div class="deploy-toast__name">
                        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</span>
                        <span class="deploy-toast__badge deploy-toast__badge--${badgeClass}">${label}</span>
                    </div>
                    <div class="deploy-toast__sub deploy-toast__sub--live">Sending to org\u2026</div>
                </div>
                <button class="deploy-toast__close" title="Dismiss">\u00d7</button>
            </div>
            <div class="deploy-toast__progress">
                <div class="deploy-toast__progress-bar deploy-toast__progress-bar--indeterminate"></div>
            </div>`;

        const subEl = toast.querySelector('.deploy-toast__sub--live');
        const timers = [];
        // Progressive messaging: update subtitle if deployment takes a while
        timers.push(setTimeout(() => { if (subEl && toast.parentElement) subEl.textContent = 'Still working\u2026'; }, 10000));
        timers.push(setTimeout(() => { if (subEl && toast.parentElement) subEl.textContent = 'Deployment taking longer than usual'; }, 30000));

        toast.querySelector('.deploy-toast__close').addEventListener('click', () => {
            timers.forEach(clearTimeout);
            _dismiss(toast);
        });

        document.body.appendChild(toast);

        return {
            resolve(success, errMsg, isWarn) {
                timers.forEach(clearTimeout); // Always clean up timers
                if (!toast.parentElement) return;

                const iconEl  = toast.querySelector('.deploy-toast__icon');
                const titleEl = toast.querySelector('.deploy-toast__title');
                const bar     = toast.querySelector('.deploy-toast__progress-bar');

                bar.classList.remove('deploy-toast__progress-bar--indeterminate');

                if (success) {
                    toast.classList.replace('deploy-toast--pending', 'deploy-toast--success');
                    toast.style.setProperty('--deploy-dur', `${SUCCESS_DURATION}ms`);
                    iconEl.innerHTML = '\u2713';
                    iconEl.className = 'deploy-toast__icon deploy-toast__icon--success';
                    titleEl.textContent = 'Deployed';
                    subEl.textContent = 'Saved to org';
                    subEl.className = 'deploy-toast__sub';
                    // Restart countdown bar animation
                    void bar.offsetWidth;
                    bar.style.animation = `deployProgressShrink ${SUCCESS_DURATION}ms linear forwards`;
                    setTimeout(() => _dismiss(toast), SUCCESS_DURATION);
                } else if (isWarn) {
                    // Timeout — deployment may still be processing, not a hard failure
                    toast.classList.replace('deploy-toast--pending', 'deploy-toast--warn');
                    iconEl.innerHTML = '&#9888;';
                    iconEl.className = 'deploy-toast__icon deploy-toast__icon--warn';
                    titleEl.textContent = 'Deploy Timed Out';
                    subEl.textContent = 'Check your org — it may have succeeded.';
                    subEl.className = 'deploy-toast__sub deploy-toast__sub--warn';
                    bar.style.display = 'none';
                } else {
                    toast.classList.replace('deploy-toast--pending', 'deploy-toast--error');
                    iconEl.innerHTML = '\u2715';
                    iconEl.className = 'deploy-toast__icon deploy-toast__icon--error';
                    titleEl.textContent = 'Deploy Failed';
                    const msg = (errMsg || 'An error occurred.').split('\n')[0];
                    subEl.textContent = msg;
                    subEl.title = errMsg || '';
                    subEl.className = 'deploy-toast__sub deploy-toast__sub--error';
                    bar.style.display = 'none';
                    // "View Output" action — opens terminal, then dismisses
                    const actionsEl = document.createElement('div');
                    actionsEl.className = 'deploy-toast__actions';
                    actionsEl.innerHTML = '<button class="deploy-toast__action-btn">View Output</button>';
                    actionsEl.querySelector('.deploy-toast__action-btn').addEventListener('click', () => {
                        if (window.Terminal) window.Terminal.open();
                        _dismiss(toast);
                    });
                    toast.insertBefore(actionsEl, toast.querySelector('.deploy-toast__progress'));
                    // Error toasts persist until user dismisses
                }
            }
        };
    }

    return { showPending };
})();

// Back-compat shim used by create handlers (shows instant success)
function showDeployToast(name, type, action = 'created') {
    const BADGE = { LWC: 'lwc', Aura: 'aura', AuraDefinitionBundle: 'aura', ApexClass: 'apex', ApexTrigger: 'trigger' };
    const LABEL = { LWC: 'LWC', Aura: 'Aura', AuraDefinitionBundle: 'Aura', ApexClass: 'Apex', ApexTrigger: 'Trigger' };
    const badgeClass = BADGE[type] || 'apex';
    const label      = LABEL[type] || type;
    const titleText  = action === 'created' ? 'Created' : 'Deployed';
    const subText    = action === 'created' ? 'Created and deployed to org' : 'Saved to org';
    const DURATION   = 4500;

    const stackOffset = document.querySelectorAll('.deploy-toast').length * 72;
    const toast = document.createElement('div');
    toast.className = 'deploy-toast deploy-toast--success';
    toast.style.bottom = `${24 + stackOffset}px`;
    toast.style.setProperty('--deploy-dur', `${DURATION}ms`);
    toast.innerHTML = `
        <div class="deploy-toast__body">
            <div class="deploy-toast__icon deploy-toast__icon--success">\u2713</div>
            <div class="deploy-toast__text">
                <div class="deploy-toast__title">${titleText}</div>
                <div class="deploy-toast__name">
                    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</span>
                    <span class="deploy-toast__badge deploy-toast__badge--${badgeClass}">${label}</span>
                </div>
                <div class="deploy-toast__sub">${subText}</div>
            </div>
            <button class="deploy-toast__close" title="Dismiss">\u00d7</button>
        </div>
        <div class="deploy-toast__progress">
            <div class="deploy-toast__progress-bar"></div>
        </div>`;

    const dismiss = () => {
        if (!toast.parentElement) return;
        toast.classList.add('deploy-toast--out');
        setTimeout(() => { toast.remove(); document.querySelectorAll('.deploy-toast').forEach((t, i) => { t.style.bottom = `${24 + i * 72}px`; }); }, 210);
    };
    toast.querySelector('.deploy-toast__close').addEventListener('click', dismiss);
    document.body.appendChild(toast);
    setTimeout(dismiss, DURATION);
}

async function handleCreateLwc() {
    if (isCreating) return;
    const name = document.getElementById('lwc-name').value.trim();
    const exposed = document.getElementById('lwc-exposed').checked;
    const targets = Array.from(document.querySelectorAll('.lwc-target:checked')).map(e => e.value);
    const api = document.getElementById('lwc-api').value || '59.0';

    if (!name) return;

    isCreating = true;
    const createBtn = document.getElementById('lwc-create');
    if (createBtn) {
        createBtn.disabled = true;
        createBtn.innerHTML = '⏳ CREATING...';
    }

    // Hide previous errors
    const errorPanel = document.getElementById('lwc-compiler-errors');
    if (errorPanel) errorPanel.style.display = 'none';

    window.Terminal.log(`Deploying atomic LWC bundle: ${name}...`);
    const deployHandle = DeployToast.showPending(name, 'LWC');
    try {
        const bundleMap = Scaffolder.getLwc(name, exposed, targets, api);
        await window.apiClient.deployBundleAtomic('LWC', name, bundleMap, api);

        // 🔍 VERIFICATION: Check if component actually exists in Salesforce
        const verified = await window.apiClient.verifyBundleSuccess('LWC', name);
        if (verified) {
            window.Terminal.success(`✅ LWC ${name} created and deployed.`);
            deployHandle.resolve(true);
            window.Terminal.log(`💡 SFDX User? Run: sf project retrieve start -m LightningComponentBundle:${name}`);
        } else {
            throw new Error(`Deployment reported success, but component '${name}' was not found in Salesforce. Check permissions or org space.`);
        }

        closeModal();
        await autoOpenCreated('LWC', name);
    } catch (err) {
        deployHandle.resolve(false, err.message, isTimeoutError(err));
        if (isTimeoutError(err)) {
            window.Terminal.warn(`Deploy timed out — ${err.message}`);
        } else {
        // Check if this is a DeploymentError with diagnostics
        if (err.diagnostics && Array.isArray(err.diagnostics) && err.diagnostics.length > 0) {
            const count = err.diagnostics.length;

            // Display structured compiler errors inline in modal
            const errorCount = document.getElementById('lwc-error-count');
            const errorList = document.getElementById('lwc-error-list');

            if (errorCount && errorList && errorPanel) {
                errorCount.textContent = `${count} Compilation Error${count > 1 ? 's' : ''}`;

                // Build error list HTML with deduplication
                let errorsHtml = '';
                const seenErrors = new Set();
                const uniqueDiagnostics = err.diagnostics.filter(diag => {
                    const key = `${diag.file}|${diag.line}|${diag.column}|${diag.message}`;
                    if (seenErrors.has(key)) return false;
                    seenErrors.add(key);
                    return true;
                });

                uniqueDiagnostics.forEach((diag, index) => {
                    const lineInfo = diag.line ? `<strong>Line ${diag.line}</strong>${diag.column ? `, Column ${diag.column}` : ''}` : '';
                    const fileInfo = diag.file ? `<span style="color: #888;">[${_escapeHtml(diag.file)}]</span>` : '';

                    errorsHtml += `
                        <div style="margin-bottom: ${index < uniqueDiagnostics.length - 1 ? '10px' : '0'}; padding-bottom: ${index < uniqueDiagnostics.length - 1 ? '10px' : '0'}; border-bottom: ${index < uniqueDiagnostics.length - 1 ? '1px solid rgba(255,255,255,0.1)' : 'none'};">
                            ${fileInfo}
                            ${lineInfo ? `<div style="color: #ffcc00; font-size: 11px; margin-top: 2px;">${lineInfo}</div>` : ''}
                            <div style="margin-top: 4px; color: #fff;">${_escapeHtml(diag.message || 'Unknown error')}</div>
                        </div>
                    `;
                });

                errorList.innerHTML = errorsHtml;
                errorPanel.style.display = 'block';
            }

            // Also log to terminal for reference
            err.diagnostics.forEach(d => {
                window.Terminal.error(`  - [Error] ${d.file}:${d.line || ''} - ${d.message}`);
            });
            if (window.Problems) window.Problems.update(err.diagnostics);

            window.Terminal.error(`LWC Creation Failed: ${count} compiler error${count > 1 ? 's' : ''} found`);
        } else {
            // Generic error without diagnostics
            window.Terminal.error(`LWC Creation Failed: ${err.message}`);

            // Show simple error message
            if (errorPanel) {
                const errorCount = document.getElementById('lwc-error-count');
                const errorList = document.getElementById('lwc-error-list');

                if (errorCount && errorList) {
                    errorCount.textContent = 'Creation Failed';
                    errorList.innerHTML = `<div style="color: #fff;">${_escapeHtml(err.message)}</div>`;
                    errorPanel.style.display = 'block';
                }
            }
        }
        } // end if (!isTimeoutError)

        // Keep modal open and re-enable create button for retry
        if (createBtn) {
            createBtn.disabled = false;
            createBtn.innerHTML = 'CREATE';
        }
    } finally {
        isCreating = false;
    }
}

async function handleCreateAura() {
    if (isCreating) return;
    const name = document.getElementById('aura-name').value.trim();
    const api = '59.0';

    if (!name) return;

    isCreating = true;
    const createBtn = document.getElementById('aura-create');
    if (createBtn) {
        createBtn.disabled = true;
        createBtn.innerHTML = '⏳ CREATING...';
    }

    window.Terminal.log(`Deploying atomic Aura bundle: ${name}...`);
    const deployHandle = DeployToast.showPending(name, 'Aura');
    try {
        const bundleMap = Scaffolder.getAura(name, api);
        await window.apiClient.deployBundleAtomic('Aura', name, bundleMap, api);

        // 🔍 VERIFICATION
        const verified = await window.apiClient.verifyBundleSuccess('Aura', name);
        if (verified) {
            window.Terminal.success(`✅ Aura Bundle ${name} created and deployed.`);
            deployHandle.resolve(true);
            window.Terminal.log(`💡 SFDX User? Run: sf project retrieve start -m AuraDefinitionBundle:${name}`);
        } else {
            throw new Error(`Deployment reported success, but component '${name}' was not found in Salesforce.`);
        }

        closeModal();
        await autoOpenCreated('AuraDefinitionBundle', name);
    } catch (err) {
        deployHandle.resolve(false, err.message);
        window.Terminal.error(`Aura Creation Failed: ${err.message}`);
        if (err.diagnostics && err.diagnostics.length > 0) {
            err.diagnostics.forEach(d => {
                window.Terminal.error(`  - [Error] ${d.file}:${d.line} - ${d.message}`);
            });
            if (window.Problems) window.Problems.update(err.diagnostics);
        }
        document.getElementById('aura-name-error').innerText = err.message;
        document.getElementById('aura-name-error').style.display = 'block';
        if (createBtn) {
            createBtn.disabled = false;
            createBtn.innerHTML = 'CREATE';
        }
    } finally {
        isCreating = false;
    }
}

function sendToEditor(msg, target = 'main') {
    const iframeId = target === 'main' ? 'editor-iframe' : 'utility-iframe';
    const iframe = document.getElementById(iframeId);
    if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage(msg, window.location.origin);
    }
}

// --- LAYOUT & RESIZERS ---
function setupResizers() {
    const sidebar = document.getElementById('sidebar');
    const resizer = document.getElementById('sidebar-resizer');

    let isSidebarResizing = false;
    if (resizer) {
        resizer.onmousedown = () => isSidebarResizing = true;
        document.addEventListener('mousemove', (e) => {
            if (!isSidebarResizing) return;
            const width = e.clientX;
            if (sidebar && width > 200 && width < 600) {
                sidebar.style.width = width + 'px';
            }
        });
        document.addEventListener('mouseup', () => { isSidebarResizing = false; });
    }

    // --- Utility Editor / Results Vertical Resizer ---
    const utilResizer = document.getElementById('utility-resizer');
    if (utilResizer) {
        let isUtilResizing = false;

        utilResizer.addEventListener('mousedown', (e) => {
            isUtilResizing = true;
            e.preventDefault();
            // Disable pointer events on iframes during drag to prevent them swallowing mouse events
            document.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = 'none');
            document.body.style.cursor = 'row-resize';
            utilResizer.classList.add('active');
        });

        document.addEventListener('mousemove', (e) => {
            if (!isUtilResizing) return;
            const monacoContainer = document.getElementById('utility-monaco-container');
            const utilBody = document.getElementById('utility-body');
            if (!monacoContainer || !utilBody) return;

            const bodyRect = utilBody.getBoundingClientRect();
            const newHeight = e.clientY - bodyRect.top;

            // Clamp between 60px and 80% of the utility body height
            const minH = 60;
            const maxH = bodyRect.height * 0.8;
            const clampedHeight = Math.max(minH, Math.min(maxH, newHeight));

            monacoContainer.style.flex = 'none';
            monacoContainer.style.height = clampedHeight + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (!isUtilResizing) return;
            isUtilResizing = false;
            document.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = '');
            document.body.style.cursor = '';
            utilResizer.classList.remove('active');
        });
    }
}

// --- SOQL Editor Action Buttons ---
function setupSoqlEditorActions() {
    const searchBtn = document.getElementById('soql-action-search');
    const copyBtn = document.getElementById('soql-action-copy');
    if (searchBtn) {
        searchBtn.onclick = () => {
            // Trigger Monaco's built-in Find widget in the utility editor
            sendToEditor({ type: 'EXECUTE_ACTION', action: 'actions.find' }, 'utility');
        };
    }

    if (copyBtn) {
        copyBtn.onclick = () => {
            const modelId = window.UtilsPanel?.activeSoqlTab?.modelId || 'util-soql-1';
            window._soqlActionPending = true;
            sendToEditor({ type: 'GET_CONTENT', modelId }, 'utility');
            const handler = (event) => {
                if (event.origin !== window.location.origin) return; // P0 Security: origin validation
                const msg = event.data;
                if (msg.type === 'CONTENT_RESULT' && msg.id === modelId) {
                    window.removeEventListener('message', handler);
                    navigator.clipboard.writeText(msg.value).then(() => {
                        if (window.Terminal) window.Terminal.success('Query copied to clipboard');
                        copyBtn.classList.add('flash');
                        setTimeout(() => copyBtn.classList.remove('flash'), 600);
                    });
                }
            };
            window.addEventListener('message', handler);
            setTimeout(() => window.removeEventListener('message', handler), 3000);
        };
    }

    // Sidebar copy button (mirrors action strip copy)
    const sidebarCopyBtn = document.getElementById('soql-sidebar-copy');
    if (sidebarCopyBtn) {
        sidebarCopyBtn.onclick = () => {
            const modelId = window.UtilsPanel?.activeSoqlTab?.modelId || 'util-soql-1';
            sendToEditor({ type: 'GET_CONTENT', modelId }, 'utility');
            const handler = (event) => {
                if (event.origin !== window.location.origin) return; // P0 Security: origin validation
                const msg = event.data;
                if (msg.type === 'CONTENT_RESULT' && msg.id === modelId) {
                    window.removeEventListener('message', handler);
                    navigator.clipboard.writeText(msg.value).then(() => {
                        if (window.Terminal) window.Terminal.success('Query copied to clipboard');
                        sidebarCopyBtn.classList.add('flash');
                        setTimeout(() => sidebarCopyBtn.classList.remove('flash'), 600);
                    });
                }
            };
            window.addEventListener('message', handler);
            setTimeout(() => window.removeEventListener('message', handler), 3000);
        };
    }

    // Sidebar prettify button (mirrors action strip prettify)
    const sidebarPrettifyBtn = document.getElementById('soql-sidebar-prettify');
    if (sidebarPrettifyBtn) {
        sidebarPrettifyBtn.onclick = () => {
            const modelId = window.UtilsPanel?.activeSoqlTab?.modelId || 'util-soql-1';
            sendToEditor({ type: 'GET_CONTENT', modelId }, 'utility');
            const handler = (event) => {
                if (event.origin !== window.location.origin) return; // P0 Security: origin validation
                const msg = event.data;
                if (msg.type === 'CONTENT_RESULT' && msg.id === modelId) {
                    window.removeEventListener('message', handler);
                    const formatted = prettifySoql(msg.value);
                    sendToEditor({ type: 'SET_VALUE', value: formatted }, 'utility');
                    if (window.Terminal) window.Terminal.log('Query prettified');
                }
            };
            window.addEventListener('message', handler);
            setTimeout(() => window.removeEventListener('message', handler), 3000);
        };
    }

    // Export CSV button (file download)
    const exportCsvBtn = document.getElementById('soql-action-export-csv');
    if (exportCsvBtn) {
        exportCsvBtn.onclick = () => {
            if (window.UtilsPanel) {
                window.UtilsPanel.exportCSV();
            } else if (window.Terminal) {
                window.Terminal.warn('Run a query first to export results');
            }
        };
    }

    // Export clipboard dropdown
    setupExportDropdown();
}

function setupApexEditorActions() {
    const searchBtn = document.getElementById('apex-action-search');
    if (searchBtn) {
        searchBtn.onclick = () => {
            sendToEditor({ type: 'EXECUTE_ACTION', action: 'actions.find' }, 'utility');
        };
    }

    const copyBtn = document.getElementById('apex-sidebar-copy');
    if (copyBtn) {
        copyBtn.onclick = () => {
            window._soqlActionPending = true;
            sendToEditor({ type: 'GET_CONTENT', modelId: 'util-apex' }, 'utility');
            const handler = (event) => {
                if (event.origin !== window.location.origin) return; // P0 Security: origin validation
                const msg = event.data;
                if (msg.type === 'CONTENT_RESULT' && msg.id === 'util-apex') {
                    window.removeEventListener('message', handler);
                    navigator.clipboard.writeText(msg.value || '').then(() => {
                        copyBtn.classList.add('flash');
                        setTimeout(() => copyBtn.classList.remove('flash'), 600);
                        if (window.Terminal) window.Terminal.success('Code copied to clipboard');
                    });
                }
            };
            window.addEventListener('message', handler);
            setTimeout(() => window.removeEventListener('message', handler), 3000);
        };
    }

    const clearBtn = document.getElementById('apex-sidebar-clear');
    if (clearBtn) {
        clearBtn.onclick = () => {
            sendToEditor({
                type: 'SET_VALUE',
                value: '// Anonymous Apex Scratchpad\n\n'
            }, 'utility');
        };
    }

    // Setup Apex action strip buttons
    if (window.UtilsPanel) {
        window.UtilsPanel._setupApexActions();
        window.UtilsPanel._setupLogsActions();
    }
}

function setupExportDropdown() {
    const dropdown = document.getElementById('soql-export-dropdown');
    const btn = document.getElementById('soql-action-export');
    const menu = document.getElementById('soql-export-menu');
    if (!dropdown || !btn || !menu) return;

    function openMenu() {
        menu.classList.add('open');
        btn.classList.add('active');
        btn.setAttribute('aria-expanded', 'true');
        // Focus first item
        const first = menu.querySelector('.soql-strip-menu-item');
        if (first) first.focus();
        // Close on outside click
        setTimeout(() => document.addEventListener('click', outsideClick), 0);
        document.addEventListener('keydown', menuKeydown);
    }

    function closeMenu() {
        menu.classList.remove('open');
        btn.classList.remove('active');
        btn.setAttribute('aria-expanded', 'false');
        document.removeEventListener('click', outsideClick);
        document.removeEventListener('keydown', menuKeydown);
    }

    function outsideClick(e) {
        if (!dropdown.contains(e.target)) closeMenu();
    }

    function menuKeydown(e) {
        const items = [...menu.querySelectorAll('.soql-strip-menu-item:not([disabled])')];
        const idx = items.indexOf(document.activeElement);
        if (e.key === 'Escape') { closeMenu(); btn.focus(); e.preventDefault(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); items[(idx + 1) % items.length]?.focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); items[(idx - 1 + items.length) % items.length]?.focus(); }
        else if (e.key === 'Enter' && idx >= 0) { e.preventDefault(); items[idx].click(); }
    }

    btn.onclick = (e) => {
        e.stopPropagation();
        menu.classList.contains('open') ? closeMenu() : openMenu();
    };

    // Menu item handlers
    menu.querySelectorAll('.soql-strip-menu-item').forEach(item => {
        item.onclick = () => {
            closeMenu();
            const format = item.dataset.format;
            if (window.UtilsPanel) {
                window.UtilsPanel.copyToClipboard(format);
            }
        };
    });
}

function prettifySoql(query) {
    if (!query || !query.trim()) return query;

    // Normalize whitespace
    let q = query.replace(/\s+/g, ' ').trim();

    // Keywords that should start on a new line
    const lineBreakKeywords = [
        'SELECT', 'FROM', 'WHERE', 'AND', 'OR',
        'ORDER BY', 'GROUP BY', 'HAVING', 'LIMIT', 'OFFSET',
        'ALL ROWS', 'FOR UPDATE', 'FOR VIEW', 'FOR REFERENCE'
    ];

    // Insert line breaks before keywords (case-insensitive)
    for (const kw of lineBreakKeywords) {
        const regex = new RegExp(`\\b(${kw})\\b`, 'gi');
        q = q.replace(regex, '\n$1');
    }

    // Indent fields after SELECT (comma-separated, one per line)
    const selectMatch = q.match(/\nSELECT\s+(.+?)(?=\nFROM)/is);
    if (selectMatch) {
        const fields = selectMatch[1].split(',').map(f => f.trim()).filter(f => f);
        const formattedFields = fields.length > 3
            ? '\n    ' + fields.join(',\n    ')
            : ' ' + fields.join(', ');
        q = q.replace(selectMatch[0], '\nSELECT' + formattedFields);
    }

    // Indent AND/OR
    q = q.replace(/\n(AND|OR)\b/gi, '\n    $1');

    // Clean up leading newline
    q = q.replace(/^\n/, '');

    return q;
}

// Bundle specific openers (LWC/Aura)
window.openLwcFile = function (bundleId, index) {
    const files = window.lwcBundleCache[bundleId];
    if (files && files[index]) {
        const file = files[index];
        openItem(file.Id, file.FilePath.split('/').pop(), 'LWC', bundleId);  // Pass bundleId
    }
};

window.openAuraFile = function (bundleId, index) {
    const files = window.auraBundleCache[bundleId];
    if (files && files[index]) {
        const file = files[index];
        openItem(file.Id, file.path.split('/').pop(), 'AuraDefinitionBundle', bundleId);  // Pass bundleId
    }
};

// Utilities globally available
window.switchBottomTab = switchBottomTab;
window.switchViewMode = switchViewMode;
window.openItem = openItem;
window.sendToEditor = sendToEditor;

/**
 * Navigate to a specific line in a specific file (SIP-3.1)
 */
window.navigateToProblem = function (fileId, line) {
    console.log(`[SF-Intel] Navigating to ${fileId}:${line}`);
    switchTab(fileId);
    sendToEditor({
        type: 'NAVIGATE_TO_LINE',
        modelId: fileId,
        line: line
    });
};

/**
 * --- LWC PREVIEW ENGINE (SIP-3.3) ---
 */
let _lwcPreviewLoading = false;

async function handleLwcPreview() {
    const tab = window.openTabs.find(t => t.id === window.activeTabId);
    if (!tab || tab.type !== 'LWC') {
        window.Terminal.warn('Preview is only available for LWC components.');
        return;
    }

    // Prevent double-clicks
    if (_lwcPreviewLoading) return;

    const previewBtn = document.getElementById('ed-preview-lwc');
    const originalHTML = previewBtn ? previewBtn.innerHTML : '';

    function setLoading(loading) {
        _lwcPreviewLoading = loading;
        if (!previewBtn) return;
        if (loading) {
            previewBtn.classList.add('loading');
            previewBtn.disabled = true;
            previewBtn.innerHTML = '<span class="ed-btn-spinner"></span>';
        } else {
            previewBtn.classList.remove('loading');
            previewBtn.disabled = false;
            previewBtn.innerHTML = originalHTML;
        }
    }

    // --- AUTO-SAVE BEFORE PREVIEW (SIP-3.4) ---
    if (tab.isDirty) {
        setLoading(true);
        window.Terminal.log('Unsaved changes detected. Saving before preview...');
        window.postSaveAction = async () => {
             window.Terminal.log('✓ Changes deployed. Waiting for Salesforce sync (2.5s)...');
             await new Promise(r => setTimeout(r, 2500));
             setLoading(false);
             handleLwcPreview();
        };
        sendToEditor({ type: 'GET_CONTENT', modelId: window.activeTabId });
        return;
    }

    setLoading(true);
    try {
        window.Terminal.log(`🚀 Preparing Preview for ${tab.name}...`);

        // 1. Ensure Host is deployed (One-time setup per org)
        await window.apiClient.ensurePreviewHostDeployed();
        
        // 2. Resolve component name
        // The cache is keyed by Bundle ID, but we need the DeveloperName.
        let bundleId = null;
        let bundleName = null;

        // Find Bundle ID from tab
        // First check if tab has it explicitly
        if (tab.bundleId) {
            bundleId = tab.bundleId;
        } else {
            // Traverse cache to find which bundle contains this file
            for (const bid in window.lwcBundleCache) {
                 if (window.lwcBundleCache[bid].find(f => f.Id === tab.id)) {
                     bundleId = bid;
                     break;
                 }
            }
        }

        if (bundleId) {
            // Correctly look up the DeveloperName from the metadata cache
            // window.metadataCache.LWC contains [{Id, DeveloperName, ...}]
            const bundleRecord = window.metadataCache.LWC.find(b => b.Id === bundleId);
            if (bundleRecord) {
                bundleName = bundleRecord.DeveloperName;
            }
        }

        // Fallback: use tab name (minus extension)
        if (!bundleName && tab.name) {
             bundleName = tab.name.split('.')[0];
        }

        if (!bundleName) {
            throw new Error("Could not resolve LWC bundle name for preview.");
        }

        const previewUrl = window.apiClient.getPreviewUrl(bundleName);
        window.Terminal.success(`✓ Component: ${bundleName}`);
        window.Terminal.log(`🔗 URL: ${previewUrl}`);
        
        // Open in a component-specific named tab so each LWC gets its own preview window.
        const win = window.open(previewUrl, `SF_INTEL_PREVIEW_${bundleName}`);
        if (!win) {
            window.Terminal.warn('Pop-up blocked. Please allow pop-ups for this site.');
        } else {
            // Hard-reload via service worker after navigation commits (~800ms).
            // window.open() navigates to the new t= URL but Salesforce's Aura serves
            // LWC component JS/CSS from cache. bypassCache=true is Ctrl+Shift+R for
            // all subresources, ensuring the deployed LWC changes are visible immediately.
            chrome.runtime.sendMessage({ action: 'hard-reload-preview' });
        }

    } catch (err) {
        console.error('[SF-Intel] Preview failed:', err);
        window.Terminal.error(`Preview Failed: ${err.message}`);
    } finally {
        setLoading(false);
    }
}

/**
 * --- RELEASE NOTES (SIP-3.4) ---
 */
function checkReleaseNotes() {
    // Keep header version badge in sync
    const versionEl = document.getElementById('app-version');
    if (versionEl) versionEl.textContent = `v${CURRENT_VERSION}`;

    const lastVersion = localStorage.getItem('sf-intel-version');
    if (lastVersion !== CURRENT_VERSION) {
        localStorage.setItem('sf-intel-version', CURRENT_VERSION);
        showReleaseNotes();
    }
}

// --- STRUCTURED RELEASE NOTES (SIP-3.4) ---
const RELEASE_NOTES_DATA = {
    version: CURRENT_VERSION,
    title: "What's New in v" + CURRENT_VERSION,
    features: [
        {
            heading: "LWC Live Preview",
            description: "Previewing your components is faster and more reliable. Errors are shown clearly instead of a blank screen."
        },
        {
            heading: "Automation Inspector",
            description: "See exactly what happened inside a Flow — which path was taken, how many times a loop ran, and where it failed. Also flags common mistakes like SOQL inside loops."
        },
        {
            heading: "Diff Viewer",
            description: "Comparing your local code with the org is now more accurate and easier to read."
        },
        {
            heading: "Schema Explorer",
            description: "Fields load faster and SOQL suggestions are more accurate."
        }
    ]
};

function showReleaseNotes() {
    // Create a specialized tab with STRUCTURED DATA
    const tabId = 'release-notes';
    
    if (!window.openTabs.find(t => t.id === tabId)) {
        window.openTabs.push({
            id: tabId,
            name: 'Release Notes',
            type: 'HTML', 
            content: '', // No raw HTML here
            structuredData: RELEASE_NOTES_DATA, // Backend Model
            isDirty: false,
            readOnly: true
        });
    }
    
    renderTabs();
    switchTab(tabId);
}

// Renderer: Converts JSON -> DOM
function renderReleaseNotesDOM(data, container) {
    container.innerHTML = '';
    
    // Container
    const dataContainer = document.createElement('div');
    dataContainer.className = 'release-notes-container';

    // Header
    const header = document.createElement('div');
    header.className = 'rn-header';
    const title = document.createElement('h1');
    title.className = 'rn-title';
    title.textContent = data.title;
    header.appendChild(title);
    dataContainer.appendChild(header);

    // List
    const list = document.createElement('ul');
    list.className = 'rn-feature-list';
    list.style.marginTop = '20px';

    data.features.forEach(feat => {
        const li = document.createElement('li');
        li.className = 'rn-feature-item';

        const contentDiv = document.createElement('div');
        contentDiv.className = 'rn-content';

        const h3 = document.createElement('h3');
        h3.textContent = feat.heading;

        const p = document.createElement('p');
        p.textContent = feat.description;

        contentDiv.appendChild(h3);
        contentDiv.appendChild(p);
        li.appendChild(contentDiv);
        list.appendChild(li);
    });

    dataContainer.appendChild(list);
    container.appendChild(dataContainer);
}
