/**
 * SF-Intel Studio - Visual Log Parser
 * Parses raw Salesforce Debug Logs into a hierarchical execution tree (SIP-3.0).
 */

window.LogParser = {
    /**
     * Main entry point: Parses log text and returns a tree structure.
     */
    parse: function (logText) {
        if (!logText) return [];

        const lines = logText.split('\n');
        const root = { children: [], type: 'ROOT' };
        const stack = [root];

        // Comprehensive entry/exit events for proper nesting
        const entryEvents = [
            'METHOD_ENTRY', 'CODE_UNIT_STARTED', 'CONSTRUCTOR_ENTRY',
            'EXECUTION_STARTED', 'VF_APEX_CALL_START', 'SYSTEM_CONSTRUCTOR_ENTRY',
            'DML_BEGIN', 'SOQL_EXECUTE_BEGIN'
        ];
        const exitEvents = [
            'METHOD_EXIT', 'CODE_UNIT_FINISHED', 'CONSTRUCTOR_EXIT',
            'EXECUTION_FINISHED', 'VF_APEX_CALL_END', 'SYSTEM_CONSTRUCTOR_EXIT',
            'DML_END', 'SOQL_EXECUTE_END'
        ];

        lines.forEach(line => {
            const node = this._parseLine(line);
            if (!node) return;

            if (entryEvents.includes(node.event)) {
                const current = stack[stack.length - 1];
                current.children.push(node);
                stack.push(node);
            } else if (exitEvents.includes(node.event)) {
                // Add exit nodes as children of the block before popping, if they have content
                const current = stack[stack.length - 1];
                if (current && current.type !== 'ROOT') {
                    current.children.push(node);
                }
                if (stack.length > 1) stack.pop();
            } else {
                // Regular leaf node
                const current = stack[stack.length - 1];
                if (current) current.children.push(node);
            }
        });

        return root.children;
    },

    /**
     * Parses a single line using a regex to extract timestamp, event, and details.
     */
    _parseLine: function (line) {
        // Regex for Salesforce Log Header: Time (Nanosecs)|EVENT|LINE|ID|CONTENT
        const parts = line.split('|');
        if (parts.length < 2) return null;

        const header = parts[0].split(' ');
        const timestamp = header[0];
        const event = parts[1];

        // Skip common noisy events if they don't have useful data
        if (['STATEMENT_EXECUTE', 'VARIABLE_SCOPE_BEGIN', 'VARIABLE_ASSIGNMENT'].includes(event)) return null;

        return {
            timestamp,
            event,
            lineNumber: parts[2] ? parts[2].replace('[', '').replace(']', '') : null,
            details: parts.slice(3).join(' | '),
            children: []
        };
    },

    /**
     * Renders the tree into HTML for the Problems/Logs panel.
     */
    renderTree: function (nodes, container) {
        if (!nodes || nodes.length === 0) {
            container.innerHTML = '<div class="no-data">No execution hierarchy found in logs.</div>';
            return;
        }

        const buildHtml = (nodeList, isRoot = false) => {
            const listClass = isRoot ? 'log-tree-root' : 'log-node-children';
            return `<ul class="${listClass}">${nodeList.map(node => `
                <li class="log-node ${node.children.length > 0 ? 'has-children' : ''}" data-line="${node.lineNumber}">
                    <div class="log-row">
                        <span class="log-time">${node.timestamp}</span>
                        <span class="log-event badge ${node.event.toLowerCase().replace(/_/g, '-')}">${node.event}</span>
                        <span class="log-details">${this._sanitizeDetails(node.details)}</span>
                    </div>
                    ${node.children.length > 0 ? buildHtml(node.children) : ''}
                </li>
            `).join('')}</ul>`;
        };

        container.innerHTML = `<div class="log-tree-wrapper">${buildHtml(nodes, true)}</div>`;

        // Event Delegation for Expansion (CSP Compliant)
        container.addEventListener('click', (e) => {
            const row = e.target.closest('.log-row');
            if (row) {
                const node = row.closest('.log-node');
                if (node) node.classList.toggle('expanded');
            }
        });
    },

    _sanitizeDetails: function (details) {
        if (!details) return '';
        return details.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
};
