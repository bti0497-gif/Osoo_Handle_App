const API_BASE_URL = 'http://localhost:8901';

export const MedicineModel = {
    async fetchLogs(date) {
        const response = await fetch(`${API_BASE_URL}/api/medicines?date=${date}`);
        if (!response.ok) throw new Error('Failed to fetch medicine logs');
        return await response.json();
    },

    async saveLog(data) {
        const response = await fetch(`${API_BASE_URL}/api/medicines`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Failed to save medicine log');
        return result;
    }
};
