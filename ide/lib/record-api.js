/**
 * SF-Intel Studio - Record API Module
 * Modular extension for SalesforceAPIClient to handle Record CRUD without touching the core file.
 */

(function () {
    console.log('[SF-Intel] Initializing Record API Module...');

    /**
     * Extends the global apiClient with record-specific methods
     */
    window.extendApiClientWithRecordMethods = function (client) {
        if (!client) return;

        /**
         * Fetch a single record with all field values
         */
        client.getRecord = async function (sobjectName, recordId) {
            const endpoint = `/services/data/${this.apiVersion}/sobjects/${sobjectName}/${recordId}`;
            return this.rest(endpoint);
        };

        /**
         * Update specific fields on a record (PATCH)
         */
        client.updateRecord = async function (sobjectName, recordId, fields) {
            const endpoint = `/services/data/${this.apiVersion}/sobjects/${sobjectName}/${recordId}`;
            return this.rest(endpoint, {
                method: 'PATCH',
                body: fields
            });
        };

        /**
         * Fetch child records based on a relationship query
         */
        client.getRelatedRecords = async function (query) {
            return this.query(query);
        };

        /**
         * Search for records by Name field
         */
        client.searchRecords = async function (sobjectName, searchTerm) {
            if (!searchTerm || searchTerm.length < 2) return [];
            const query = `SELECT Id, Name FROM ${sobjectName} WHERE Name LIKE '%${searchTerm}%' ORDER BY LastModifiedDate DESC LIMIT 10`;
            const result = await this.query(query);
            return result.records || [];
        };

        /**
         * Fetch recently modified records for a specific object
         */
        client.getRecentRecords = async function (sobjectName) {
            const query = `SELECT Id, Name, LastModifiedDate FROM ${sobjectName} ORDER BY LastModifiedDate DESC LIMIT 5`;
            const result = await this.query(query);
            return result.records || [];
        };

        console.log('[SF-Intel] Record API methods attached to apiClient.');
    };
})();
