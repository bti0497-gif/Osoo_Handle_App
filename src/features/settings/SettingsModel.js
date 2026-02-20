import { apiClient } from '../../core/api';

export const SettingsModel = {
    async getSettings() {
        return apiClient.get('/api/settings');
    },

    async saveSettings(settingsData) {
        return apiClient.post('/api/settings', settingsData);
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

    async saveMedicineMapping(mappingData) {
        return apiClient.post('/api/settings/save-medicine-mapping', mappingData);
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
    }
};
