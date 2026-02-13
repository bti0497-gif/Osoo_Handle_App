const API_BASE_URL = 'http://localhost:8901';

export const FlowModel = {
    async fetchReadings(date) {
        const response = await fetch(`${API_BASE_URL}/api/flows?date=${date}`);
        if (!response.ok) throw new Error('Failed to fetch flow readings');
        return await response.json();
    },

    async saveReading(data) {
        const response = await fetch(`${API_BASE_URL}/api/flows`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Failed to save flow reading');
        return result;
    }
};
