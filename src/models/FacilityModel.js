const API_BASE_URL = 'http://localhost:8901';

export const FacilityModel = {
    async fetchLogs(date) {
        const response = await fetch(`${API_BASE_URL}/api/facilities?date=${date}`);
        if (!response.ok) throw new Error('Failed to fetch facility logs');
        return await response.json();
    },

    async saveLog(data) {
        const response = await fetch(`${API_BASE_URL}/api/facilities`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Failed to save facility log');
        return result;
    }
};
