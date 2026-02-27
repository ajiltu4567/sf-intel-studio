/**
 * SF-Intel Studio - SOQL Parser Module
 * Parses SOQL queries to detect cursor context for autocomplete
 * 
 * @module SOQLParser
 */

const SOQLParser = {
    // SOQL keywords for detection
    KEYWORDS: ['SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 
               'ORDER', 'BY', 'ASC', 'DESC', 'NULLS', 'FIRST', 'LAST',
               'GROUP', 'HAVING', 'LIMIT', 'OFFSET', 'FOR', 'UPDATE', 'TYPEOF'],
    
    OPERATORS: ['=', '!=', '<', '>', '<=', '>=', 'LIKE', 'IN', 'NOT IN', 'INCLUDES', 'EXCLUDES'],
    
    AGGREGATE_FUNCTIONS: ['COUNT', 'COUNT_DISTINCT', 'SUM', 'AVG', 'MIN', 'MAX', 'GROUP BY', 'HAVING'],

    /**
     * Parse SOQL and return context at cursor position
     * @param {string} query - Full SOQL query
     * @param {number} cursorPosition - Character position in query
     * @returns {SOQLContext}
     */
    getContext(query, cursorPosition) {
        const context = {
            type: 'unknown',          // 'field', 'object', 'operator', 'value', 'relationship'
            rootObject: null,         // FROM object
            currentToken: '',         // Partial text being typed
            relationshipPath: null,   // For dot notation
            inSubquery: false,
            clauseType: null,         // 'select', 'from', 'where', 'orderby', etc.
            fieldsBefore: [],         // Fields already selected (for WHERE context)
        };

        if (!query || cursorPosition < 0) return context;

        const beforeCursor = query.substring(0, cursorPosition);
        const upperQuery = query.toUpperCase();
        const upperBefore = beforeCursor.toUpperCase();

        // Detect subquery
        const openParens = (beforeCursor.match(/\(/g) || []).length;
        const closeParens = (beforeCursor.match(/\)/g) || []).length;
        context.inSubquery = openParens > closeParens;

        // Extract root object from FROM clause
        context.rootObject = this._extractFromObject(query);

        // Determine clause type based on position
        context.clauseType = this._determineClauseType(upperBefore);

        // Get current token (word being typed)
        context.currentToken = this._getCurrentToken(beforeCursor);

        // Check for relationship traversal (dot notation)
        if (context.currentToken.includes('.')) {
            const parts = context.currentToken.split('.');
            context.relationshipPath = parts.slice(0, -1).join('.');
            context.currentToken = parts[parts.length - 1];
            context.type = 'relationship';
        } else {
            // Determine context type based on clause and position
            context.type = this._determineContextType(beforeCursor, context.clauseType);
        }

        // Extract already selected fields
        if (context.clauseType === 'where' || context.clauseType === 'orderby') {
            context.fieldsBefore = this._extractSelectFields(query);
        }

        return context;
    },

    /**
     * Extract FROM object from query
     * @private
     */
    _extractFromObject(query) {
        const fromMatch = query.match(/FROM\s+(\w+)/i);
        return fromMatch ? fromMatch[1] : null;
    },

    /**
     * Determine which clause the cursor is in
     * @private
     */
    _determineClauseType(upperBefore) {
        // Find the last keyword before cursor
        const keywords = [
            { keyword: 'ORDER BY', type: 'orderby' },
            { keyword: 'GROUP BY', type: 'groupby' },
            { keyword: 'HAVING', type: 'having' },
            { keyword: 'LIMIT', type: 'limit' },
            { keyword: 'OFFSET', type: 'offset' },
            { keyword: 'WHERE', type: 'where' },
            { keyword: 'FROM', type: 'from' },
            { keyword: 'SELECT', type: 'select' }
        ];

        let lastFound = { pos: -1, type: 'select' };
        
        for (const kw of keywords) {
            const pos = upperBefore.lastIndexOf(kw.keyword);
            if (pos > lastFound.pos) {
                lastFound = { pos, type: kw.type };
            }
        }

        return lastFound.type;
    },

    /**
     * Get the current token being typed
     * @private
     */
    _getCurrentToken(beforeCursor) {
        // Match word characters, dots (for relationships), and underscores
        const match = beforeCursor.match(/[\w.]+$/);
        return match ? match[0] : '';
    },

    /**
     * Determine context type for autocomplete
     * @private
     */
    _determineContextType(beforeCursor, clauseType) {
        const trimmed = beforeCursor.trimEnd();
        const lastChar = trimmed.slice(-1);
        
        // After comma -> field
        if (lastChar === ',') return 'field';
        
        // After open paren in subquery -> could be subquery start
        if (lastChar === '(') {
            // Check if it's a subquery: (SELECT
            return 'subquery';
        }
        
        // After operators -> value
        if (/[=<>!]\s*$/.test(trimmed) || /\bIN\s*\(\s*$/i.test(trimmed)) {
            return 'value';
        }
        
        // After AND/OR -> field for condition
        if (/\b(AND|OR)\s+$/i.test(trimmed)) {
            return 'field';
        }

        // Based on clause type
        switch (clauseType) {
            case 'select':
                return 'field';
            case 'from':
                return 'object';
            case 'where':
                // Check if we just typed a field and need operator
                if (/\w+\s*$/i.test(trimmed) && !/[=<>!]/.test(trimmed.slice(-10))) {
                    return 'operator';
                }
                return 'field';
            case 'orderby':
            case 'groupby':
                return 'field';
            default:
                return 'field';
        }
    },

    /**
     * Extract fields from SELECT clause
     * @private
     */
    _extractSelectFields(query) {
        const selectMatch = query.match(/SELECT\s+([\s\S]*?)FROM/i);
        if (!selectMatch) return [];
        
        return selectMatch[1]
            .split(',')
            .map(f => f.trim())
            .filter(f => f.length > 0);
    },

    /**
     * Validate a field exists on the object
     * @param {string} objectName
     * @param {string} fieldName
     * @returns {Promise<{valid: boolean, message: string}>}
     */
    async validateField(objectName, fieldName) {
        if (!window.SchemaCache) {
            return { valid: true, message: '' };
        }

        // Handle relationship paths
        if (fieldName.includes('.')) {
            const parts = fieldName.split('.');
            let currentObject = objectName;
            
            for (let i = 0; i < parts.length - 1; i++) {
                const target = await window.SchemaCache.getRelationshipTarget(currentObject, parts[i]);
                if (!target) {
                    return {
                        valid: false,
                        message: `Invalid relationship: ${parts[i]} on ${currentObject}`
                    };
                }
                currentObject = target;
            }
            
            // Validate final field
            const fields = await window.SchemaCache.getFields(currentObject);
            const finalField = parts[parts.length - 1];
            const found = fields.find(f => f.apiName.toLowerCase() === finalField.toLowerCase());
            
            if (!found) {
                return {
                    valid: false,
                    message: `Field '${finalField}' does not exist on ${currentObject}`
                };
            }
            return { valid: true, field: found };
        }

        // Simple field
        const fields = await window.SchemaCache.getFields(objectName);
        const found = fields.find(f => f.apiName.toLowerCase() === fieldName.toLowerCase());
        
        if (!found) {
            return {
                valid: false,
                message: `Field '${fieldName}' does not exist on ${objectName}`
            };
        }
        return { valid: true, field: found };
    },

    /**
     * Parse and validate entire SOQL query
     * @param {string} query
     * @returns {Promise<Array<{type: string, message: string, start: number, end: number}>>}
     */
    async validateQuery(query) {
        const errors = [];
        const rootObject = this._extractFromObject(query);
        
        if (!rootObject) {
            const fromPos = query.toUpperCase().indexOf('FROM');
            if (fromPos === -1) {
                errors.push({
                    type: 'error',
                    message: 'Missing FROM clause',
                    start: 0,
                    end: query.length
                });
            }
            return errors;
        }

        // Validate object exists
        if (window.SchemaCache) {
            try {
                const fields = await window.SchemaCache.getFields(rootObject);
                if (fields.length === 0) {
                    const fromMatch = query.match(/FROM\s+(\w+)/i);
                    if (fromMatch) {
                        const start = fromMatch.index + 5;
                        errors.push({
                            type: 'error',
                            message: `Unknown object: ${rootObject}`,
                            start,
                            end: start + rootObject.length
                        });
                    }
                }
            } catch (e) {
                // Object doesn't exist
            }
        }

        // Validate fields in SELECT
        const selectFields = this._extractSelectFields(query);
        const selectMatch = query.match(/SELECT\s+/i);
        let fieldStartPos = selectMatch ? selectMatch.index + selectMatch[0].length : 0;
        
        for (const field of selectFields) {
            if (!field || field === '*') continue;
            
            // Skip aggregate functions
            if (/^(COUNT|SUM|AVG|MIN|MAX|COUNT_DISTINCT)\s*\(/i.test(field)) continue;
            
            const validation = await this.validateField(rootObject, field);
            if (!validation.valid) {
                errors.push({
                    type: 'warning',
                    message: validation.message,
                    start: fieldStartPos,
                    end: fieldStartPos + field.length
                });
            }
            fieldStartPos += field.length + 1; // +1 for comma
        }

        // Check for LIMIT
        if (!/\bLIMIT\b/i.test(query)) {
            errors.push({
                type: 'warning',
                message: 'Consider adding LIMIT to prevent large result sets',
                start: query.length - 1,
                end: query.length
            });
        }

        return errors;
    }
};

window.SOQLParser = SOQLParser;
