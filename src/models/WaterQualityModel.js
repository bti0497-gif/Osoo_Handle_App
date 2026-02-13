const API_BASE_URL = 'http://localhost:8901';

export const WaterQualityModel = {
    async fetchData(date) {
        const response = await fetch(`${API_BASE_URL}/api/water-quality?date=${date}`);
        if (!response.ok) throw new Error('Failed to fetch water quality data');
        return await response.json();
    },

    async saveRecord(data) {
        const response = await fetch(`${API_BASE_URL}/api/water-quality`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Failed to save water quality record');
        return result;
    }
};
