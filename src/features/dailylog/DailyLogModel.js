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

    async fetchActiveDates(startDate, endDate, templateName, siteName, context = {}) {
        if (!startDate || !endDate) return [];
        try {
            const result = await apiClient.get(`${getApiPrefix(templateName)}/active-dates`, {
                startDate,
                endDate,
                templateName,
                siteName,
                ...context,
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

    async fetchPreviewManifest(startDate, endDate, templateName, siteName, context = {}) {
        const prefix = getApiPrefix(templateName);
        return apiClient.get(`${prefix}/preview-manifest`, { startDate, endDate, templateName, siteName, ...context });
    },

    async fetchPreviewPageData({ date, startDate, endDate, pageKey, templateName, siteName, ...context }) {
        const prefix = getApiPrefix(templateName);
        return apiClient.get(`${prefix}/preview-page-data`, { date, startDate, endDate, pageKey, templateName, siteName, ...context });
    },
    fetchExportExcel: async (dateString, templateName, siteName, context = {}) => {
        let url;
        const ranges = dateString.split(',');
        // Build one canonical query object. requestContext also contains siteName,
        // so concatenating both values creates duplicate query parameters and
        // Express turns req.query.siteName into an array.
        const baseParam = new URLSearchParams(
            Object.entries({ templateName, siteName, ...context })
                .filter(([, value]) => value != null && value !== '')
        ).toString();

        if (templateName === '일일업무일지') {
            if (ranges.length === 1) {
                const encodedDate = encodeURIComponent(ranges[0].trim());
                url = `/api/daily-work-log/export?date=${encodedDate}&${baseParam}`;
            } else {
                const encodedStartDate = encodeURIComponent(ranges[0].trim());
                const encodedEndDate = encodeURIComponent(ranges[1].trim());
                url = `/api/daily-work-log/export?startDate=${encodedStartDate}&endDate=${encodedEndDate}&${baseParam}`;
            }
        } else {
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
    },
    fetchExportPdf: async (dateString, templateName, siteName, context = {}) => {
        const ranges = dateString.split(',');
        const params = {
            templateName,
            siteName,
            ...context,
        };
        if (ranges.length === 1) {
            params.date = ranges[0].trim();
        } else {
            params.startDate = ranges[0].trim();
            params.endDate = ranges[1].trim();
        }
        return apiClient.get('/api/daily-work-log/export-pdf', params, { timeout: 300000 });
    },
    fetchExportHwp: async (dateString, templateName, siteName, context = {}) => {
        const ranges = dateString.split(',');
        const params = {
            templateName,
            siteName,
            ...context,
        };
        if (ranges.length === 1) {
            params.date = ranges[0].trim();
        } else {
            params.startDate = ranges[0].trim();
            params.endDate = ranges[1].trim();
        }
        return apiClient.get('/api/daily-work-log/export-hwp', params, { timeout: 300000 });
    },
};
