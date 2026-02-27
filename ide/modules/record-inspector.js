/**
 * SF-Intel Studio - Record Inspector Module
 * Handles UI logic for fetching, editing, and verifying Salesforce records.
 */

const RecordInspector = {
    currentRecord: null,
    snapshot: null,
    objectDescribe: null,
    childRelationships: [],
    objectNames: [], // Cached list of SObject names
    savedState: null,

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
            <div class="record-inspector-header" style="padding: 16px; border-bottom: 1px solid rgba(255,255,255,0.05); background: rgba(0,0,0,0.1); position: relative;">
                <div style="display: flex; gap: 8px; align-items: center;">
                    <button class="sf-btn secondary small" id="record-refresh-btn" style="min-width: auto; padding: 4px 8px;">REFRESH</button>
                    <button class="sf-btn secondary small" id="record-reload-btn" style="min-width: auto; padding: 4px 8px; border-color: #ff3b30; color: #ff3b30;">RELOAD & SYNC</button>
                    <div style="position: relative; flex: 1;">
                        <input type="text" id="inspector-obj-input" placeholder="Object (e.g. Account)" style="width: 100%; padding: 6px 10px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; color: white;" autocomplete="off">
                        <div id="inspector-obj-results" class="search-dropdown" style="display: none;"></div>
                    </div>
                    <div style="position: relative; flex: 2.5;">
                        <input type="text" id="inspector-id-input" placeholder="🔍 Search Name / Field / Id" style="width: 100%; padding: 6px 10px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; color: white;" autocomplete="off">
                        <div id="inspector-search-results" class="search-dropdown" style="display: none;"></div>
                    </div>
                    <button id="inspector-fetch-btn" class="sf-btn primary small" style="padding: 6px 16px;">FETCH</button>
                </div>
                <div id="inspector-recent-records" style="display: none; margin-top: 12px; gap: 8px; flex-wrap: wrap;"></div>
            </div>
            <div id="inspector-content" style="flex: 1; overflow-y: auto; padding: 16px;">
                <div class="empty-state" style="text-align: center; color: #666; margin-top: 50px;">
                    Enter Object and Record ID to begin inspection.
                </div>
            </div>
            <div id="inspector-footer" class="utility-results-header" style="display: none; justify-content: flex-end; gap: 12px; padding: 12px 16px; border-top: 1px solid rgba(255,255,255,0.05);">
                <button id="inspector-reset-btn" class="sf-btn secondary small">RESET</button>
                <button id="inspector-save-btn" class="sf-btn primary small" style="background: #27ae60; border-color: #2ecc71;">SAVE CHANGES</button>
            </div>
        `;

        this.bindEvents();
        this.prefetchObjectNames();
    },

    bindEvents() {
        const objInput = document.getElementById('inspector-obj-input');
        const searchInput = document.getElementById('inspector-id-input');
        const container = document.getElementById('utility-view-container');

        if (objInput) {
            objInput.addEventListener('input', (e) => this.handleObjectInput(e.target.value));
            objInput.addEventListener('keydown', (e) => this.handleObjectKeydown(e));
            objInput.addEventListener('change', () => this.handleObjectChange());
        }

        if (searchInput) {
            searchInput.addEventListener('input', (e) => this.handleSearchInput(e.target.value));
            searchInput.addEventListener('keydown', (e) => this.handleSearchKeydown(e));
            searchInput.addEventListener('focus', () => this.handleSearchFocus());
        }

        const fetchBtn = document.getElementById('inspector-fetch-btn');
        if (fetchBtn) fetchBtn.onclick = () => this.handleFetch();

        const reloadBtn = document.getElementById('record-reload-btn');
        if (reloadBtn) reloadBtn.onclick = () => location.reload();

        const clearBtn = document.getElementById('inspector-clear-btn');
        if (clearBtn) clearBtn.onclick = () => this.clear();

        const recentRecords = document.getElementById('inspector-recent-records');
        if (recentRecords) {
            recentRecords.onclick = (e) => {
                const pill = e.target.closest('.recent-pill');
                if (pill) this.selectRecord(pill.dataset.id, pill.dataset.name);
            };
        }

        const searchResults = document.getElementById('inspector-search-results');
        if (searchResults) {
            searchResults.onclick = (e) => {
                const item = e.target.closest('.search-item');
                if (item) this.selectRecord(item.dataset.id, item.dataset.name);
            };
        }

        const objResults = document.getElementById('inspector-obj-results');
        if (objResults) {
            objResults.onclick = (e) => {
                const item = e.target.closest('.search-item');
                if (item) this.selectObject(item.dataset.name);
            };
        }

        // Mutation Observer to save state
        const observer = new MutationObserver(() => {
            this.savedState = container.innerHTML;
        });
        observer.observe(container, { childList: true, subtree: true, attributes: true, characterData: true });

        // Close dropdown on click outside
        document.addEventListener('click', (e) => {
            if (searchInput && !searchInput.contains(e.target) && searchResults && !searchResults.contains(e.target)) {
                this.hideSearchResults();
            }
            if (objInput && !objInput.contains(e.target) && objResults && !objResults.contains(e.target)) {
                this.hideObjectResults();
            }
        });

        // Re-bind save/reset buttons if they exist
        const saveBtn = document.getElementById('inspector-save-btn');
        const resetBtn = document.getElementById('inspector-reset-btn');
        if (saveBtn) saveBtn.onclick = () => this.handleSave();
        if (resetBtn) resetBtn.onclick = () => this.renderForm();
    },

    clear() {
        this.savedState = null;
        this.currentRecord = null;
        this.snapshot = null;
        this.objectDescribe = null;
        this.render();
    },

    async handleObjectChange() {
        const objInput = document.getElementById('inspector-obj-input');
        if (!objInput) return;
        const objName = objInput.value.trim();

        if (!objName) {
            const recent = document.getElementById('inspector-recent-records');
            if (recent) recent.style.display = 'none';
            return;
        }

        // Only fetch recent if it's a valid object name (suppress errors for partial typing)
        if (!this.objectNames.includes(objName)) {
            return;
        }

        try {
            const recent = await window.apiClient.getRecentRecords(objName);
            this.renderRecentRecords(recent);
        } catch (err) {
            console.warn('[SF-Intel] Failed to fetch recent records:', err);
        }
    },

    renderRecentRecords(records) {
        const container = document.getElementById('inspector-recent-records');
        if (!container) return;

        if (!records || records.length === 0) {
            container.style.display = 'none';
            return;
        }

        container.style.display = 'flex';
        container.innerHTML = `
            <span style="font-size: 10px; color: #555; align-self: center; margin-right: 4px;">RECENT:</span>
            ${records.map(r => `
                <div class="recent-pill" data-id="${r.Id}" data-name="${r.Name}">
                    ${r.Name}
                </div>
            `).join('')}
        `;
    },

    selectRecord(id, name) {
        const input = document.getElementById('inspector-id-input');
        if (input) input.value = id;
        this.hideSearchResults();
        this.handleFetch();
    },

    async prefetchObjectNames() {
        if (this.objectNames.length > 0) return;
        try {
            const describe = await window.apiClient.getGlobalDescribe();
            this.objectNames = describe.sobjects.map(o => o.name).sort();
        } catch (err) {
            console.warn('[SF-Intel] Prefetch objects failed:', err);
        }
    },

    handleObjectInput(val) {
        if (!val || val.length < 1) {
            this.hideObjectResults();
            return;
        }

        const matches = this.objectNames
            .filter(name => name.toLowerCase().includes(val.toLowerCase()))
            .slice(0, 10);

        this.renderObjectResults(matches);
    },

    renderObjectResults(matches) {
        const results = document.getElementById('inspector-obj-results');
        if (!results) return;

        if (matches.length === 0) {
            results.style.display = 'none';
            return;
        }

        results.innerHTML = matches.map((name, idx) => `
            <div class="search-item ${idx === 0 ? 'active' : ''}" data-name="${_escapeHtml(name)}">
                <span class="name">${_escapeHtml(name)}</span>
            </div>
        `).join('');
        results.style.display = 'block';
    },

    hideObjectResults() {
        const results = document.getElementById('inspector-obj-results');
        if (results) results.style.display = 'none';
    },

    handleObjectKeydown(e) {
        const results = document.getElementById('inspector-obj-results');
        if (!results || results.style.display === 'none') return;

        const items = results.querySelectorAll('.search-item');
        if (items.length === 0) return;

        let activeIdx = Array.from(items).findIndex(it => it.classList.contains('active'));

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            items[activeIdx].classList.remove('active');
            activeIdx = (activeIdx + 1) % items.length;
            items[activeIdx].classList.add('active');
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            items[activeIdx].classList.remove('active');
            activeIdx = (activeIdx - 1 + items.length) % items.length;
            items[activeIdx].classList.add('active');
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            const active = items[activeIdx];
            if (active) this.selectObject(active.dataset.name);
        } else if (e.key === 'Escape') {
            this.hideObjectResults();
        }
    },

    selectObject(name) {
        const input = document.getElementById('inspector-obj-input');
        if (input) input.value = name;
        this.hideObjectResults();
        this.handleObjectChange();
        // Focus search input for record
        document.getElementById('inspector-id-input')?.focus();
    },

    searchTimeout: null,
    async handleSearchInput(val) {
        if (this.searchTimeout) clearTimeout(this.searchTimeout);

        if (val.length >= 15 && (val.startsWith('00') || val.match(/^[a-zA-Z0-9]{15,18}$/))) {
            this.hideSearchResults();
            return;
        }

        if (val.length < 2) {
            this.hideSearchResults();
            return;
        }

        this.searchTimeout = setTimeout(async () => {
            const objName = document.getElementById('inspector-obj-input').value.trim();
            if (!objName) return;

            try {
                const matches = await window.apiClient.searchRecords(objName, val);
                this.renderSearchResults(matches);
            } catch (err) {
                console.error('[SF-Intel] Search error:', err);
            }
        }, 300);
    },

    renderSearchResults(records) {
        const results = document.getElementById('inspector-search-results');
        if (!results) return;

        if (!records || records.length === 0) {
            results.innerHTML = '<div style="padding: 10px; color: #666; font-size: 12px;">No matches found.</div>';
        } else {
            results.innerHTML = records.map((r, idx) => `
                <div class="search-item ${idx === 0 ? 'active' : ''}" data-id="${_escapeHtml(r.Id)}" data-name="${_escapeHtml(r.Name)}">
                    <span class="name">${_escapeHtml(r.Name)}</span>
                    <span class="id">${_escapeHtml(r.Id)}</span>
                </div>
            `).join('');
        }
        results.style.display = 'block';
    },

    hideSearchResults() {
        const results = document.getElementById('inspector-search-results');
        if (results) results.style.display = 'none';
    },

    handleSearchFocus() {
        const input = document.getElementById('inspector-id-input');
        if (!input) return;
        const val = input.value;
        if (val.length >= 2 && !val.startsWith('00')) {
            this.handleSearchInput(val);
        }
    },

    handleSearchKeydown(e) {
        const results = document.getElementById('inspector-search-results');
        if (!results || results.style.display === 'none') return;

        const items = results.querySelectorAll('.search-item');
        if (items.length === 0) return;

        let activeIdx = Array.from(items).findIndex(it => it.classList.contains('active'));

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            items[activeIdx].classList.remove('active');
            activeIdx = (activeIdx + 1) % items.length;
            items[activeIdx].classList.add('active');
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            items[activeIdx].classList.remove('active');
            activeIdx = (activeIdx - 1 + items.length) % items.length;
            items[activeIdx].classList.add('active');
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const active = items[activeIdx];
            if (active) this.selectRecord(active.dataset.id, active.dataset.name);
        } else if (e.key === 'Escape') {
            this.hideSearchResults();
        }
    },

    async handleFetch() {
        const objName = document.getElementById('inspector-obj-input').value.trim();
        const recordIdInput = document.getElementById('inspector-id-input').value.trim();

        if (!objName || !recordIdInput) {
            if (window.Terminal) window.Terminal.error('Object and Record ID are required.');
            return;
        }

        const isProbablyId = (recordIdInput.length === 15 || recordIdInput.length === 18) &&
            (recordIdInput.startsWith('00') || recordIdInput.match(/^[a-zA-Z0-9]{15,18}$/));

        if (!isProbablyId) {
            if (window.Terminal) window.Terminal.log(`'${recordIdInput}' is not a valid ID. Automatic discovery starting...`);
            try {
                const matches = await window.apiClient.searchRecords(objName, recordIdInput);
                if (matches && matches.length > 0) {
                    if (window.Terminal) window.Terminal.log(`Found matching record: ${matches[0].Name}`);
                    this.selectRecord(matches[0].Id, matches[0].Name);
                    return;
                } else {
                    throw new Error(`Record "${recordIdInput}" not found in ${objName}.`);
                }
            } catch (searchErr) {
                if (window.Terminal) window.Terminal.error(searchErr.message);
                const content = document.getElementById('inspector-content');
                content.innerHTML = `<div class="error-msg" style="color: #e74c3c; padding: 20px; text-align: center;"><b>Discover Failed:</b> ${_escapeHtml(searchErr.message)}</div>`;
                return;
            }
        }

        const content = document.getElementById('inspector-content');
        content.innerHTML = '<div class="loading">Fetching record and metadata...</div>';

        try {
            this.objectDescribe = await window.apiClient.describeSObject(objName);
            this.currentRecord = await window.apiClient.getRecord(objName, recordIdInput);
            this.snapshot = JSON.parse(JSON.stringify(this.currentRecord));
            await this.fetchRelatedRecords(objName, recordIdInput);
            this.renderForm();
            document.getElementById('inspector-footer').style.display = 'flex';
        } catch (err) {
            console.error('[SF-Intel] Fetch error:', err);
            content.innerHTML = `<div class="error-msg" style="color: #e74c3c; padding: 20px; text-align: center;"><b>Fetch Failed:</b> ${_escapeHtml(err.message)}</div>`;
        }
    },

    renderForm(diffs = null) {
        const content = document.getElementById('inspector-content');
        if (!content) return; // Lifecycle Guard: View was cleared/swapped

        const fields = this.objectDescribe.fields;

        const updateableFields = fields.filter(f => f.updateable);
        const readOnlyFields = fields.filter(f => !f.updateable);

        let html = `
            <div class="inspector-section">
                <div style="font-weight: 600; font-size: 11px; color: #888; margin-bottom: 12px; letter-spacing: 1px;">RECORD FIELDS</div>
                <div class="field-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
        `;

        [...updateableFields, ...readOnlyFields].forEach(field => {
            const val = this.currentRecord[field.name];
            const isChanged = diffs && diffs.hasOwnProperty(field.name);
            const displayVal = val === null ? '' : val;
            const highlightStyle = isChanged ? 'border: 1px solid #2ecc71; background: rgba(46, 204, 113, 0.1);' : '';

            html += `
                <div class="field-item" style="display: flex; flex-direction: column; gap: 4px;">
                    <label style="font-size: 11px; color: ${field.updateable ? '#ccc' : '#666'}; font-weight: 500;">
                        ${_escapeHtml(field.label)} ${field.nillable === false ? '<span style="color: #e74c3c;">*</span>' : ''}
                        <span style="font-family: monospace; font-size: 9px; color: #555; margin-left: 4px;">(${_escapeHtml(field.name)})</span>
                    </label>
                    ${this.renderFieldInput(field, displayVal, highlightStyle)}
                    ${isChanged ? `<div style="font-size: 9px; color: #2ecc71; margin-top: 2px;">⚡ Updated by Automation</div>` : ''}
                </div>
            `;
        });

        html += `</div></div>`;

        if (this.childRelationships && this.childRelationships.length > 0) {
            html += `
                <div class="inspector-section" style="margin-top: 32px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 24px;">
                    <div style="font-weight: 600; font-size: 11px; color: #888; margin-bottom: 12px; letter-spacing: 1px;">RELATED RECORDS (CHILDREN)</div>
                    <div class="related-grid" style="display: flex; flex-direction: column; gap: 12px;">
                        ${this.childRelationships.map(rel => `
                            <div class="related-bundle" style="background: rgba(0,0,0,0.2); border-radius: 4px; border: 1px solid rgba(255,255,255,0.03);">
                                <div style="padding: 8px 12px; background: rgba(255,255,255,0.02); font-size: 11px; font-weight: 600; color: #aaa; display: flex; justify-content: space-between;">
                                    <span>${_escapeHtml(rel.relationshipName)} (${rel.records.length})</span>
                                    <span style="font-family: monospace; font-size: 9px; color: #555;">${_escapeHtml(rel.childObject)}</span>
                                </div>
                                <div style="padding: 12px;">
                                    ${rel.records.length === 0 ? '<div style="color: #444; font-size: 12px;">No records found.</div>' : `
                                        <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
                                            <thead style="color: #666; text-align: left;">
                                                <tr>
                                                    ${rel.records[0] ? Object.keys(rel.records[0]).filter(k => k !== 'attributes' && k !== 'Id').map(k => `<th style="padding: 4px 8px;">${_escapeHtml(k)}</th>`).join('') : ''}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                ${rel.records.map(r => `
                                                    <tr style="border-top: 1px solid rgba(255,255,255,0.03);">
                                                        ${Object.keys(r).filter(k => k !== 'attributes' && k !== 'Id').map(k => `
                                                            <td style="padding: 6px 8px; color: #ccc;">${r[k] === null ? '<span style="color: #444;">null</span>' : _escapeHtml(String(r[k]))}</td>
                                                        `).join('')}
                                                    </tr>
                                                `).join('')}
                                            </tbody>
                                        </table>
                                    `}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }
        content.innerHTML = html;
    },

    renderFieldInput(field, val, extraStyle) {
        const baseStyle = `padding: 6px 10px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.05); border-radius: 4px; color: white; width: 100%; font-size: 13px; ${extraStyle}`;

        if (!field.updateable) {
            return `<div style="${baseStyle} color: #888; background: rgba(255,255,255,0.05); cursor: not-allowed; border-color: transparent;">${_escapeHtml(String(val))}</div>`;
        }

        if (field.type === 'boolean') {
            return `<input type="checkbox" class="record-field-input" data-field="${field.name}" ${val ? 'checked' : ''} style="width: auto;">`;
        }

        if (field.type === 'picklist') {
            return `
                <select class="record-field-input" data-field="${field.name}" style="${baseStyle}">
                    <option value="">-- None --</option>
                    ${field.picklistValues.map(pv => `<option value="${pv.value}" ${pv.value === val ? 'selected' : ''}>${pv.label}</option>`).join('')}
                </select>
            `;
        }

        if (field.type === 'textarea') {
            return `<textarea class="record-field-input" data-field="${field.name}" rows="2" style="${baseStyle}">${val}</textarea>`;
        }

        return `<input type="${field.type === 'double' || field.type === 'int' ? 'number' : 'text'}" class="record-field-input" data-field="${field.name}" value="${val}" style="${baseStyle}">`;
    },

    async handleSave() {
        const objName = document.getElementById('inspector-obj-input').value.trim();
        const recordId = document.getElementById('inspector-id-input').value.trim();
        const saveBtn = document.getElementById('inspector-save-btn');

        const inputs = document.querySelectorAll('.record-field-input');
        const updates = {};

        inputs.forEach(input => {
            const fieldName = input.dataset.field;
            let val = input.type === 'checkbox' ? input.checked : input.value;
            if (val !== this.snapshot[fieldName]) {
                updates[fieldName] = val === '' ? null : val;
            }
        });

        if (Object.keys(updates).length === 0) {
            if (window.Terminal) window.Terminal.log('No changes detected.');
            return;
        }

        saveBtn.disabled = true;
        saveBtn.innerHTML = '⏳ SAVING...';

        try {
            await window.apiClient.updateRecord(objName, recordId, updates);
            if (window.Terminal) window.Terminal.success(`✓ Record saved successfully (${objName})`);
            if (window.Terminal) window.Terminal.log('Verifying automation side-effects...');

            const refreshedRecord = await window.apiClient.getRecord(objName, recordId);
            await this.fetchRelatedRecords(objName, recordId);

            const diffs = this.calculateDiff(this.snapshot, refreshedRecord, updates);

            this.currentRecord = refreshedRecord;
            this.snapshot = JSON.parse(JSON.stringify(refreshedRecord));
            this.renderForm(diffs);

        } catch (err) {
            console.error('[SF-Intel] Save error:', err);
            if (window.Terminal) window.Terminal.error(`Save Failed: ${err.message}`);
        } finally {
            // Lifecycle Guard: Check if button still exists before updating
            const finalSaveBtn = document.getElementById('inspector-save-btn');
            if (finalSaveBtn) {
                finalSaveBtn.disabled = false;
                finalSaveBtn.innerHTML = 'SAVE CHANGES';
            }
        }
    },

    calculateDiff(oldRec, newRec, explicitUpdates) {
        const diffs = {};
        for (const key in newRec) {
            if (oldRec[key] !== newRec[key]) {
                if (!explicitUpdates.hasOwnProperty(key)) {
                    diffs[key] = { from: oldRec[key], to: newRec[key] };
                }
            }
        }
        return diffs;
    },

    async fetchRelatedRecords(objName, recordId) {
        const noiseKeywords = ['History', 'Feed', 'Share', 'CleanInfo', 'ChangeEvent', 'ApexMessage'];
        const priorityObjects = ['Contact', 'Opportunity', 'Case', 'Task', 'Event', 'AccountContactRelation'];

        let relations = this.objectDescribe.childRelationships.filter(r => {
            if (!r.relationshipName) return false;
            if (noiseKeywords.some(noise => r.relationshipName.includes(noise) || r.childSObject.includes(noise))) {
                return false;
            }
            return true;
        });

        relations.sort((a, b) => {
            const aPriority = priorityObjects.includes(a.childSObject) ? 1 : 0;
            const bPriority = priorityObjects.includes(b.childSObject) ? 1 : 0;
            if (aPriority !== bPriority) return bPriority - aPriority;
            return a.relationshipName.localeCompare(b.relationshipName);
        });

        relations = relations.slice(0, 5);
        this.childRelationships = [];

        for (const rel of relations) {
            try {
                let nameField = 'Name';
                if (rel.childSObject === 'Case') nameField = 'CaseNumber';
                else if (rel.childSObject === 'Task' || rel.childSObject === 'Event') nameField = 'Subject';
                else if (rel.childSObject === 'AccountContactRole') nameField = 'Role'; // Special case

                const query = `SELECT Id, ${nameField}, LastModifiedDate FROM ${rel.childSObject} WHERE ${rel.field} = '${recordId}' ORDER BY LastModifiedDate DESC LIMIT 5`;
                const res = await window.apiClient.getRelatedRecords(query);

                this.childRelationships.push({
                    relationshipName: rel.relationshipName,
                    childObject: rel.childSObject,
                    records: res.records || []
                });
            } catch (queryErr) {
                try {
                    // Fallback to minimal fields if 'Name' fields fail
                    const fallbackQuery = `SELECT Id, LastModifiedDate FROM ${rel.childSObject} WHERE ${rel.field} = '${recordId}' ORDER BY LastModifiedDate DESC LIMIT 5`;
                    const res = await window.apiClient.getRelatedRecords(fallbackQuery);
                    this.childRelationships.push({
                        relationshipName: rel.relationshipName,
                        childObject: rel.childSObject,
                        records: res.records || []
                    });
                } catch (innerErr) {
                    // Fail silently to avoid UI noise
                }
            }
        }
    }
};

window.RecordInspector = RecordInspector;
