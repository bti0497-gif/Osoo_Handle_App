import { apiClient, supabase } from '../../core/api';

export const SettingsModel = {
    async getSettings() {
        return apiClient.get('/api/settings');
    },

    async saveSettings(settingsData) {
        return apiClient.post('/api/settings', settingsData);
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

    async syncSettingsToSupabase() {
        try {
            const { success, settings, configItems } = await this.getSettings();
            if (!success) return { success: false, message: '로컬 설정을 가져오지 못했습니다.' };

            if (settings) {
                const { error: setErr } = await supabase
                    .from('app_settings')
                    .upsert({ ...settings, id: 1 });
                if (setErr) console.error('Supabase app_settings error:', setErr);
            }

            if (configItems && configItems.length > 0) {
                const { error: confErr } = await supabase
                    .from('config_items')
                    .upsert(configItems.map(item => ({
                        category: item.category,
                        item_name: item.item_name,
                        is_active: item.is_active,
                        display_order: item.display_order,
                        excel_cell: item.excel_cell || null
                    })), { onConflict: 'category,item_name' });
                if (confErr) console.error('Supabase config_items error:', confErr);
            }

            return { success: true };
        } catch (err) {
            console.error('Settings Sync Error:', err);
            return { success: false, message: err.message };
        }
    }
};
