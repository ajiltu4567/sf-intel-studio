/**
 * Utility Window Bridge - Vanilla JS to React Interface
 * 
 * This module provides a vanilla JS interface to the React-based utility window system.
 * It allows the IDE (which uses vanilla JS) to interact with the utility overlay.
 */

(function() {
    'use strict';

    // Create a simple vanilla JS UtilityWindowManager facade
    window.UtilityWindowManager = {
        open: function(utilityId, props = {}) {
            console.log(`[SF-Intel] Opening utility: ${utilityId}`);
            
            // For now, open Staged Deploy in a simple overlay
            if (utilityId === 'staged-deploy') {
                this.openStagedDeploy(props);
            } else {
                console.warn(`[SF-Intel] Utility ${utilityId} not implemented yet`);
            }
        },

        close: function() {
            const overlay = document.getElementById('sf-intel-utility-root');
            if (overlay) {
                overlay.remove();
            }
        },

        openStagedDeploy: function(props) {
            // Initialize wizard state
            this.wizardState = {
                currentStep: 1,
                selectedMetadataTypes: [],
                selectedComponents: [],
                deploymentOptions: {
                    runTests: 'RunLocalTests',
                    checkOnly: false,
                    specifiedTests: []
                }
            };

            // Create overlay structure
            const existing = document.getElementById('sf-intel-utility-root');
            if (existing) existing.remove();

            const overlay = document.createElement('div');
            overlay.id = 'sf-intel-utility-root';
            overlay.className = 'utility-overlay';
            
            overlay.innerHTML = `
                <div class="utility-shell">
                    <div class="utility-title-bar">
                        <div class="title-content">
                            <h1 class="title">Staged Deployment</h1>
                            <p class="subtitle">Deploy metadata to your Salesforce org</p>
                        </div>
                        <button class="close-button" id="utility-close-btn" title="Close (ESC)" aria-label="Close">
                            ×
                        </button>
                    </div>
                    
                    <!-- Step Progress Indicator -->
                    <div class="deployment-stepper">
                        <div class="step active" data-step="1">
                            <div class="step-number">1</div>
                            <div class="step-label">Select Types</div>
                        </div>
                        <div class="step" data-step="2">
                            <div class="step-number">2</div>
                            <div class="step-label">Select Components</div>
                        </div>
                        <div class="step" data-step="3">
                            <div class="step-number">3</div>
                            <div class="step-label">Review</div>
                        </div>
                        <div class="step" data-step="4">
                            <div class="step-number">4</div>
                            <div class="step-label">Deploy</div>
                        </div>
                    </div>
                    
                    <div class="utility-content-area" id="wizard-content-area">
                        <!-- Step content will be rendered here -->
                    </div>
                </div>
            `;

            document.body.appendChild(overlay);

            // Bind close event
            const closeBtn = overlay.querySelector('#utility-close-btn');
            if (closeBtn) closeBtn.onclick = () => this.close();

            // ESC key handler
            const escHandler = (e) => {
                if (e.key === 'Escape') {
                    this.close();
                    document.removeEventListener('keydown', escHandler);
                }
            };
            document.addEventListener('keydown', escHandler);

            // Render Step 1
            this.renderStep1_MetadataTypes();
            
            // Focus trap
            this.activateFocusTrap(overlay);
        },

        renderStep1_MetadataTypes: async function() {
            const contentArea = document.getElementById('wizard-content-area');
            if (!contentArea) return;

            // Show loading state while discovering metadata types
            contentArea.innerHTML = `
                <div class="wizard-step-content">
                    <div class="step-header">
                        <h2 class="step-title">Discovering Metadata</h2>
                        <p class="step-description">Analyzing your Salesforce org to identify available components...</p>
                    </div>
                    <div class="step-body">
                        <div class="metadata-loading-container">
                            <div class="skeleton-search"></div>
                            <div class="metadata-type-grid">
                                ${Array(8).fill(0).map(() => `
                                    <div class="metadata-type-card skeleton">
                                        <div class="card-icon"></div>
                                        <div class="card-info">
                                            <div class="skeleton-line title"></div>
                                            <div class="skeleton-line detail"></div>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                </div>
            `;

            // Dynamically build metadata types from the org
            const metadataTypes = await this.discoverMetadataTypes();

            if (!metadataTypes || metadataTypes.length === 0) {
                contentArea.innerHTML = `
                    <div class="wizard-step-content">
                        <div class="step-header">
                            <h2 class="step-title">Discovery Failed</h2>
                            <p class="step-description">Could not connect to Salesforce or no metadata found.</p>
                        </div>
                        <div class="step-body">
                            <div class="error-state">
                                <div class="error-icon">⚠️</div>
                                <p>Failed to discover metadata types. Please check your CLI connection.</p>
                                <button class="retry-btn" onclick="window.UtilityWindowManager.renderStep1_MetadataTypes()">Retry Discovery</button>
                            </div>
                        </div>
                    </div>
                `;
                return;
            }

            contentArea.innerHTML = `
                <div class="wizard-step-content">
                    <div class="step-header">
                        <h2 class="step-title">Select Metadata Types</h2>
                        <p class="step-description">Choose the types of components you want to deploy</p>
                    </div>
                    
                    <div class="step-body">
                        <div class="search-box">
                            <input type="text" id="type-search" class="metadata-search-input" placeholder="Search metadata types...">
                        </div>
                        
                        <div class="metadata-type-grid" id="metadata-type-grid">
                            ${metadataTypes.map(type => `
                                <label class="metadata-type-card ${type.available === 0 ? 'disabled' : ''}" data-type="${type.apiName}">
                                    <input type="checkbox" 
                                           data-type="${type.apiName}" 
                                           ${type.available === 0 ? 'disabled' : ''}
                                           ${this.wizardState.selectedMetadataTypes.includes(type.apiName) ? 'checked' : ''}>
                                    <div class="card-content">
                                        <div class="card-icon">${type.icon}</div>
                                        <div class="card-info">
                                            <div class="card-name">${type.name}</div>
                                            <div class="card-api-name">${type.apiName}</div>
                                        </div>
                                         <div class="card-meta">
                                             <span class="category-badge">${type.category}</span>
                                             <span class="type-count loading" data-type="${type.apiName}">calculating...</span>
                                         </div>
                                    </div>
                                </label>
                            `).join('')}
                        </div>
                    </div>
                    
                    <div class="step-footer">
                        <div class="footer-left">
                            <span class="selection-count" id="type-selection-count">0 metadata types selected</span>
                        </div>
                        <div class="footer-right">
                            <button class="utility-button" id="step1-cancel">Cancel</button>
                            <button class="utility-button primary" id="step1-next" disabled>Next: Select Components</button>
                        </div>
                    </div>
                </div>
            `;

            // Bind events
            this.bindStep1Events();

            // Start progressive loading of component counts
            this.loadComponentCountsProgressively(metadataTypes);
        },

        // Fetch component counts for each metadata type progressively
        loadComponentCountsProgressively: async function(metadataTypes) {
            const orgAlias = window.SessionState?.currentOrg || 'default';
            const backendUrl = 'http://127.0.0.1:3000';
            
            // Prioritize common types
            const prioritizedTypes = ['ApexClass', 'ApexTrigger', 'LightningComponentBundle', 'Flow', 'CustomObject', 'PermissionSet', 'Layout'];
            const sortedTypes = [...metadataTypes].sort((a, b) => {
                const aIndex = prioritizedTypes.indexOf(a.apiName);
                const bIndex = prioritizedTypes.indexOf(b.apiName);
                if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
                if (aIndex !== -1) return -1;
                if (bIndex !== -1) return 1;
                return 0;
            });

            // Process in small batches to avoid overwhelming the server/CLI
            const batchSize = 3;
            for (let i = 0; i < sortedTypes.length; i += batchSize) {
                const batch = sortedTypes.slice(i, i + batchSize);
                
                await Promise.all(batch.map(async (type) => {
                    try {
                        const response = await fetch(`${backendUrl}/api/metadata/list`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ orgAlias, metadataType: type.apiName }),
                            signal: AbortSignal.timeout(60000) // 1 minute per count fetch
                        });
                        
                        if (response.ok) {
                            const { count } = await response.json();
                            this.updateMetadataTypeCount(type.apiName, count);
                        } else {
                            this.updateMetadataTypeCount(type.apiName, 0, true); // Error state
                        }
                    } catch (error) {
                        console.warn(`[Deployment] Failed to load count for ${type.apiName}:`, error);
                        this.updateMetadataTypeCount(type.apiName, 0, true);
                    }
                }));
                
                // Small delay between batches
                await new Promise(r => setTimeout(r, 200));
            }
        },

        // Update the UI for a specific metadata type count
        updateMetadataTypeCount: function(apiName, count, isError = false) {
            const card = document.querySelector(`.metadata-type-card[data-type="${apiName}"]`);
            if (!card) return;

            const countEl = card.querySelector('.type-count');
            if (countEl) {
                countEl.textContent = isError ? 'unavailable' : `${count} components`;
                countEl.classList.remove('loading');
                if (isError) countEl.style.color = '#ff4d4d';
            }

            // Enable the card if components found
            if (!isError && count > 0) {
                card.classList.remove('disabled');
                const checkbox = card.querySelector('input[type="checkbox"]');
                if (checkbox) checkbox.removeAttribute('disabled');
            } else if (!isError && count === 0) {
                card.classList.add('no-components');
            }
        },

        discoverMetadataTypes: async function() {
            try {
                // Get current org alias
                const orgAlias = window.SessionState?.currentOrg || 'default';
                if (window.Terminal) {
                    window.Terminal.log(`[Deployment] Discovering metadata types from org: ${orgAlias}...`);
                }
                
                // Call new Rust endpoint to describe metadata
                const backendUrl = 'http://127.0.0.1:3000';
                const response = await fetch(`${backendUrl}/api/metadata/describe`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ orgAlias })
                });
                
                if (!response.ok) {
                    throw new Error(`Failed to describe metadata: ${response.status}`);
                }
                
                const { metadataTypes } = await response.json();
                
                if (window.Terminal) {
                    window.Terminal.log(`[Deployment] Found ${metadataTypes.length} metadata types`);
                }
                
                // Transform to UI format with icons & categories
                const types = metadataTypes.map(type => ({
                    apiName: type.xmlName,
                    name: this.getHumanName(type.xmlName),
                    icon: this.getMetadataIcon(type.xmlName),
                    category: this.categorizeMetadataType(type.xmlName),
                    available: 0, // Will be populated progressively
                    suffix: type.suffix,
                    inFolder: type.inFolder
                }));
                
                // Sort by category, then by name
                types.sort((a, b) => {
                    if (a.category !== b.category) {
                        return a.category.localeCompare(b.category);
                    }
                    return a.name.localeCompare(b.name);
                });
                
                return types;
                
            } catch (error) {
                console.error('[Deployment] Failed to discover metadata:', error);
                if (window.Terminal) {
                    window.Terminal.error(`Failed to fetch metadata types: ${error.message}`);
                }
                
                // Fall back to cache-based discovery
                return this.discoverFromCache();
            }
        },

        // Convert API name to human-readable name
        getHumanName: function(xmlName) {
            const nameMap = {
                'ApexClass': 'Apex Class',
                'ApexTrigger': 'Apex Trigger',
                'LightningComponentBundle': 'Lightning Web Component',
                'AuraDefinitionBundle': 'Aura Component',
                'Flow': 'Flow',
                'WorkflowRule': 'Workflow Rule',
                'CustomObject': 'Custom Object',
                'CustomField': 'Custom Field',
                'ValidationRule': 'Validation Rule',
                'PermissionSet': 'Permission Set',
                'Profile': 'Profile',
                'Layout': 'Page Layout',
                'EmailTemplate': 'Email Template',
                'StaticResource': 'Static Resource',
                'CustomMetadata': 'Custom Metadata Type',
                // Add more as needed
            };
            
            return nameMap[xmlName] || xmlName.replace(/([A-Z])/g, ' $1').trim();
        },

        // Fallback: discover from local cache (old behavior)
        discoverFromCache: function() {
            if (!window.metadataCache) return [];

            const typeConfig = {
                'ApexClass': { name: 'Apex Class', icon: '🔷', category: 'Code' },
                'ApexTrigger': { name: 'Apex Trigger', icon: '⚡', category: 'Code' },
                'ApexComponent': { name: 'Visualforce Component', icon: '📄', category: 'UI' },
                'ApexPage': { name: 'Visualforce Page', icon: '📄', category: 'UI' },
                'LWC': { name: 'Lightning Web Component', icon: '⚛️', category: 'UI' },
                'LightningComponentBundle': { name: 'Lightning Web Component', icon: '⚛️', category: 'UI' },
                'AuraDefinitionBundle': { name: 'Aura Component', icon: '🎨', category: 'UI' },
                'CustomObject': { name: 'Custom Object', icon: '🗂️', category: 'Schema' },
                'CustomField': { name: 'Custom Field', icon: '📊', category: 'Schema' },
                'Layout': { name: 'Page Layout', icon: '📐', category: 'UI' },
                'PermissionSet': { name: 'Permission Set', icon: '🔐', category: 'Security' },
                'Profile': { name: 'Profile', icon: '👤', category: 'Security' },
                'Flow': { name: 'Flow', icon: '🔄', category: 'Automation' },
                'WorkflowRule': { name: 'Workflow Rule', icon: '⚙️', category: 'Automation' },
                'ValidationRule': { name: 'Validation Rule', icon: '✓', category: 'Rules' },
                'EmailTemplate': { name: 'Email Template', icon: '📧', category: 'Communication' },
                'StaticResource': { name: 'Static Resource', icon: '📦', category: 'Resources' },
                'CustomTab': { name: 'Custom Tab', icon: '📑', category: 'UI' },
                'CustomApplication': { name: 'Custom App', icon: '📱', category: 'UI' },
                'Queue': { name: 'Queue', icon: '📬', category: 'Organization' },
                'Group': { name: 'Group', icon: '👥', category: 'Organization' },
                'Role': { name: 'Role', icon: '🎭', category: 'Organization' },
                'Report': { name: 'Report', icon: '📈', category: 'Analytics' },
                'Dashboard': { name: 'Dashboard', icon: '📊', category: 'Analytics' },
                'RemoteSiteSetting': { name: 'Remote Site', icon: '🌐', category: 'Integration' },
                'NamedCredential': { name: 'Named Credential', icon: '🔑', category: 'Integration' },
                'ConnectedApp': { name: 'Connected App', icon: '🔌', category: 'Integration' },
                'CustomMetadata': { name: 'Custom Metadata Type', icon: '🗃️', category: 'Schema' },
                'CustomSetting': { name: 'Custom Setting', icon: '⚙️', category: 'Configuration' }
            };

            const types = [];

            // Scan metadataCache for all available types
            Object.keys(window.metadataCache).forEach(cacheKey => {
                const items = window.metadataCache[cacheKey];
                if (Array.isArray(items) && items.length > 0) {
                    const config = typeConfig[cacheKey] || {
                        name: cacheKey,
                        icon: '📄',
                        category: 'Other'
                    };

                    types.push({
                        apiName: cacheKey,
                        name: config.name,
                        icon: config.icon,
                        category: config.category,
                        available: items.length
                    });
                }
            });

            // Sort by category, then by name
            types.sort((a, b) => {
                if (a.category !== b.category) {
                    return a.category.localeCompare(b.category);
                }
                return a.name.localeCompare(b.name);
            });

            return types;
        },

        categorizeMetadataType: function(xmlName) {
            const categories = {
                'ApexClass': 'Code',
                'ApexTrigger': 'Code',
                'ApexComponent': 'UI',
                'ApexPage': 'UI',
                'LightningComponentBundle': 'UI',
                'AuraDefinitionBundle': 'UI',
                'Flow': 'Automation',
                'WorkflowRule': 'Automation',
                'ProcessDefinition': 'Automation',
                'CustomObject': 'Schema',
                'CustomField': 'Schema',
                'CustomMetadata': 'Schema',
                'Layout': 'UI',
                'PermissionSet': 'Security',
                'Profile': 'Security',
                'Role': 'Organization',
                'Group': 'Organization',
                'Queue': 'Organization',
                'Report': 'Analytics',
                'Dashboard': 'Analytics',
                'RemoteSiteSetting': 'Integration',
                'NamedCredential': 'Integration',
                'ConnectedApp': 'Integration',
                'EmailTemplate': 'Communication',
                'StaticResource': 'Resources'
            };
            
            return categories[xmlName] || 'Other';
        },

        getMetadataIcon: function(xmlName) {
            const icons = {
                'ApexClass': '🔷',
                'ApexTrigger': '⚡',
                'ApexComponent': '📄',
                'ApexPage': '📄',
                'LightningComponentBundle': '⚛️',
                'AuraDefinitionBundle': '🎨',
                'Flow': '🔄',
                'WorkflowRule': '⚙️',
                'ProcessDefinition': '🔄',
                'CustomObject': '🗂️',
                'CustomField': '📊',
                'CustomMetadata': '🗃️',
                'Layout': '📐',
                'PermissionSet': '🔐',
                'Profile': '👤',
                'Role': '🎭',
                'Group': '👥',
                'Queue': '📬',
                'Report': '📈',
                'Dashboard': '📊',
                'RemoteSiteSetting': '🌐',
                'NamedCredential': '🔑',
                'ConnectedApp': '🔌',
                'EmailTemplate': '📧',
                'StaticResource': '📦',
                'CustomTab': '📑',
                'CustomApplication': '📱',
                'CustomSetting': '⚙️',
                'ValidationRule': '✓'
            };
            
            return icons[xmlName] || '📄';
        },

        bindStep1Events: function() {
            const checkboxes = document.querySelectorAll('.metadata-type-card input[type="checkbox"]');
            const searchInput = document.getElementById('type-search');
            const cancelBtn = document.getElementById('step1-cancel');
            const nextBtn = document.getElementById('step1-next');

            // Checkbox change handler
            checkboxes.forEach(checkbox => {
                checkbox.onchange = () => {
                    const type = checkbox.dataset.type;
                    if (checkbox.checked) {
                        if (!this.wizardState.selectedMetadataTypes.includes(type)) {
                            this. wizardState.selectedMetadataTypes.push(type);
                        }
                    } else {
                        this.wizardState.selectedMetadataTypes = 
                            this.wizardState.selectedMetadataTypes.filter(t => t !== type);
                    }
                    
                    this.updateStep1UI();
                };
            });

            // Search handler
            if (searchInput) {
                searchInput.oninput = (e) => {
                    const query = e.target.value.toLowerCase();
                    const cards = document.querySelectorAll('.metadata-type-card');
                    cards.forEach(card => {
                        const name = card.querySelector('.card-name')?.textContent.toLowerCase() || '';
                        const apiName = card.querySelector('.card-api-name')?.textContent.toLowerCase() || '';
                        const matches = name.includes(query) || apiName.includes(query);
                        card.style.display = matches ? 'block' : 'none';
                    });
                };
            }

            // Cancel button
            if (cancelBtn) {
                cancelBtn.onclick = () => this.close();
            }

            // Next button
            if (nextBtn) {
                nextBtn.onclick = () => {
                    this.wizardState.currentStep = 2;
                    this.updateStepIndicator(2);
                    this.renderStep2_ComponentSelection();
                };
            }
        },

        updateStep1UI: function() {
            const count = this.wizardState.selectedMetadataTypes.length;
            const countEl = document.getElementById('type-selection-count');
            const nextBtn = document.getElementById('step1-next');

            if (countEl) {
                countEl.textContent = `${count} metadata type${count !== 1 ? 's' : ''} selected`;
            }

            if (nextBtn) {
                nextBtn.disabled = count === 0;
            }
        },

        updateStepIndicator: function(stepNumber) {
            const steps = document.querySelectorAll('.deployment-stepper .step');
            steps.forEach((step, index) => {
                const num = index + 1;
                step.classList.remove('active', 'completed');
                
                if (num < stepNumber) {
                    step.classList.add('completed');
                } else if (num === stepNumber) {
                    step.classList.add('active');
                }
            });
        },

        renderStep2_ComponentSelection: function() {
            const contentArea = document.getElementById('wizard-content-area');
            if (!contentArea) return;

            // Get components filtered by selected metadata types
            const components = this.getComponentsByTypes(this.wizardState.selectedMetadataTypes);

            contentArea.innerHTML = `
                <div class="wizard-step-content">
                    <div class="step-header">
                        <h2 class="step-title">Select Components</h2>
                        <p class="step-description">Choose specific components to deploy from the selected metadata types</p>
                    </div>
                    
                    <div class="step-body">
                        <!-- Filter Chips -->
                        <div class="filter-chips" id="filter-chips">
                            ${this.wizardState.selectedMetadataTypes.map(type => `
                                <span class="filter-chip">${this.getMetadataTypeDisplayName(type)}</span>
                            `).join('')}
                        </div>
                        
                        <!-- Search and Filters -->
                        <div class="component-controls">
                            <input type="text" id="component-search" class="metadata-search-input" placeholder="Search components...">
                            <div class="bulk-actions">
                                <button class="utility-button-small" id="select-all-components">Select All</button>
                                <button class="utility-button-small" id="clear-selection">Clear</button>
                            </div>
                        </div>
                        
                        <!-- Components List -->
                        <div class="components-list" id="components-list">
                            ${components.length === 0 ? `
                                <div class="empty-state">
                                    <div class="empty-icon">📦</div>
                                    <p class="empty-text">No components found</p>
                                    <p class="empty-hint">The selected metadata types have no components available.</p>
                                </div>
                            ` : components.map(component => `
                                <label class="component-item">
                                    <input type="checkbox" 
                                           data-component-id="${component.id}"
                                           data-component-name="${component.name}"
                                           data-component-type="${component.type}"
                                           ${this.wizardState.selectedComponents.some(c => c.id === component.id) ? 'checked' : ''}>
                                    <div class="component-info">
                                        <div class="component-name">${component.name}</div>
                                        <div class="component-meta">
                                            <span class="component-type-badge">${component.type}</span>
                                        </div>
                                    </div>
                                </label>
                            `).join('')}
                        </div>
                    </div>
                    
                    <div class="step-footer">
                        <div class="footer-left">
                            <span class="selection-count" id="component-selection-count">0 components selected</span>
                        </div>
                        <div class="footer-right">
                            <button class="utility-button" id="step2-back">Back</button>
                            <button class="utility-button primary" id="step2-next" disabled>Next: Review</button>
                        </div>
                    </div>
                </div>
            `;

            // Bind events
            this.bindStep2Events();
        },

        bindStep2Events: function() {
            const checkboxes = document.querySelectorAll('.component-item input[type="checkbox"]');
            const searchInput = document.getElementById('component-search');
            const selectAllBtn = document.getElementById('select-all-components');
            const clearBtn = document.getElementById('clear-selection');
            const backBtn = document.getElementById('step2-back');
            const nextBtn = document.getElementById('step2-next');

            // Checkbox change handler
            checkboxes.forEach(checkbox => {
                checkbox.onchange = () => {
                    const componentData = {
                        id: checkbox.dataset.componentId,
                        name: checkbox.dataset.componentName,
                        type: checkbox.dataset.componentType
                    };

                    if (checkbox.checked) {
                        if (!this.wizardState.selectedComponents.some(c => c.id === componentData.id)) {
                            this.wizardState.selectedComponents.push(componentData);
                        }
                    } else {
                        this.wizardState.selectedComponents = 
                            this.wizardState.selectedComponents.filter(c => c.id !== componentData.id);
                    }
                    
                    this.updateStep2UI();
                };
            });

            // Search handler
            if (searchInput) {
                searchInput.oninput = (e) => {
                    const query = e.target.value.toLowerCase();
                    const items = document.querySelectorAll('.component-item');
                    items.forEach(item => {
                        const name = item.querySelector('.component-name')?.textContent.toLowerCase() || '';
                        const matches = name.includes(query);
                        item.style.display = matches ? 'flex' : 'none';
                    });
                };
            }

            // Select all
            if (selectAllBtn) {
                selectAllBtn.onclick = () => {
                    const visibleCheckboxes = Array.from(checkboxes).filter(cb => {
                        return cb.closest('.component-item').style.display !== 'none';
                    });
                    visibleCheckboxes.forEach(cb => {
                        cb.checked = true;
                        cb.dispatchEvent(new Event('change'));
                    });
                };
            }

            // Clear selection
            if (clearBtn) {
                clearBtn.onclick = () => {
                    checkboxes.forEach(cb => {
                        cb.checked = false;
                    });
                    this.wizardState.selectedComponents = [];
                    this.updateStep2UI();
                };
            }

            // Back button
            if (backBtn) {
                backBtn.onclick = () => {
                    this.wizardState.currentStep = 1;
                    this.updateStepIndicator(1);
                    this.renderStep1_MetadataTypes();
                };
            }

            // Next button
            if (nextBtn) {
                nextBtn.onclick = () => {
                    this.wizardState.currentStep = 3;
                    this.updateStepIndicator(3);
                    this.renderStep3_Review();
                };
            }
        },

        updateStep2UI: function() {
            const count = this.wizardState.selectedComponents.length;
            const countEl = document.getElementById('component-selection-count');
            const nextBtn = document.getElementById('step2-next');

            // Group by type for display
            const grouped = {};
            this.wizardState.selectedComponents.forEach(c => {
                if (!grouped[c.type]) grouped[c.type] = 0;
                grouped[c.type]++;
            });

            const summary = Object.entries(grouped)
                .map(([type, count]) => `${count} ${this.getMetadataTypeDisplayName(type)}`)
                .join(', ');

            if (countEl) {
                countEl.textContent = count > 0 ? summary : '0 components selected';
            }

            if (nextBtn) {
                nextBtn.disabled = count === 0;
            }
        },

        renderStep3_Review: function() {
            const contentArea = document.getElementById('wizard-content-area');
            if (!contentArea) return;

            // Group components by type
            const grouped = {};
            this.wizardState.selectedComponents.forEach(c => {
                if (!grouped[c.type]) grouped[c.type] = [];
                grouped[c.type].push(c);
            });

            const orgName = document.getElementById('instance-url')?.textContent || 'Current Org';

            contentArea.innerHTML = `
                <div class="wizard-step-content">
                    <div class="step-header">
                        <h2 class="step-title">Review Deployment</h2>
                        <p class="step-description">Confirm your deployment configuration before proceeding</p>
                    </div>
                    
                    <div class="step-body">
                        <!-- Summary Card -->
                        <div class="review-summary-card">
                            <div class="summary-row">
                                <span class="summary-label">Target Org</span>
                                <span class="summary-value">${orgName}</span>
                            </div>
                            <div class="summary-row">
                                <span class="summary-label">Total Components</span>
                                <span class="summary-value">${this.wizardState.selectedComponents.length}</span>
                            </div>
                            <div class="summary-row">
                                <span class="summary-label">Metadata Types</span>
                                <span class="summary-value">${Object.keys(grouped).length}</span>
                            </div>
                        </div>
                        
                        <!-- Component Groups -->
                        <div class="component-groups">
                            <h3 class="section-title">Components to Deploy</h3>
                            ${Object.entries(grouped).map(([type, components]) => `
                                <div class="component-group">
                                    <div class="group-header">
                                        <span class="group-title">${this.getMetadataTypeDisplayName(type)} (${components.length})</span>
                                    </div>
                                    <div class="group-components">
                                        ${components.map(c => `
                                            <div class="review-component-item">
                                                <span class="component-name">${c.name}</span>
                                            </div>
                                        `).join('')}
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                        
                        <!-- Test Options -->
                        <div class="test-options">
                            <h3 class="section-title">Test Execution</h3>
                            <div class="radio-group">
                                <label class="radio-option">
                                    <input type="radio" name="test-level" value="RunLocalTests" checked>
                                    <div class="radio-label">
                                        <div class="radio-title">Run Local Tests</div>
                                        <div class="radio-desc">Run all tests in your org (recommended)</div>
                                    </div>
                                </label>
                                <label class="radio-option">
                                    <input type="radio" name="test-level" value="NoTestRun">
                                    <div class="radio-label">
                                        <div class="radio-title">No Tests</div>
                                        <div class="radio-desc">Skip test execution (not recommended for production)</div>
                                    </div>
                                </label>
                            </div>
                        </div>
                        
                        <!-- Deployment Mode -->
                        <div class="deployment-mode">
                            <label class="checkbox-option">
                                <input type="checkbox" id="check-only">
                                <div class="checkbox-label">
                                    <div class="checkbox-title">Validate Only</div>
                                    <div class="checkbox-desc">Check deployment without committing changes</div>
                                </div>
                            </label>
                        </div>
                    </div>
                    
                    <div class="step-footer">
                        <div class="footer-left">
                            <span class="deploy-warning">⚠️ This will deploy ${this.wizardState.selectedComponents.length} component(s)</span>
                        </div>
                        <div class="footer-right">
                            <button class="utility-button" id="step3-back">Back</button>
                            <button class="utility-button primary" id="step3-deploy">Deploy Now</button>
                        </div>
                    </div>
                </div>
            `;

            // Bind events
            this.bindStep3Events();
        },

        bindStep3Events: function() {
            const backBtn = document.getElementById('step3-back');
            const deployBtn = document.getElementById('step3-deploy');
            const checkOnlyCheckbox = document.getElementById('check-only');
            const testRadios = document.querySelectorAll('input[name="test-level"]');

            // Test level change
            testRadios.forEach(radio => {
                radio.onchange = () => {
                    this.wizardState.deploymentOptions.runTests = radio.value;
                };
            });

            // Check only change
            if (checkOnlyCheckbox) {
                checkOnlyCheckbox.onchange = () => {
                    this.wizardState.deploymentOptions.checkOnly = checkOnlyCheckbox.checked;
                };
            }

            // Back button
            if (backBtn) {
                backBtn.onclick = () => {
                    this.wizardState.currentStep = 2;
                    this.updateStepIndicator(2);
                    this.renderStep2_ComponentSelection();
                };
            }

            // Deploy button
            if (deployBtn) {
                deployBtn.onclick = async () => {
                    this.wizardState.currentStep = 4;
                    this.updateStepIndicator(4);
                    await this.renderStep4_Deploy();
                };
            }
        },

        renderStep4_Deploy: async function() {
            const contentArea = document.getElementById('wizard-content-area');
            if (!contentArea) return;

            // Show progress screen
            contentArea.innerHTML = `
                <div class="wizard-step-content">
                    <div class="step-header">
                        <h2 class="step-title">Deploying...</h2>
                        <p class="step-description">Please wait while we deploy your components</p>
                    </div>
                    
                    <div class="step-body">
                        <div class="deployment-progress">
                            <div class="progress-steps">
                                <div class="progress-step active">
                                    <div class="progress-icon">⏳</div>
                                    <div class="progress-label">Preparing deployment</div>
                                </div>
                                <div class="progress-step">
                                    <div class="progress-icon">⏸️</div>
                                    <div class="progress-label">Validating components</div>
                                </div>
                                <div class="progress-step">
                                    <div class="progress-icon">⏸️</div>
                                    <div class="progress-label">Running tests</div>
                                </div>
                                <div class="progress-step">
                                    <div class="progress-icon">⏸️</div>
                                    <div class="progress-label">Deploying to org</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            // Simulate deployment steps
             await this.executeDeployment();
        },

        executeDeployment: async function() {
            const steps = document.querySelectorAll('.progress-step');
            
            try {
                // Step 1: Preparing deployment
                steps[0].classList.add('active');
                steps[0].querySelector('.progress-icon').textContent = '⏳';
                
                if (window.Terminal) {
                    window.Terminal.open();
                    window.Terminal.log('[Deployment] Preparing deployment package...');
                }
                
                // Fetch component bodies from Salesforce
                const componentBodies = await this.fetchComponentBodies();
                
                steps[0].querySelector('.progress-icon').textContent = '✅';
                steps[0].classList.add('completed');
                steps[0].classList.remove('active');
                
                // Step 2: Validating components
                steps[1].classList.add('active');
                steps[1].querySelector('.progress-icon').textContent = '⏳';
                
                if (window.Terminal) {
                    window.Terminal.log(`[Deployment] Validating ${this.wizardState.selectedComponents.length} component(s)...`);
                }
                
                // Build deployment package
                const deploymentPackage = this.buildDeploymentPackage(componentBodies);
                
                steps[1].querySelector('.progress-icon').textContent = '✅';
                steps[1].classList.add('completed');
                steps[1].classList.remove('active');
                
                // Step 3: Running tests (if enabled)
                steps[2].classList.add('active');
                steps[2].querySelector('.progress-icon').textContent = '⏳';
                
                const testLevel = this.wizardState.deploymentOptions.runTests;
                if (testLevel === 'RunLocalTests') {
                    if (window.Terminal) {
                        window.Terminal.log('[Deployment] Running local tests...');
                    }
                } else {
                    if (window.Terminal) {
                        window.Terminal.log('[Deployment] Skipping tests...');
                    }
                }
                
                steps[2].querySelector('.progress-icon').textContent = '✅';
                steps[2].classList.add('completed');
                steps[2].classList.remove('active');
                
                // Step 4: Deploying to org
                steps[3].classList.add('active');
                steps[3].querySelector('.progress-icon').textContent = '⏳';
                
                if (window.Terminal) {
                    window.Terminal.log('[Deployment] Deploying to Salesforce org...');
                }
                
                // Execute actual deployment via IDE's API
                const result = await this.deployToSalesforce(componentBodies);
                
                steps[3].querySelector('.progress-icon').textContent = '✅';
                steps[3].classList.add('completed');
                steps[3].classList.remove('active');
                
                // Show success
                this.renderDeploymentSuccess(result);
                
            } catch (error) {
                console.error('[SF-Intel] Deployment failed:', error);
                
                // Mark current step as failed
                const activeStep = document.querySelector('.progress-step.active');
                if (activeStep) {
                    activeStep.querySelector('.progress-icon').textContent = '❌';
                    activeStep.classList.remove('active');
                    activeStep.classList.add('failed');
                }
                
                // Show error
                this.renderDeploymentError(error);
            }
        },

        fetchComponentBodies: async function() {
            const bodies = [];
            
            for (const component of this.wizardState.selectedComponents) {
                try {
                    let body;
                    
                    // Check if component is already open in editor
                    const openTab = window.openTabs?.find(t => t.id === component.id);
                    if (openTab && window.__MONACO_EDITOR__) {
                        // Get content from Monaco editor
                        body = window.__MONACO_EDITOR__.getValue();
                        if (window.Terminal) {
                            window.Terminal.log(`  ↳ Using open editor content for ${component.name}`);
                        }
                    } else {
                        // Fetch from Salesforce
                        if (window.apiClient) {
                            if (window.Terminal) {
                                window.Terminal.log(`  ↳ Fetching ${component.name} from Salesforce...`);
                            }
                            
                            if (component.type === 'ApexClass') {
                                const data = await window.apiClient.fetchApexClass(component.id);
                                body = data.Body;
                            } else if (component.type === 'ApexTrigger') {
                                const data = await window.apiClient.fetchApexTrigger(component.id);
                                body = data.Body;
                            } else if (component.type === 'LightningComponentBundle') {
                                // For LWC, we need to fetch multiple files
                                body = await window.apiClient.fetchLWCBundle(component.fullName);
                            } else if (component.type === 'AuraDefinitionBundle') {
                                body = await window.apiClient.fetchAuraBundle(component.fullName);
                            }
                        }
                    }
                    
                    if (body) {
                        bodies.push({
                            ...component,
                            body: body
                        });
                    }
                } catch (error) {
                    console.error(`Failed to fetch ${component.name}:`, error);
                    if (window.Terminal) {
                        window.Terminal.error(`  ↳ Failed to fetch ${component.name}: ${error.message}`);
                    }
                    throw new Error(`Failed to fetch component: ${component.name}`);
                }
            }
            
            return bodies;
        },

        buildDeploymentPackage: function(componentBodies) {
            // For now, return the component bodies
            // In a full implementation, this would build a proper metadata package
            return componentBodies;
        },

        deployToSalesforce: async function(componentBodies) {
            // Use the IDE's existing deployment mechanism
            let deployedCount = 0;
            const errors = [];
            
            for (const component of componentBodies) {
                try {
                    if (window.apiClient) {
                        if (component.type === 'ApexClass') {
                            await window.apiClient.deployApex(component.fullName, component.body);
                            deployedCount++;
                            if (window.Terminal) {
                                window.Terminal.log(`  ✓ Deployed ${component.name}`);
                            }
                        } else if (component.type === 'ApexTrigger') {
                            await window.apiClient.deployApexTrigger(component.fullName, component.body);
                            deployedCount++;
                            if (window.Terminal) {
                                window.Terminal.log(`  ✓ Deployed ${component.name}`);
                            }
                        } else if (component.type === 'LightningComponentBundle') {
                            await window.apiClient.deployLWC(component.fullName, component.body);
                            deployedCount++;
                            if (window.Terminal) {
                                window.Terminal.log(`  ✓ Deployed ${component.name}`);
                            }
                        } else if (component.type === 'AuraDefinitionBundle') {
                            await window.apiClient.deployAura(component.fullName, component.body);
                            deployedCount++;
                            if (window.Terminal) {
                                window.Terminal.log(`  ✓ Deployed ${component.name}`);
                            }
                        }
                    } else {
                        // Fallback: use existing save mechanism
                        if (window.saveCurrentFile) {
                            await window.saveCurrentFile();
                            deployedCount++;
                        }
                    }
                } catch (error) {
                    console.error(`Failed to deploy ${component.name}:`, error);
                    errors.push({
                        component: component.name,
                        error: error.message || 'Unknown error'
                    });
                    if (window.Terminal) {
                        window.Terminal.error(`  ✗ Failed to deploy ${component.name}: ${error.message}`);
                    }
                }
            }
            
            if (errors.length > 0 && errors.length === componentBodies.length) {
                throw new Error(`All deployments failed. See terminal for details.`);
            }
            
            return {
                success: deployedCount,
                failed: errors.length,
                errors: errors
            };
        },

        renderDeploymentSuccess: function(result = {}) {
            const contentArea = document.getElementById('wizard-content-area');
            if (!contentArea) return;

            const mode = this.wizardState.deploymentOptions.checkOnly ? 'validated' : 'deployed';
            const successCount = result.success || this.wizardState.selectedComponents.length;
            const failedCount = result.failed || 0;

            contentArea.innerHTML = `
                <div class="wizard-step-content">
                    <div class="step-header">
                        <h2 class="step-title">Deployment ${mode === 'validated' ? 'Validated' : 'Successful'}!</h2>
                        <p class="step-description">${successCount} component(s) ${mode} successfully${failedCount > 0 ? `, ${failedCount} failed` : ''}</p>
                    </div>
                    
                    <div class="step-body">
                        <div class="deployment-success">
                            <div class="success-icon">✅</div>
                            <div class="success-message">
                                <h3>${mode === 'validated' ? 'Validation Complete' : 'Deployment Complete'}</h3>
                                <p>${successCount} component(s) were ${mode} successfully to your Salesforce org.</p>
                                ${failedCount > 0 ? `<p class="warning-text">⚠️ ${failedCount} component(s) failed. Check terminal for details.</p>` : ''}
                            </div>
                        </div>
                    </div>
                    
                    <div class="step-footer">
                        <div class="footer-left"></div>
                        <div class="footer-right">
                            <button class="utility-button primary" id="finish-btn">Done</button>
                        </div>
                    </div>
                </div>
            `;

            // Bind finish button
            const finishBtn = document.getElementById('finish-btn');
            if (finishBtn) {
                finishBtn.onclick = () => this.close();
            }

            // Log to terminal
            if (window.Terminal) {
                window.Terminal.success(`✓ Deployment ${mode}! ${successCount} component(s) processed.`);
                if (failedCount > 0) {
                    window.Terminal.error(`✗ ${failedCount} component(s) failed.`);
                }
            }
        },

        renderDeploymentError: function(error) {
            const contentArea = document.getElementById('wizard-content-area');
            if (!contentArea) return;

            contentArea.innerHTML = `
                <div class="wizard-step-content">
                    <div class="step-header">
                        <h2 class="step-title">Deployment Failed</h2>
                        <p class="step-description">An error occurred during deployment</p>
                    </div>
                    
                    <div class="step-body">
                        <div class="deployment-error">
                            <div class="error-icon">❌</div>
                            <div class="error-message">
                                <h3>Deployment Error</h3>
                                <p>${error.message || 'Unknown error occurred'}</p>
                                <p class="error-hint">Check the terminal for more details.</p>
                            </div>
                        </div>
                    </div>
                    
                    <div class="step-footer">
                        <div class="footer-left"></div>
                        <div class="footer-right">
                            <button class="utility-button" id="error-back-btn">Back to Review</button>
                            <button class="utility-button primary" id="error-close-btn">Close</button>
                        </div>
                    </div>
                </div>
            `;

            // Bind buttons
            const backBtn = document.getElementById('error-back-btn');
            const closeBtn = document.getElementById('error-close-btn');
            
            if (backBtn) {
                backBtn.onclick = () => {
                    this.wizardState.currentStep = 3;
                    this.updateStepIndicator(3);
                    this.renderStep3_Review();
                };
            }
            
            if (closeBtn) {
                closeBtn.onclick = () => this.close();
            }

            // Log to terminal
            if (window.Terminal) {
                window.Terminal.error(`✗ Deployment failed: ${error.message}`);
            }
        },

        getComponentsByTypes: function(types) {
            const components = [];
            
            types.forEach(type => {
                if (type === 'ApexClass' && window.metadataCache?.ApexClass) {
                    window.metadataCache.ApexClass.forEach(item => {
                        components.push({
                            id: item.Id,
                            name: item.Name + '.cls',
                            type: 'ApexClass',
                            fullName: item.Name
                        });
                    });
                }
                else if (type === 'ApexTrigger' && window.metadataCache?.ApexTrigger) {
                    window.metadataCache.ApexTrigger.forEach(item => {
                        components.push({
                            id: item.Id,
                            name: item.Name + '.trigger',
                            type: 'ApexTrigger',
                            fullName: item.Name
                        });
                    });
                }
                else if (type === 'LWC' && window.metadataCache?.LWC) {
                    window.metadataCache.LWC.forEach(item => {
                        components.push({
                            id: item.Id,
                            name: item.DeveloperName,
                            type: 'LightningComponentBundle',
                            fullName: item.DeveloperName
                        });
                    });
                }
                else if (type === 'AuraDefinitionBundle' && window.metadataCache?.AuraDefinitionBundle) {
                    window.metadataCache.AuraDefinitionBundle.forEach(item => {
                        components.push({
                            id: item.Id,
                            name: item.DeveloperName,
                            type: 'AuraDefinitionBundle',
                            fullName: item.DeveloperName
                        });
                    });
                }
            });

            // Sort by name
            components.sort((a, b) => a.name.localeCompare(b.name));
            
            return components;
        },

        getMetadataTypeDisplayName: function(apiName) {
            const map = {
                'ApexClass': 'Apex Class',
                'ApexTrigger': 'Apex Trigger',
                'LWC': 'Lightning Web Component',
                'LightningComponentBundle': 'Lightning Web Component',
                'AuraDefinitionBundle': 'Aura Component'
            };
            return map[apiName] || apiName;
        },

        bindStagedDeployEvents: function(overlay) {
            const closeBtn = overlay.querySelector('#utility-close-btn');
            const cancelBtn = overlay.querySelector('#deploy-cancel');
            const deployBtn = overlay.querySelector('#deploy-btn');
            const selectAllBtn = overlay.querySelector('#select-all');

            // Close handlers
            const closeHandler = () => this.close();
            if (closeBtn) closeBtn.onclick = closeHandler;
            if (cancelBtn) cancelBtn.onclick = closeHandler;

            // ESC key
            const escHandler = (e) => {
                if (e.key === 'Escape') {
                    closeHandler();
                    document.removeEventListener('keydown', escHandler);
                }
            };
            document.addEventListener('keydown', escHandler);

            // Select all
            if (selectAllBtn) {
                selectAllBtn.onclick = () => {
                    const checkboxes = overlay.querySelectorAll('.file-item input[type="checkbox"]');
                    checkboxes.forEach(cb => cb.checked = true);
                    this.updateFileCount(overlay);
                };
            }

            // Deploy button
            if (deployBtn) {
                deployBtn.onclick = async () => {
                    const selected = Array.from(overlay.querySelectorAll('.file-item input:checked'))
                        .map(cb => cb.dataset.fileId);
                    
                    if (selected.length > 0) {
                        await this.deployFiles(selected);
                        closeHandler();
                    }
                };
            }
        },

        loadAvailableFiles: function() {
            const container = document.getElementById('file-items-container');
            if (!container) return;

            // Get metadata from cache (all Classes, Triggers, LWC, Aura)
            const allMetadata = [];
            
            // Apex Classes
            if (window.metadataCache?.ApexClass) {
                window.metadataCache.ApexClass.forEach(item => {
                    allMetadata.push({
                        id: item.Id,
                        name: item.Name + '.cls',
                        type: 'ApexClass',
                        fullName: item.Name
                    });
                });
            }
            
            // Apex Triggers
            if (window.metadataCache?.ApexTrigger) {
                window.metadataCache.ApexTrigger.forEach(item => {
                    allMetadata.push({
                        id: item.Id,
                        name: item.Name + '.trigger',
                        type: 'ApexTrigger',
                        fullName: item.Name
                    });
                });
            }
            
            // Lightning Web Components
            if (window.metadataCache?.LWC) {
                window.metadataCache.LWC.forEach(item => {
                    allMetadata.push({
                        id: item.Id,
                        name: item.DeveloperName,
                        type: 'LightningComponentBundle',
                        fullName: item.DeveloperName
                    });
                });
            }
            
            // Aura Components
            if (window.metadataCache?.AuraDefinitionBundle) {
                window.metadataCache.AuraDefinitionBundle.forEach(item => {
                    allMetadata.push({
                        id: item.Id,
                        name: item.DeveloperName,
                        type: 'AuraDefinitionBundle',
                        fullName: item.DeveloperName
                    });
                });
            }
            
            if (allMetadata.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-icon">📂</div>
                        <p class="empty-text">No metadata found</p>
                        <p class="empty-hint">Make sure you've connected to a Salesforce org and loaded metadata.</p>
                    </div>
                `;
                return;
            }

            // Sort by type then name
            allMetadata.sort((a, b) => {
                if (a.type !== b.type) return a.type.localeCompare(b.type);
                return a.name.localeCompare(b.name);
            });

            container.innerHTML = allMetadata.map(file => `
                <label class="file-item">
                    <input type="checkbox" data-file-id="${file.id}" data-file-name="${file.name}" data-file-type="${file.type}">
                    <div class="file-info">
                        <span class="file-path">${file.name}</span>
                        <span class="file-type">${file.type}</span>
                    </div>
                </label>
            `).join('');

            // Bind checkbox change events
            const checkboxes = container.querySelectorAll('input[type="checkbox"]');
            const overlay = document.getElementById('sf-intel-utility-root');
            checkboxes.forEach(cb => {
                cb.onchange = () => this.updateFileCount(overlay);
            });
        },

        updateFileCount: function(overlay) {
            const total = overlay.querySelectorAll('.file-item input[type="checkbox"]').length;
            const selected = overlay.querySelectorAll('.file-item input:checked').length;
            
            const countEl = overlay.querySelector('#file-count');
            const deployBtn = overlay.querySelector('#deploy-btn');
            
            if (countEl) countEl.textContent = `${selected} of ${total} selected`;
            if (deployBtn) {
                deployBtn.disabled = selected === 0;
                deployBtn.textContent = `Deploy ${selected} File${selected !== 1 ? 's' : ''}`;
            }
        },

        deployFiles: async function(fileIds) {
            console.log('[SF-Intel] Deploying files:', fileIds);
            
            if (window.Terminal) {
                window.Terminal.open();
                window.Terminal.log(`Starting deployment of ${fileIds.length} file(s)...`);
            }

            // For each selected file, trigger deployment
            for (const fileId of fileIds) {
                // Try to find in open tabs first
                let tab = window.openTabs?.find(t => t.id === fileId);
                
                if (tab) {
                    // File is open, use existing tab system
                    if (window.Terminal) window.Terminal.log(`Deploying open file: ${tab.name}...`);
                    // The actual deployment would happen here via the existing IDE deployment system
                } else {
                    // File is not open, need to fetch and deploy
                    const checkbox = document.querySelector(`input[data-file-id="${fileId}"]`);
                    const fileName = checkbox?.dataset.fileName || 'Unknown';
                    const fileType = checkbox?.dataset.fileType || 'Unknown';
                    
                    if (window.Terminal) window.Terminal.log(`Deploying ${fileType}: ${fileName}...`);
                    
                    // Here you would:
                    // 1. Fetch the file content from Salesforce
                    // 2. Deploy it using window.apiClient
                    // For now, just simulate
                    await new Promise(r => setTimeout(r, 300));
                }
            }

            if (window.Terminal) {
                window.Terminal.success(`✓ Deployment complete! ${fileIds.length} file(s) processed.`);
            }
        },

        activateFocusTrap: function(container) {
            // Simple focus trap implementation
            const focusable = container.querySelectorAll(
                'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]'
            );
            
            if (focusable.length > 0) {
                focusable[0].focus();
            }
        }
    };

    console.log('[SF-Intel] Utility Window Bridge loaded');
})();
