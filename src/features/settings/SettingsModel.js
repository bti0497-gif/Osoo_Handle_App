import { apiClient } from '../../core/api';

let settingsCache = null;
let settingsPromise = null;

const clearSettingsCache = () => {
    settingsCache = null;
    settingsPromise = null;
};

const mutateSettings = async (request) => {
    clearSettingsCache();
    return request();
};

export const SettingsModel = {
    async getSettings(options = {}) {
        if (!options.force && settingsCache) {
            return settingsCache;
        }

        if (!options.force && settingsPromise) {
            return settingsPromise;
        }

        settingsPromise = apiClient.get('/api/settings')
            .then((result) => {
                settingsCache = result;
                return result;
            })
            .finally(() => {
                settingsPromise = null;
            });

        return settingsPromise;
    },

    clearSettingsCache() {
        clearSettingsCache();
    },

    async getSites() {
        return apiClient.get('/api/settings/sites');
    },

    async selectSite(siteId) {
        return mutateSettings(() => apiClient.post('/api/settings/select-site', { siteId }));
    },

    async saveSettings(settingsData) {
        return mutateSettings(() => apiClient.post('/api/settings', settingsData));
    },

    async saveSiteLocation(targetLat, targetLng) {
        return mutateSettings(() => apiClient.post('/api/settings/site-location', { targetLat, targetLng }));
    },

    async saveWebAppCredentials(payload) {
        return mutateSettings(() => apiClient.post('/api/settings/web-app-credentials', payload));
    },

    async saveQntechImportSettings(payload) {
        return mutateSettings(() => apiClient.post('/api/settings/qntech-import-settings', payload));
    },

    async uploadFiles(formData) {
        return mutateSettings(() => apiClient.upload('/api/settings/upload', formData));
    },

    async openLocalFolder(target) {
        return apiClient.post('/api/settings/open-local-folder', { target });
    },

    async getExcelPreview(sheet, row) {
        return apiClient.post('/api/settings/excel-preview', { sheet, row });
    },

    async saveFlowMapping(mappingData) {
        return mutateSettings(() => apiClient.post('/api/settings/save-flow-mapping', mappingData));
    },

    async saveKitMapping(mappingData) {
        return mutateSettings(() => apiClient.post('/api/settings/save-kit-mapping', mappingData));
    },
    async saveWaterMapping(mappingData) {
        return mutateSettings(() => apiClient.post('/api/settings/save-water-mapping', mappingData));
    },

    async saveMedicineMapping(mappingData) {
        return mutateSettings(() => apiClient.post('/api/settings/save-medicine-mapping', mappingData));
    },

    async saveFlowOption(flowOption) {
        return mutateSettings(() => apiClient.post('/api/settings/save-flow-option', { flowOption }));
    },

    async getSludgeExportSettings() {
        return apiClient.get('/api/settings/sludge-export-settings');
    },

    async saveSludgeExportSettings(payload) {
        return mutateSettings(() => apiClient.post('/api/settings/sludge-export-settings', payload));
    },

    async getMedicineDefaults() {
        return apiClient.get('/api/settings/medicine-defaults');
    },

    async saveMedicineDefaults(items) {
        return mutateSettings(() => apiClient.post('/api/settings/medicine-defaults', { items }));
    },

    async getKitDefaults() {
        return apiClient.get('/api/settings/kit-defaults');
    },

    async saveKitDefaults(items) {
        return mutateSettings(() => apiClient.post('/api/settings/kit-defaults', { items }));
    },

    async getExcelStatus() {
        return apiClient.get('/api/settings/excel-status');
    },

    async getImportProgress() {
        return apiClient.get('/api/settings/import-progress');
    },

    async addConfigItem(category, name) {
        return mutateSettings(() => apiClient.post('/api/settings/add-item', { category, name }));
    },

    async toggleConfigItem(category, name, isActive) {
        return mutateSettings(() => apiClient.post('/api/settings/toggle-item', { category, name, isActive }));
    },
};
