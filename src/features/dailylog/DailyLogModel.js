import { apiClient } from '../../core/api';

export const DailyLogModel = {
    async fetchAllData(date) {
        const [flows, medicines, waterQuality, facilities] = await Promise.all([
            apiClient.get('/api/flows', { date }),
            apiClient.get('/api/medicines', { date }),
            apiClient.get('/api/water-quality', { date }),
            apiClient.get('/api/facilities', { date }),
        ]);

        return { flows, medicines, waterQuality, facilities };
    }
};
