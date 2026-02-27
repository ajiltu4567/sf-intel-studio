/**
 * automation-inspector-flow.js
 * Flow element enrichment: decision outcomes, loop iteration counts, fault paths.
 * Loaded before automation-inspector.js — adds window.FlowAnalysisHelper.
 */
window.FlowAnalysisHelper = {

    ELEMENT_ICONS: {
        Decision:           '◇',
        Loop:               '↺',
        RecordCreate:       '+',
        RecordUpdate:       '✎',
        RecordDelete:       '✕',
        RecordLookup:       '⌕',
        Screen:             '▭',
        ActionCall:         '⚡',
        ApexPluginCall:     '⚡',
        Assignment:         '≔',
        Subflow:            '⤵',
        Wait:               '⏸',
        CollectionProcessor:'⚙',
        OrchestratorStep:   '◈',
    },

    /**
     * Called once per log line from _summarizeLiveLog().
     * Returns true if the line was matched (so caller can set lineMatched = true).
     */
    processLine(line, result) {
        let matched = false;

        // ── FLOW_RULE_ENTRY: which Decision outcome was taken ──────────────
        // Format: timestamp|...|FLOW_RULE_ENTRY|flowName|decisionName|outcomeName
        if (line.includes('|FLOW_RULE_ENTRY|')) {
            matched = true;
            const m = line.match(/\|FLOW_RULE_ENTRY\|([^|]+)\|([^|]+)\|(.+?)$/);
            if (m) {
                const flowName = m[1].trim();
                const decisionName = m[2].trim();
                const outcomeName = m[3].trim();
                // Attach to the most recently started Decision element for this flow
                const elem = [...result.flowElements].reverse().find(e =>
                    e.flowName === flowName && e.elementName === decisionName
                );
                if (elem) {
                    elem.outcome = outcomeName;
                } else {
                    // Element not seen yet — queue for resolution after parse loop
                    if (!result._pendingOutcomes) result._pendingOutcomes = [];
                    result._pendingOutcomes.push({ flowName, decisionName, outcomeName });
                }
            }
        }

        // ── FLOW_LOOP_NEXT: one iteration completed ────────────────────────
        // Format: timestamp|...|FLOW_LOOP_NEXT|flowName|loopName
        if (line.includes('|FLOW_LOOP_NEXT|')) {
            matched = true;
            const m = line.match(/\|FLOW_LOOP_NEXT\|([^|]+)\|(.+?)$/);
            if (m) {
                const flowName = m[1].trim();
                const loopName = m[2].trim();
                const elem = [...result.flowElements].reverse().find(e =>
                    e.flowName === flowName && e.elementName === loopName
                );
                if (elem) elem.iterationCount = (elem.iterationCount || 0) + 1;
            }
        }

        // ── FLOW_ELEMENT_FAULT: fault connector executed ───────────────────
        // Format: timestamp|...|FLOW_ELEMENT_FAULT|flowName|elementType|elementName|faultMessage
        if (line.includes('|FLOW_ELEMENT_FAULT|')) {
            matched = true;
            const m = line.match(/\|FLOW_ELEMENT_FAULT\|([^|]+)\|([^|]+)\|([^|]+)\|(.+?)$/);
            if (m) {
                const flowName = m[1].trim();
                const elementName = m[3].trim();
                const faultMessage = m[4].trim();
                const elem = [...result.flowElements].reverse().find(e =>
                    e.flowName === flowName && e.elementName === elementName
                );
                if (elem) {
                    elem.isFault = true;
                    elem.faultMessage = faultMessage;
                    elem.status = 'faulted';
                }
            }
        }

        return matched;
    },

    /**
     * Called once at the end of _summarizeLiveLog(), after the parse loop.
     * Resolves any pending outcomes that were emitted before the element was seen.
     */
    resolvePostParse(result) {
        if (!result._pendingOutcomes) return;
        result._pendingOutcomes.forEach(({ flowName, decisionName, outcomeName }) => {
            const elem = result.flowElements.find(e =>
                e.flowName === flowName && e.elementName === decisionName
            );
            if (elem) elem.outcome = outcomeName;
        });
        delete result._pendingOutcomes;
    },

    /**
     * Renders the element trail for a single flow.
     * Returns an HTML string, or '' if no elements for this flow.
     * Called from renderLiveTraceAutomations() in automation-inspector.js.
     */
    renderFlowElements(flowName, allElements, escFn) {
        const elements = allElements.filter(e => e.flowName === flowName);
        if (elements.length === 0) return '';

        const icon = type => this.ELEMENT_ICONS[type] || '▸';

        const rows = elements.map(fe => {
            const statusColor = fe.isFault ? '#e74c3c' : fe.status === 'completed' ? '#2ecc71' : '#f39c12';
            return `
                <div class="flow-el-row${fe.isFault ? ' flow-el-row--fault' : ''}">
                    <span class="flow-el-icon" title="${escFn(fe.elementType)}">${icon(fe.elementType)}</span>
                    <span class="flow-el-name">${escFn(fe.elementName)}</span>
                    <span class="flow-el-type">${escFn(fe.elementType)}</span>
                    <span class="flow-el-status" style="color:${statusColor};">${fe.status}</span>
                    ${fe.outcome ? `<span class="flow-el-outcome">→ ${escFn(fe.outcome)}</span>` : ''}
                    ${fe.iterationCount != null ? `<span class="flow-el-iterations">×${fe.iterationCount}</span>` : ''}
                    ${fe.isFault ? `<span class="flow-el-fault-badge">FAULT</span>` : ''}
                </div>
                ${fe.isFault && fe.faultMessage ? `
                    <div class="flow-el-fault-msg">${escFn(fe.faultMessage)}</div>
                ` : ''}`;
        }).join('');

        const hasFault = elements.some(e => e.isFault);
        const decisions = elements.filter(e => e.elementType === 'Decision');
        const loops = elements.filter(e => e.elementType === 'Loop');

        const summary = [
            `${elements.length} element${elements.length !== 1 ? 's' : ''}`,
            decisions.length > 0 ? `${decisions.length} decision${decisions.length !== 1 ? 's' : ''}` : '',
            loops.length > 0 ? `${loops.map(l => `${l.iterationCount || 0}× ${escFn(l.elementName)}`).join(', ')}` : '',
            hasFault ? `<span style="color:#e74c3c;">fault path taken</span>` : '',
        ].filter(Boolean).join(' · ');

        return `
            <div class="flow-el-trail">
                <div class="flow-el-summary">${summary}</div>
                <div class="flow-el-list">${rows}</div>
            </div>`;
    },
};
