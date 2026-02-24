/**
 * SF-Intel Studio - Workflow Emulator Module (v3.2.0)
 * Uses a Deterministic Observation Model (Snapshot-Wait-Diff).
 * Support for expanded observation: Source, Related, and Specific Records.
 */

const WorkflowEmulator = {
    sourceRecordId: null,
    sourceObject: null,
    sourceDescribe: null,
    watchTargets: [], // List of WatchTarget { type, objectApiName, recordId, recordName, relationshipPath, fields }
    savedState: null,
    objectNames: [],
    childDescribes: {},

    async render() {
        const container = document.getElementById('utility-view-container');
        if (!container) return;

        if (this.savedState) {
            container.innerHTML = this.savedState;
            container.style.display = 'flex';
            this.bindEvents();
            return;
        }

        container.style.display = 'flex';
        container.innerHTML = `
            <div class="workflow-emulator-wrapper" style="display: flex; flex-direction: column; height: 100%; width: 100%;">
                <!-- STEP 1: SOURCE RECORD -->
                <div class="emulator-panel source-selection" style="padding: 16px; border-bottom: 1px solid rgba(255,255,255,0.05); background: rgba(0,0,0,0.1);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <div class="section-badge" style="font-size: 10px; color: var(--accent-color); font-weight: 700; letter-spacing: 1px;">GENERATE INPUT (SOURCE)</div>
                            <span style="background: var(--accent-color); color: #000; font-size: 9px; font-weight: 900; padding: 2px 6px; border-radius: 4px; letter-spacing: 0.5px;">V3.2.0 BETA 6</span>
                        </div>
                        <button class="sf-btn secondary small" id="emulator-clear-btn" style="padding: 4px 8px; font-size: 10px; min-width: auto;">CLEAR</button>
                    </div>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <div style="position: relative; flex: 1;">
                            <input type="text" id="emulator-obj-input" placeholder="Object (e.g. Account)" style="width: 100%; padding: 6px 10px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; color: white;" autocomplete="off">
                            <div id="emulator-obj-results" class="search-dropdown" style="display: none;"></div>
                        </div>
                        <div style="flex: 2.5; position: relative;">
                            <input type="text" id="emulator-id-input" placeholder="🔍 Search Source Record..." style="width: 100%; padding: 6px 10px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; color: white;" autocomplete="off">
                            <div id="emulator-search-results" class="search-dropdown" style="display: none;"></div>
                        </div>
                    </div>
                    <div id="emulator-recent-records" style="display: none; margin-top: 12px; gap: 8px; flex-wrap: wrap;"></div>
                </div>

                <!-- STEP 2: TRIGGER CHANGE -->
                <div id="emulator-trigger-config" class="emulator-panel" style="padding: 16px; border-bottom: 1px solid rgba(255,255,255,0.05); display: none;">
                    <div class="section-badge" style="font-size: 10px; color: #ff9f43; font-weight: 700; margin-bottom: 12px; letter-spacing: 1px;">TRIGGER FIELD CHANGE</div>
                    <div style="display: flex; gap: 12px; align-items: center; background: rgba(255,159,67,0.05); padding: 12px; border: 1px solid rgba(255,159,67,0.1); border-radius: 4px;">
                        <div style="flex: 1;">
                            <label style="display: block; font-size: 11px; color: #888; margin-bottom: 4px;">FIELD</label>
                            <select id="emulator-field-select" style="width: 100%; padding: 6px; background: #1e1e1e; border: 1px solid #333; color: white; border-radius: 4px;"></select>
                        </div>
                        <div style="flex: 1;">
                            <label style="display: block; font-size: 11px; color: #888; margin-bottom: 4px;">NEW VALUE</label>
                            <div id="emulator-value-input-container">
                                <input type="text" id="emulator-value-input" style="width: 100%; padding: 6px; background: #1e1e1e; border: 1px solid #333; color: white; border-radius: 4px;">
                            </div>
                        </div>
                        <button id="emulator-simulate-btn" class="sf-btn primary small" style="background: #ff9f43; border-color: #ff9f43; margin-top: 16px;">RUN SIMULATION (3s)</button>
                    </div>
                </div>

                <!-- STEP 3: FIELDS TO WATCH (OBSERVATION) -->
                <div id="emulator-watch-config" class="emulator-panel" style="padding: 16px; border-bottom: 1px solid rgba(255,255,255,0.05); display: none; background: rgba(0,0,0,0.05);">
                    <div style="display: flex; justify-content: space-between; align-items: baseline;">
                        <div class="section-badge" style="font-size: 10px; color: var(--accent-color); font-weight: 700; margin-bottom: 4px; letter-spacing: 1px;">FIELDS TO WATCH (OBSERVATION)</div>
                        <button class="sf-btn link small" id="add-watch-target-btn" style="color: var(--accent-color); font-size: 10px;">+ Add Watch Target</button>
                    </div>
                    <div style="font-size: 10px; color: #666; margin-bottom: 12px;">Only these fields will be monitored after the change.</div>
                    
                    <div id="watch-targets-list" style="display: flex; flex-direction: column; gap: 12px;">
                        <!-- Watch targets will be rendered here -->
                    </div>
                </div>

                <!-- STEP 4: RESULT VIEW -->
                <div id="emulator-impact-view" style="flex: 1; overflow-y: auto; padding: 16px; display: none;">
                    <div class="section-badge" style="font-size: 10px; color: #2ecc71; font-weight: 700; margin-bottom: 12px; letter-spacing: 1px;">🔍 OBSERVATION RESULTS</div>
                    <div id="impact-results-container"></div>
                    <div style="margin-top: 24px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.05); font-size: 10px; color: #555;">
                        ⚠️ Only fields selected under "Fields to Watch" are evaluated. Other changes are intentionally ignored to ensure auditability.
                    </div>
                </div>

                <!-- INITIAL EMPTY STATE -->
                <div id="emulator-empty" style="flex: 1; display: flex; align-items: center; justify-content: center; color: #444; flex-direction: column;">
                    <div style="font-size: 48px; margin-bottom: 16px;">🔍</div>
                    <div style="font-size: 14px; font-weight: 500;">Deterministic Workflow Emulator</div>
                    <div style="font-size: 12px;">Select a source record to start explicit observation.</div>
                </div>
            </div>
        `;

        this.bindEvents();
        this.prefetchObjectNames();
    },

    bindEvents() {
        const objInput = document.getElementById('emulator-obj-input');
        const searchInput = document.getElementById('emulator-id-input');
        const container = document.getElementById('utility-view-container');

        if (objInput) {
            objInput.addEventListener('input', (e) => this.handleObjectInput(e.target.value));
            objInput.addEventListener('change', () => this.handleObjectChange());
        }

        if (searchInput) {
            searchInput.addEventListener('input', (e) => this.handleSearchInput(e.target.value));
        }

        const simulateBtn = document.getElementById('emulator-simulate-btn');
        if (simulateBtn) simulateBtn.onclick = () => this.handleSimulate();

        const addWatchBtn = document.getElementById('add-watch-target-btn');
        if (addWatchBtn) addWatchBtn.onclick = () => this.addWatchTarget();

        const clearBtn = document.getElementById('emulator-clear-btn');
        if (clearBtn) clearBtn.onclick = () => this.clear();

        const searchResults = document.getElementById('emulator-search-results');
        if (searchResults) {
            searchResults.onclick = (e) => {
                const item = e.target.closest('.search-item');
                if (item) this.selectRecord(item.dataset.id, item.dataset.name);
            };
        }

        const objResults = document.getElementById('emulator-obj-results');
        if (objResults) {
            objResults.onclick = (e) => {
                const item = e.target.closest('.search-item');
                if (item) this.selectObject(item.dataset.name);
            };
        }

        const watchList = document.getElementById('watch-targets-list');
        if (watchList) {
            watchList.onclick = (e) => {
                const removeBtn = e.target.closest('.remove-watch-btn');
                if (removeBtn) {
                    this.removeWatchTarget(parseInt(removeBtn.dataset.idx));
                }
                const searchItem = e.target.closest('.search-item');
                if (searchItem) {
                    const targetIdx = parseInt(searchItem.closest('.search-dropdown-wrapper').dataset.targetIdx);
                    if (searchItem.dataset.id) {
                        this.selectWatchRecord(targetIdx, searchItem.dataset.id, searchItem.dataset.name);
                    } else if (searchItem.dataset.name) {
                        this.selectWatchObject(targetIdx, searchItem.dataset.name);
                    }
                }
            };
            watchList.onchange = (e) => {
                const checkbox = e.target.closest('.field-watch-checkbox');
                if (checkbox) {
                    this.toggleFieldWatch(parseInt(checkbox.dataset.targetIdx), checkbox.dataset.fieldName);
                }
                const select = e.target.closest('.watch-target-type-select');
                if (select) {
                    this.updateWatchTargetType(parseInt(select.dataset.idx), select.value);
                }
                const relSelect = e.target.closest('.watch-rel-select');
                if (relSelect) {
                    this.updateWatchTargetRel(parseInt(relSelect.dataset.idx), relSelect.value);
                }
            };
            watchList.oninput = (e) => {
                const objInput = e.target.closest('.watch-obj-input');
                if (objInput) {
                    this.handleWatchObjectInput(parseInt(objInput.dataset.idx), objInput.value);
                }
                const recInput = e.target.closest('.watch-rec-input');
                if (recInput) {
                    this.handleWatchRecordInput(parseInt(recInput.dataset.idx), recInput.value);
                }
            };
        }

        const recentRecords = document.getElementById('emulator-recent-records');
        if (recentRecords) {
            recentRecords.onclick = (e) => {
                const pill = e.target.closest('.recent-pill');
                if (pill) this.selectRecord(pill.dataset.id, pill.dataset.name);
            };
        }

        // Mutation Observer to persist state in memory
        const observer = new MutationObserver(() => {
            if (container.innerHTML && container.innerHTML.length > 500) {
                this.savedState = container.innerHTML;
            }
        });
        observer.observe(container, { childList: true, subtree: true, attributes: true, characterData: true });
    },

    clear() {
        this.savedState = null;
        this.sourceRecordId = null;
        this.sourceObject = null;
        this.sourceDescribe = null;
        this.render();
    },

    async prefetchObjectNames() {
        if (this.objectNames.length > 0) return;
        try {
            const list = await window.apiClient.getGlobalDescribe();
            this.objectNames = list.sobjects.map(o => o.name).sort();
        } catch (err) { }
    },

    handleObjectInput(val) {
        if (!val || val.length < 1) {
            const res = document.getElementById('emulator-obj-results');
            if (res) res.style.display = 'none';
            return;
        }
        const matches = this.objectNames.filter(n => n.toLowerCase().includes(val.toLowerCase())).slice(0, 10);
        const results = document.getElementById('emulator-obj-results');
        if (results) {
            results.innerHTML = matches.map(m => `<div class="search-item" data-name="${_escapeHtml(m)}"><span class="name">${_escapeHtml(m)}</span></div>`).join('');
            results.style.display = 'block';
        }
    },

    selectObject(name) {
        const input = document.getElementById('emulator-obj-input');
        if (input) input.value = name;
        const res = document.getElementById('emulator-obj-results');
        if (res) res.style.display = 'none';
        this.handleObjectChange();
    },

    async handleObjectChange() {
        const objInput = document.getElementById('emulator-obj-input');
        if (!objInput) return;
        const objName = objInput.value.trim();
        if (!objName || !this.objectNames.includes(objName)) return;

        try {
            const recent = await window.apiClient.getRecentRecords(objName);
            const container = document.getElementById('emulator-recent-records');
            if (container && recent.length > 0) {
                container.style.display = 'flex';
                container.innerHTML = `<span style="font-size: 10px; color: #555; align-self: center;">RECENT:</span>` +
                    recent.map(r => `<div class="recent-pill" data-id="${_escapeHtml(r.Id)}" data-name="${_escapeHtml(r.Name)}">${_escapeHtml(r.Name)}</div>`).join('');
            }
        } catch (err) { }
    },

    async selectRecord(id, name) {
        this.sourceRecordId = id;
        const objInput = document.getElementById('emulator-obj-input');
        this.sourceObject = objInput.value.trim();

        const idInput = document.getElementById('emulator-id-input');
        if (idInput) idInput.value = name;

        const results = document.getElementById('emulator-search-results');
        if (results) results.style.display = 'none';

        try {
            if (window.Terminal) window.Terminal.log(`[Emulator] Initializing observation for ${this.sourceObject}...`);
            this.sourceDescribe = await window.apiClient.describeSObject(this.sourceObject);

            this.watchTargets = [{
                type: 'source',
                objectApiName: this.sourceObject,
                recordId: this.sourceRecordId,
                relationshipPath: 'Source',
                fields: ['LastModifiedDate']
            }];

            this.renderTriggerConfig();
            this.renderWatchConfig();
        } catch (err) {
            if (window.Terminal) window.Terminal.error(`Setup Failed: ${err.message}`);
        }
    },

    renderTriggerConfig() {
        document.getElementById('emulator-empty').style.display = 'none';
        document.getElementById('emulator-trigger-config').style.display = 'block';
        const select = document.getElementById('emulator-field-select');
        const fields = this.sourceDescribe.fields.filter(f => f.updateable).sort((a, b) => a.label.localeCompare(b.label));
        select.innerHTML = fields.map(f => `<option value="${_escapeHtml(f.name)}">${_escapeHtml(f.label)}</option>`).join('');
    },

    renderWatchConfig() {
        document.getElementById('emulator-watch-config').style.display = 'block';
        this.renderWatchTargets();
    },

    addWatchTarget() {
        this.watchTargets.push({
            type: 'relationship',
            objectApiName: '',
            recordId: '',
            relationshipPath: '',
            fields: []
        });
        this.renderWatchTargets();
    },

    updateWatchTargetType(idx, type) {
        const target = this.watchTargets[idx];
        target.type = type;
        target.objectApiName = '';
        target.recordId = '';
        target.relationshipPath = '';
        target.fields = [];
        this.renderWatchTargets();
    },

    async updateWatchTargetRel(idx, relName) {
        const rel = this.sourceDescribe.childRelationships.find(r => r.relationshipName === relName);
        if (!rel) return;
        const target = this.watchTargets[idx];
        target.relationshipPath = relName;
        target.objectApiName = rel.childSObject;
        await this.fetchTargetFields(idx);
    },

    async handleWatchObjectInput(idx, val) {
        const dropdown = document.querySelector(`.watch-obj-dropdown[data-target-idx="${idx}"]`);
        if (!val || val.length < 1) {
            if (dropdown) dropdown.style.display = 'none';
            return;
        }
        const matches = this.objectNames.filter(n => n.toLowerCase().includes(val.toLowerCase())).slice(0, 10);
        if (dropdown) {
            dropdown.innerHTML = matches.map(m => `<div class="search-item" data-name="${_escapeHtml(m)}"><span class="name">${_escapeHtml(m)}</span></div>`).join('');
            dropdown.style.display = 'block';
        }
    },

    async selectWatchObject(idx, name) {
        const target = this.watchTargets[idx];
        target.objectApiName = name;
        target.recordId = '';
        await this.fetchTargetFields(idx);
    },

    async handleWatchRecordInput(idx, val) {
        const target = this.watchTargets[idx];
        const dropdown = document.querySelector(`.watch-rec-dropdown[data-target-idx="${idx}"]`);
        if (!target.objectApiName || val.length < 2) {
            if (dropdown) dropdown.style.display = 'none';
            return;
        }
        try {
            const res = await window.apiClient.searchRecords(target.objectApiName, val);
            if (dropdown) {
                dropdown.innerHTML = res.map(r => `<div class="search-item" data-id="${_escapeHtml(r.Id)}" data-name="${_escapeHtml(r.Name)}"><span class="name">${_escapeHtml(r.Name)}</span></div>`).join('');
                dropdown.style.display = 'block';
            }
        } catch (err) { }
    },

    selectWatchRecord(idx, id, name) {
        const target = this.watchTargets[idx];
        target.recordId = id;
        target.recordName = name;
        this.renderWatchTargets();
    },

    async fetchTargetFields(idx) {
        const target = this.watchTargets[idx];
        if (!this.childDescribes[target.objectApiName]) {
            this.childDescribes[target.objectApiName] = await window.apiClient.describeSObject(target.objectApiName);
        }
        this.renderWatchTargets();
    },

    removeWatchTarget(idx) {
        this.watchTargets.splice(idx, 1);
        this.renderWatchTargets();
    },

    toggleFieldWatch(targetIdx, fieldName) {
        const target = this.watchTargets[targetIdx];
        const idx = target.fields.indexOf(fieldName);
        if (idx > -1) target.fields.splice(idx, 1);
        else target.fields.push(fieldName);
        this.renderWatchTargets();
    },

    renderWatchTargets() {
        const container = document.getElementById('watch-targets-list');
        if (!container) return;

        container.innerHTML = this.watchTargets.map((target, idx) => {
            const isSource = target.type === 'source';
            const isRel = target.type === 'relationship';
            const isInd = target.type === 'independent';

            const desc = isSource ? this.sourceDescribe : (this.childDescribes[target.objectApiName] || null);
            const fields = desc ? desc.fields.filter(f => f.queryable).sort((a, b) => a.label.localeCompare(b.label)) : [];

            return `
                <div class="watch-target-card" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; padding: 12px; margin-bottom: 8px;">
                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px; gap: 12px;">
                        <div style="flex: 1; display: flex; gap: 8px; align-items: center;">
                            <select class="watch-target-type-select" data-idx="${idx}" style="font-size: 10px; background: #333; color: var(--accent-color); border: none; padding: 2px 4px; border-radius: 4px; font-weight: 700;">
                                <option value="source" ${isSource ? 'selected' : ''}>SOURCE</option>
                                <option value="relationship" ${isRel ? 'selected' : ''}>RELATED</option>
                                <option value="independent" ${isInd ? 'selected' : ''}>SPECIFIC RECORD</option>
                            </select>

                            ${isRel ? `
                                <select class="watch-rel-select" data-idx="${idx}" style="font-size: 10px; background: transparent; border: 1px solid #444; color: white; padding: 2px 4px; border-radius: 4px;">
                                    <option value="">-- Select Relation --</option>
                                    ${this.sourceDescribe.childRelationships.filter(r => r.relationshipName).map(r => `
                                        <option value="${r.relationshipName}" ${target.relationshipPath === r.relationshipName ? 'selected' : ''}>${r.relationshipName} [${r.childSObject}]</option>
                                    `).join('')}
                                </select>
                            ` : ''}

                            ${isInd ? `
                                <div style="display: flex; gap: 4px; flex: 1; align-items: center;">
                                    <div style="position: relative; flex: 1;" class="search-dropdown-wrapper" data-target-idx="${idx}">
                                        <input type="text" class="watch-obj-input" data-idx="${idx}" placeholder="Object..." value="${target.objectApiName}" style="width: 100%; font-size: 10px; padding: 4px; background: rgba(0,0,0,0.3); border: 1px solid #444; color: white;" autocomplete="off">
                                        <div class="search-dropdown watch-obj-dropdown" data-target-idx="${idx}" style="display: none;"></div>
                                    </div>
                                    <div style="position: relative; flex: 1.5;" class="search-dropdown-wrapper" data-target-idx="${idx}">
                                        <input type="text" class="watch-rec-input" data-idx="${idx}" placeholder="Record..." value="${target.recordName || target.recordId}" style="width: 100%; font-size: 10px; padding: 4px; background: rgba(0,0,0,0.3); border: 1px solid #444; color: white;" autocomplete="off">
                                        <div class="search-dropdown watch-rec-dropdown" data-target-idx="${idx}" style="display: none;"></div>
                                    </div>
                                </div>
                            ` : ''}
                        </div>
                        ${!isSource ? `<button class="sf-btn link small remove-watch-btn" data-idx="${idx}" style="color: #ff4d4d; font-size: 9px; padding: 2px 0;">Remove</button>` : ''}
                    </div>
                    
                    ${fields.length > 0 ? `
                        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; max-height: 100px; overflow-y: auto; padding: 4px; background: rgba(0,0,0,0.2); border-radius: 4px;">
                            ${fields.map(f => `
                                <label style="font-size: 10px; color: #ccc; cursor: pointer; display: flex; align-items: center; gap: 4px;">
                                    <input type="checkbox" class="field-watch-checkbox" data-target-idx="${idx}" data-field-name="${f.name}" ${target.fields.includes(f.name) ? 'checked' : ''}>
                                    ${f.label}
                                </label>
                            `).join('')}
                        </div>
                    ` : `<div style="font-size: 10px; color: #555; font-style: italic;">Pick context to see fields...</div>`}
                </div>
            `;
        }).join('');
    },

    async handleSimulate() {
        const fieldName = document.getElementById('emulator-field-select').value;
        const newValue = document.getElementById('emulator-value-input').value;
        const btn = document.getElementById('emulator-simulate-btn');

        btn.disabled = true;
        btn.innerHTML = '🧪 SIMULATING...';

        try {
            if (window.Terminal) window.Terminal.log('[Emulator] STEP 1: Capturing baseline...');
            const before = await this.captureWatchSnapshot();

            if (window.Terminal) window.Terminal.log(`[Emulator] STEP 2: Updating ${this.sourceObject}.${fieldName}...`);
            await window.apiClient.updateRecord(this.sourceObject, this.sourceRecordId, { [fieldName]: newValue });

            if (window.Terminal) window.Terminal.log('[Emulator] STEP 3: Waiting 3000ms for automation settles...');
            await new Promise(r => setTimeout(r, 3000));

            if (window.Terminal) window.Terminal.log('[Emulator] STEP 4: Capturing result state...');
            const after = await this.captureWatchSnapshot();

            const results = this.diffObservation(before, after);
            this.renderObservationResults(results);

            if (window.Terminal) window.Terminal.success('[Emulator] STEP 5: Observation complete.');
        } catch (err) {
            if (window.Terminal) window.Terminal.error(`Simulation Error: ${err.message}`);
        } finally {
            btn.disabled = false;
            btn.innerHTML = 'RUN SIMULATION (3s)';
        }
    },

    async captureWatchSnapshot() {
        const snapshot = {};
        for (let i = 0; i < this.watchTargets.length; i++) {
            const target = this.watchTargets[i];
            if (!target.objectApiName) continue;

            const fields = Array.from(new Set(['Id', 'Name', ...target.fields])).join(',');
            let query = `SELECT ${fields} FROM ${target.objectApiName} `;

            if (target.type === 'source') {
                query += `WHERE Id = '${this.sourceRecordId}'`;
            } else if (target.type === 'relationship') {
                if (!target.relationshipPath) continue;
                const rel = this.sourceDescribe.childRelationships.find(r => r.relationshipName === target.relationshipPath);
                query += `WHERE ${rel.field} = '${this.sourceRecordId}'`;
            } else if (target.type === 'independent') {
                if (!target.recordId) continue;
                query += `WHERE Id = '${target.recordId}'`;
            }

            const res = await window.apiClient.query(query);
            snapshot[i] = res.records || [];
        }
        return snapshot;
    },

    diffObservation(before, after) {
        const results = [];
        for (const idx in after) {
            const target = this.watchTargets[idx];
            after[idx].forEach(afterRec => {
                const beforeRec = before[idx]?.find(b => b.Id === afterRec.Id);
                const res = { name: afterRec.Name || afterRec.Id, obj: target.objectApiName, changes: [] };
                target.fields.forEach(f => {
                    const bVal = beforeRec ? beforeRec[f] : null;
                    const aVal = afterRec[f];
                    if (String(bVal) !== String(aVal)) {
                        res.changes.push({ field: f, from: bVal, to: aVal });
                    }
                });
                results.push(res);
            });
        }
        return results;
    },

    renderObservationResults(results) {
        const view = document.getElementById('emulator-impact-view');
        const container = document.getElementById('impact-results-container');
        view.style.display = 'block';
        container.innerHTML = results.map(r => `
            <div style="background: rgba(255,255,255,0.05); margin-bottom: 8px; border-radius: 4px; padding: 8px;">
                <div style="font-weight: 700; font-size: 11px; margin-bottom: 4px;">${_escapeHtml(r.name)} [${_escapeHtml(r.obj)}]</div>
                ${r.changes.length === 0 ? '<div style="font-size: 10px; color: #666;">No watched changes detected.</div>' : r.changes.map(c => `
                    <div style="font-size: 10px; display: flex; justify-content: space-between;">
                        <span>${_escapeHtml(c.field)}:</span>
                        <span style="color: #ff9f43;">${_escapeHtml(c.from)} → ${_escapeHtml(c.to)}</span>
                    </div>
                `).join('')}
            </div>
        `).join('');
    },

    async handleSearchInput(val) {
        if (val.length < 2) return;
        try {
            const res = await window.apiClient.searchRecords(this.sourceObject, val);
            const results = document.getElementById('emulator-search-results');
            if (results) {
                results.innerHTML = res.map(r => `<div class="search-item" data-id="${_escapeHtml(r.Id)}" data-name="${_escapeHtml(r.Name)}"><span class="name">${_escapeHtml(r.Name)}</span></div>`).join('');
                results.style.display = 'block';
            }
        } catch (err) { }
    }
};

window.WorkflowEmulator = WorkflowEmulator;
