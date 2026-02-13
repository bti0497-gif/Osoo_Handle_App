const API_BASE_URL = 'http://localhost:8901';

export const DailyLogModel = {
    async fetchAllData(date) {
        const [flows, medicines, water, facilities] = await Promise.all([
            fetch(`${API_BASE_URL}/api/flows?date=${date}`).then(r => r.json()),
            fetch(`${API_BASE_URL}/api/medicines?date=${date}`).then(r => r.json()),
            fetch(`${API_BASE_URL}/api/water-quality?date=${date}`).then(r => r.json()),
            fetch(`${API_BASE_URL}/api/facilities?date=${date}`).then(r => r.json())
        ]);

        return { flows, medicines, waterQuality: water, facilities };
    }
};
