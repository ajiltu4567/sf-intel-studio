/**
 * SF-Intel Studio - SOQL Autocomplete Module
 * Context-aware autocomplete for SOQL queries
 * 
 * @module SOQLAutocomplete
 */

const SOQLAutocomplete = {
    // Active state
    _isOpen: false,
    _suggestions: [],
    _selectedIndex: 0,
    _container: null,
    _editor: null,
    _currentContext: null,

    /**
     * Initialize autocomplete for an editor element
     * @param {HTMLElement} editorElement - Monaco editor container or textarea
     */
    init(editorElement) {
        this._editor = editorElement;
        this._createDropdown();
        this._bindKeyboard();
        console.log('[SOQLAutocomplete] Initialized');
    },

    /**
     * Get suggestions based on current context
     * @param {string} query - Full SOQL query
     * @param {number} cursorPosition - Cursor position
     * @returns {Promise<Array<Suggestion>>}
     */
    async getSuggestions(query, cursorPosition) {
        const context = window.SOQLParser.getContext(query, cursorPosition);
        this._currentContext = context;
        
        let suggestions = [];

        switch (context.type) {
            case 'object':
                suggestions = await this._getObjectSuggestions(context.currentToken);
                break;
                
            case 'field':
            case 'relationship':
                suggestions = await this._getFieldSuggestions(context);
                break;
                
            case 'operator':
                suggestions = this._getOperatorSuggestions();
                break;
                
            case 'value':
                suggestions = await this._getValueSuggestions(context);
                break;
                
            case 'subquery':
                suggestions = [{ 
                    label: 'SELECT', 
                    insertText: 'SELECT Id FROM ', 
                    kind: 'keyword',
                    detail: 'Start subquery'
                }];
                break;
                
            default:
                suggestions = await this._getFieldSuggestions(context);
        }

        // Filter by current token
        if (context.currentToken) {
            const token = context.currentToken.toLowerCase();
            suggestions = suggestions.filter(s => 
                s.label.toLowerCase().includes(token) ||
                (s.detail && s.detail.toLowerCase().includes(token))
            );
            
            // Sort by relevance
            suggestions.sort((a, b) => {
                const aLabel = a.label.toLowerCase();
                const bLabel = b.label.toLowerCase();
                
                // Exact prefix match first
                const aStarts = aLabel.startsWith(token);
                const bStarts = bLabel.startsWith(token);
                if (aStarts && !bStarts) return -1;
                if (!aStarts && bStarts) return 1;
                
                // Then by position of match
                const aIndex = aLabel.indexOf(token);
                const bIndex = bLabel.indexOf(token);
                if (aIndex !== bIndex) return aIndex - bIndex;
                
                // Then standard before custom
                if (a.isCustom !== b.isCustom) return a.isCustom ? 1 : -1;
                
                return aLabel.localeCompare(bLabel);
            });
        }

        return suggestions.slice(0, 20); // Limit to 20 suggestions
    },

    /**
     * Get object suggestions for FROM clause
     * @private
     */
    async _getObjectSuggestions(filter) {
        if (!window.SchemaCache) return [];
        
        const objects = await window.SchemaCache.getObjectList();
        
        return objects.map(obj => ({
            label: obj.name,
            insertText: obj.name,
            detail: obj.label,
            kind: 'class',
            isCustom: obj.isCustom,
            documentation: obj.isCustom ? 'Custom Object' : 'Standard Object'
        }));
    },

    /**
     * Get field suggestions for SELECT/WHERE
     * @private
     */
    async _getFieldSuggestions(context) {
        if (!window.SchemaCache || !context.rootObject) {
            return this._getKeywordSuggestions();
        }

        let fields = [];

        // Handle relationship path
        if (context.relationshipPath) {
            fields = await window.SchemaCache.resolveRelationshipPath(
                context.rootObject, 
                context.relationshipPath
            );
        } else {
            fields = await window.SchemaCache.getFields(context.rootObject);
        }

        return fields.map(f => ({
            label: f.apiName,
            insertText: f.apiName,
            detail: f.label,
            kind: f.isRelationship ? 'reference' : 'field',
            type: f.type,
            isCustom: f.isCustom,
            isRelationship: f.isRelationship,
            relationshipTarget: f.referenceTo,
            documentation: this._formatFieldDoc(f),
            // Highlight matching characters will be done in render
        }));
    },

    /**
     * Get operator suggestions for WHERE clause
     * @private
     */
    _getOperatorSuggestions() {
        return [
            { label: '=', insertText: '= ', kind: 'operator', detail: 'Equals' },
            { label: '!=', insertText: '!= ', kind: 'operator', detail: 'Not equals' },
            { label: '<', insertText: '< ', kind: 'operator', detail: 'Less than' },
            { label: '>', insertText: '> ', kind: 'operator', detail: 'Greater than' },
            { label: '<=', insertText: '<= ', kind: 'operator', detail: 'Less than or equal' },
            { label: '>=', insertText: '>= ', kind: 'operator', detail: 'Greater than or equal' },
            { label: 'LIKE', insertText: "LIKE '%'", kind: 'operator', detail: 'Pattern match' },
            { label: 'IN', insertText: "IN ()", kind: 'operator', detail: 'In list' },
            { label: 'NOT IN', insertText: "NOT IN ()", kind: 'operator', detail: 'Not in list' },
            { label: 'INCLUDES', insertText: "INCLUDES ()", kind: 'operator', detail: 'Multi-select includes' },
            { label: 'EXCLUDES', insertText: "EXCLUDES ()", kind: 'operator', detail: 'Multi-select excludes' },
        ];
    },

    /**
     * Get value suggestions (bind variables, common values)
     * @private
     */
    async _getValueSuggestions(context) {
        const suggestions = [
            { label: 'null', insertText: 'null', kind: 'constant', detail: 'Null value' },
            { label: 'true', insertText: 'true', kind: 'constant', detail: 'Boolean true' },
            { label: 'false', insertText: 'false', kind: 'constant', detail: 'Boolean false' },
            { label: 'TODAY', insertText: 'TODAY', kind: 'constant', detail: 'Current date' },
            { label: 'YESTERDAY', insertText: 'YESTERDAY', kind: 'constant', detail: 'Previous day' },
            { label: 'TOMORROW', insertText: 'TOMORROW', kind: 'constant', detail: 'Next day' },
            { label: 'LAST_N_DAYS:n', insertText: 'LAST_N_DAYS:', kind: 'constant', detail: 'Last N days' },
            { label: 'NEXT_N_DAYS:n', insertText: 'NEXT_N_DAYS:', kind: 'constant', detail: 'Next N days' },
            { label: 'THIS_MONTH', insertText: 'THIS_MONTH', kind: 'constant', detail: 'Current month' },
            { label: 'THIS_YEAR', insertText: 'THIS_YEAR', kind: 'constant', detail: 'Current year' },
        ];
        
        return suggestions;
    },

    /**
     * Get keyword suggestions
     * @private
     */
    _getKeywordSuggestions() {
        return [
            { label: 'SELECT', insertText: 'SELECT ', kind: 'keyword' },
            { label: 'FROM', insertText: 'FROM ', kind: 'keyword' },
            { label: 'WHERE', insertText: 'WHERE ', kind: 'keyword' },
            { label: 'AND', insertText: 'AND ', kind: 'keyword' },
            { label: 'OR', insertText: 'OR ', kind: 'keyword' },
            { label: 'ORDER BY', insertText: 'ORDER BY ', kind: 'keyword' },
            { label: 'GROUP BY', insertText: 'GROUP BY ', kind: 'keyword' },
            { label: 'HAVING', insertText: 'HAVING ', kind: 'keyword' },
            { label: 'LIMIT', insertText: 'LIMIT ', kind: 'keyword' },
            { label: 'OFFSET', insertText: 'OFFSET ', kind: 'keyword' },
            { label: 'ASC', insertText: 'ASC', kind: 'keyword' },
            { label: 'DESC', insertText: 'DESC', kind: 'keyword' },
            { label: 'NULLS FIRST', insertText: 'NULLS FIRST', kind: 'keyword' },
            { label: 'NULLS LAST', insertText: 'NULLS LAST', kind: 'keyword' },
        ];
    },

    /**
     * Format field documentation
     * @private
     */
    _formatFieldDoc(field) {
        let doc = `Type: ${field.type}`;
        if (field.length) doc += ` (${field.length})`;
        if (field.isNillable) doc += ' | Nullable';
        if (field.isCustom) doc += ' | Custom';
        if (field.isRelationship && field.referenceTo) {
            doc += ` → ${field.referenceTo}`;
        }
        return doc;
    },

    /**
     * Create dropdown container
     * @private
     */
    _createDropdown() {
        if (this._container) return;
        
        this._container = document.createElement('div');
        this._container.className = 'soql-autocomplete-dropdown';
        this._container.style.cssText = `
            position: absolute;
            display: none;
            background: #1e1e1e;
            border: 1px solid #3c3c3c;
            border-radius: 4px;
            max-height: 300px;
            overflow-y: auto;
            z-index: 10000;
            min-width: 300px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            font-family: 'SF Mono', Consolas, monospace;
            font-size: 12px;
        `;
        document.body.appendChild(this._container);
    },

    /**
     * Show dropdown with suggestions
     * @param {Array<Suggestion>} suggestions
     * @param {number} x - X position
     * @param {number} y - Y position
     */
    show(suggestions, x, y) {
        if (!suggestions || suggestions.length === 0) {
            this.hide();
            return;
        }

        this._suggestions = suggestions;
        this._selectedIndex = 0;
        this._isOpen = true;

        this._container.innerHTML = suggestions.map((s, i) => `
            <div class="soql-autocomplete-item ${i === 0 ? 'selected' : ''}" data-index="${i}">
                <span class="soql-ac-icon ${s.kind}">${this._getIcon(s.kind)}</span>
                <span class="soql-ac-label">${this._highlightMatch(s.label, this._currentContext?.currentToken)}</span>
                ${s.detail ? `<span class="soql-ac-detail">${_escapeHtml(s.detail)}</span>` : ''}
                ${s.type ? `<span class="soql-ac-type">${_escapeHtml(s.type)}</span>` : ''}
            </div>
        `).join('');

        // Position dropdown
        this._container.style.left = `${x}px`;
        this._container.style.top = `${y}px`;
        this._container.style.display = 'block';

        // Bind click handlers
        this._container.querySelectorAll('.soql-autocomplete-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const index = parseInt(item.dataset.index);
                this._selectedIndex = index;
                this.accept();
            });
            item.addEventListener('mouseenter', () => {
                this._updateSelection(parseInt(item.dataset.index));
            });
        });
    },

    /**
     * Hide dropdown
     */
    hide() {
        this._isOpen = false;
        if (this._container) {
            this._container.style.display = 'none';
        }
    },

    /**
     * Accept current selection
     */
    accept() {
        if (!this._isOpen || this._suggestions.length === 0) return null;
        
        const selected = this._suggestions[this._selectedIndex];
        this.hide();
        return selected;
    },

    /**
     * Navigate selection
     * @param {number} delta - Direction (-1 up, +1 down)
     */
    navigate(delta) {
        if (!this._isOpen) return;
        
        const newIndex = Math.max(0, Math.min(
            this._suggestions.length - 1, 
            this._selectedIndex + delta
        ));
        this._updateSelection(newIndex);
    },

    /**
     * Update visual selection
     * @private
     */
    _updateSelection(index) {
        this._selectedIndex = index;
        const items = this._container.querySelectorAll('.soql-autocomplete-item');
        items.forEach((item, i) => {
            item.classList.toggle('selected', i === index);
        });
        
        // Scroll into view
        items[index]?.scrollIntoView({ block: 'nearest' });
    },

    /**
     * Get icon for suggestion type
     * @private
     */
    _getIcon(kind) {
        const icons = {
            field: '𝑓',
            reference: '→',
            class: '◆',
            keyword: '▪',
            operator: '⊕',
            constant: '◇',
        };
        return icons[kind] || '•';
    },

    /**
     * Highlight matching characters
     * @private
     */
    _highlightMatch(text, query) {
        if (!query) return _escapeHtml(text);
        
        const lowerText = text.toLowerCase();
        const lowerQuery = query.toLowerCase();
        const index = lowerText.indexOf(lowerQuery);
        
        if (index === -1) return _escapeHtml(text);
        
        return _escapeHtml(text.substring(0, index)) + 
               `<strong>${_escapeHtml(text.substring(index, index + query.length))}</strong>` +
               _escapeHtml(text.substring(index + query.length));
    },

    /**
     * Bind keyboard shortcuts
     * @private
     */
    _bindKeyboard() {
        document.addEventListener('keydown', (e) => {
            if (!this._isOpen) return;
            
            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    this.navigate(1);
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    this.navigate(-1);
                    break;
                case 'Enter':
                case 'Tab':
                    if (this._isOpen) {
                        e.preventDefault();
                        const selected = this.accept();
                        if (selected && this.onAccept) {
                            this.onAccept(selected);
                        }
                    }
                    break;
                case 'Escape':
                    this.hide();
                    break;
            }
        });
    },

    /**
     * Callback when suggestion is accepted
     * Set this to handle insertion
     */
    onAccept: null,

    /**
     * Check if dropdown is open
     */
    isOpen() {
        return this._isOpen;
    }
};

window.SOQLAutocomplete = SOQLAutocomplete;
