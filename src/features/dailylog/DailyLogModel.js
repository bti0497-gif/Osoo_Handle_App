import { apiClient } from '../../core/api';

const DAILY_WORK_LOG_TEMPLATES = ['일일업무일지'];

function getApiPrefix(templateName) {
    const normalized = String(templateName || '').trim();
    if (DAILY_WORK_LOG_TEMPLATES.includes(normalized)) {
        return '/api/daily-work-log';
    }
    return '/api/logs';
}

export const DailyLogModel = {
    async fetchAllData(date) {
        const [flows, medicines, waterQuality, facilities] = await Promise.all([
            apiClient.get('/api/flows', { date }),
            apiClient.get('/api/medicines', { date }),
            apiClient.get('/api/water-quality', { date }),
            apiClient.get('/api/facilities', { date }),
        ]);

        return { flows, medicines, waterQuality, facilities };
    },

    async fetchActiveDates(startDate, endDate, templateName, siteName) {
        if (!startDate || !endDate) return [];
        try {
            const result = await apiClient.get(`${getApiPrefix(templateName)}/active-dates`, {
                startDate,
                endDate,
                templateName,
                siteName,
            });
            if (result && result.activeDates && Array.isArray(result.activeDates)) {
                return result.activeDates;
            }
            return [];
        } catch (error) {
            console.error('Failed to fetch active dates:', error);
            return [];
        }
    },

    async fetchPreviewManifest(startDate, endDate, templateName, siteName) {
        const prefix = getApiPrefix(templateName);
        return apiClient.get(`${prefix}/preview-manifest`, { startDate, endDate, templateName, siteName });
    },

    async fetchPreviewPageData({ startDate, endDate, pageKey, templateName, siteName }) {
        const prefix = getApiPrefix(templateName);
        return apiClient.get(`${prefix}/preview-page-data`, { startDate, endDate, pageKey, templateName, siteName });
    },
    fetchExportExcel: async (dateString, templateName, siteName) => {
        let url;
        const encodedTemplateName = templateName ? encodeURIComponent(templateName) : '';
        const ranges = dateString.split(',');

        if (templateName === '일일업무일지') {
            const baseParam = `templateName=${encodedTemplateName}${siteName ? `&siteName=${encodeURIComponent(siteName)}` : ''}`;
            if (ranges.length === 1) {
                const encodedDate = encodeURIComponent(ranges[0].trim());
                url = `/api/daily-work-log/export?date=${encodedDate}&${baseParam}`;
            } else {
                const encodedStartDate = encodeURIComponent(ranges[0].trim());
                const encodedEndDate = encodeURIComponent(ranges[1].trim());
                url = `/api/daily-work-log/export?startDate=${encodedStartDate}&endDate=${encodedEndDate}&${baseParam}`;
            }
        } else {
            const baseParam = `templateName=${encodedTemplateName}${siteName ? `&siteName=${encodeURIComponent(siteName)}` : ''}`;
            if (ranges.length === 1) {
                const encodedDate = encodeURIComponent(ranges[0].trim());
                url = `/api/logs/export?date=${encodedDate}&${baseParam}`;
            } else {
                const encodedStartDate = encodeURIComponent(ranges[0].trim());
                const encodedEndDate = encodeURIComponent(ranges[1].trim());
                url = `/api/logs/export?startDate=${encodedStartDate}&endDate=${encodedEndDate}&${baseParam}`;
            }
        }

        // 서버에 요청 → 서버가 파일을 생성하고 시스템 Excel로 열어줌
        return apiClient.get(url);
    }
};
