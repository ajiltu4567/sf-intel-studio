/**
 * SF-Intel Studio - Workflow API Module
 * Specialized impact analysis logic for the Workflow Emulator.
 */

(function () {
    console.log('[SF-Intel] Initializing Workflow API Module...');

    window.extendApiClientWithWorkflowMethods = function (client) {
        if (!client) return;

        /**
         * Fetch a snapshot of related records for impact analysis
         */
        client.fetchImpactSnapshot = async function (sourceRecordId, rules) {
            const results = {};

            for (const rule of rules) {
                try {
                    const fields = rule.targetFields.join(', ');
                    // Include LastModifiedById for forensic modifier classification
                    const query = `SELECT Id, LastModifiedDate, LastModifiedById, ${fields} FROM ${rule.targetObject} WHERE ${rule.relationship} = '${sourceRecordId}' ORDER BY LastModifiedDate DESC LIMIT 100`;
                    const res = await this.query(query);
                    results[rule.targetObject] = res.records || [];
                } catch (err) {
                    try {
                        const query = `SELECT Id, LastModifiedDate, LastModifiedById FROM ${rule.targetObject} WHERE ${rule.relationship} = '${sourceRecordId}' ORDER BY LastModifiedDate DESC LIMIT 100`;
                        const res = await this.query(query);
                        results[rule.targetObject] = res.records || [];
                    } catch (inner) {
                        // Silently skip
                    }
                }
            }
            return results;
        };


        /**
         * Fetch full automation inventory for an object (Triggers, Flows, VRs)
         * Used for high-fidelity attribution and negative causality detection.
         */
        client.getAutomationInventory = async function (objectType) {
            const inventory = {
                triggers: [],
                flows: [],
                validationRules: []
            };

            try {
                // 1. Apex Triggers
                const triggerQuery = `SELECT Name, Status, UsageAfterUpdate, UsageBeforeUpdate, UsageAfterInsert, UsageBeforeInsert FROM ApexTrigger WHERE TableEnumOrId = '${objectType}' AND Status = 'Active'`;
                const triggerRes = await this.toolingQuery(triggerQuery);
                inventory.triggers = triggerRes.records || [];

                // 2. Record-Triggered Flows (FlowDefinitionView is high-performance for discovery)
                const flowQuery = `SELECT Label, ApiName, TriggerType, Status FROM FlowDefinitionView WHERE TriggerObjectOrEventId = '${objectType}' AND Status = 'Active' AND ProcessType = 'Workflow'`;
                const flowRes = await this.toolingQuery(flowQuery);
                inventory.flows = flowRes.records || [];

                // 3. Validation Rules
                const vrQuery = `SELECT ValidationName, ErrorMessage, Active FROM ValidationRule WHERE EntityDefinition.QualifiedApiName = '${objectType}' AND Active = true`;
                const vrRes = await this.toolingQuery(vrQuery);
                inventory.validationRules = vrRes.records || [];

            } catch (err) {
                console.warn(`[SF-Intel] Failed to fetch full inventory for ${objectType}:`, err);
                // Fallback to just triggers if toolings fail partially
            }

            return inventory;
        };
    };
})();
