import { apiClient } from '../core/api';

export const StatusBarModel = {
    getSystemStatus: () => apiClient.get('/api/auth/system-status', { timeout: 5000 }),
};
