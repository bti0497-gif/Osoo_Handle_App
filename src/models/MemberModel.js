const API_BASE_URL = 'http://localhost:8901';

export const MemberModel = {
    async fetchMembers() {
        const response = await fetch(`${API_BASE_URL}/api/members`);
        if (!response.ok) throw new Error('Failed to fetch members');
        return await response.json();
    },

    async saveMember(data) {
        const response = await fetch(`${API_BASE_URL}/api/members`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Failed to save member');
        return result;
    }
};
