import { apiClient } from '../../core/api';

export const SettingsModel = {
    async getSettings() {
        return apiClient.get('/api/settings');
    },

    async getSites() {
        return apiClient.get('/api/settings/sites');
    },

    async selectSite(siteId) {
        return apiClient.post('/api/settings/select-site', { siteId });
    },

    async saveSettings(settingsData) {
        return apiClient.post('/api/settings', settingsData);
    },

    async saveSiteLocation(targetLat, targetLng) {
        return apiClient.post('/api/settings/site-location', { targetLat, targetLng });
    },

    async saveWebAppCredentials(payload) {
        return apiClient.post('/api/settings/web-app-credentials', payload);
    },

    async saveQntechImportSettings(payload) {
        return apiClient.post('/api/settings/qntech-import-settings', payload);
    },

    async uploadFiles(formData) {
        return apiClient.upload('/api/settings/upload', formData);
    },

    async getExcelPreview(sheet, row) {
        return apiClient.post('/api/settings/excel-preview', { sheet, row });
    },

    async saveFlowMapping(mappingData) {
        return apiClient.post('/api/settings/save-flow-mapping', mappingData);
    },

    async saveKitMapping(mappingData) {
        return apiClient.post('/api/settings/save-kit-mapping', mappingData);
    },
    async saveWaterMapping(mappingData) {
        return apiClient.post('/api/settings/save-water-mapping', mappingData);
    },

    async saveMedicineMapping(mappingData) {
        return apiClient.post('/api/settings/save-medicine-mapping', mappingData);
    },

    async saveFlowOption(flowOption) {
        return apiClient.post('/api/settings/save-flow-option', { flowOption });
    },

    async getSludgeExportSettings() {
        return apiClient.get('/api/settings/sludge-export-settings');
    },

    async saveSludgeExportSettings(payload) {
        return apiClient.post('/api/settings/sludge-export-settings', payload);
    },

    async getMedicineDefaults() {
        return apiClient.get('/api/settings/medicine-defaults');
    },

    async saveMedicineDefaults(items) {
        return apiClient.post('/api/settings/medicine-defaults', { items });
    },

    async getKitDefaults() {
        return apiClient.get('/api/settings/kit-defaults');
    },

    async saveKitDefaults(items) {
        return apiClient.post('/api/settings/kit-defaults', { items });
    },

    async getExcelStatus() {
        return apiClient.get('/api/settings/excel-status');
    },

    async getImportProgress() {
        return apiClient.get('/api/settings/import-progress');
    },

    async addConfigItem(category, name) {
        return apiClient.post('/api/settings/add-item', { category, name });
    },

    async toggleConfigItem(category, name, isActive) {
        return apiClient.post('/api/settings/toggle-item', { category, name, isActive });
    },
};
