import { apiClient } from '../../core/api';

const DAILY_WORK_LOG_TEMPLATES = ['일일업무일지'];

function getApiPrefix(templateName) {
    const normalized = String(templateName || '').trim();
    if (DAILY_WORK_LOG_TEMPLATES.includes(normalized)) {
        return '/api/daily-work-log';
    }
    return '/api/logs';
}

const previewPdfBlobUrlCache = new Map();
const previewPdfRequestCache = new Map();
const PREVIEW_PDF_URL_VERSION = '2026-03-10-photo-frame-v8';

function buildAbsoluteApiUrl(endpoint, params = {}) {
    const searchParams = new URLSearchParams();

    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            searchParams.set(key, value);
        }
    });

    searchParams.set('previewVersion', PREVIEW_PDF_URL_VERSION);

    const query = searchParams.toString();
    return `${apiClient.getBaseUrl()}${endpoint}${query ? `?${query}` : ''}`;
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

    getPreviewPdfUrl(date, templateName) {
        const params = new URLSearchParams();

        if (date) {
            params.set('date', date);
        }

        if (templateName) {
            params.set('templateName', templateName);
        }

        return `${apiClient.getBaseUrl()}/api/logs/preview-pdf?${params.toString()}`;
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

    getPreviewPdfDownloadUrl(date, templateName) {
        const params = new URLSearchParams();

        if (date) {
            params.set('date', date);
        }

        if (templateName) {
            params.set('templateName', templateName);
        }

        params.set('download', '1');

        return `${apiClient.getBaseUrl()}/api/logs/preview-pdf?${params.toString()}`;
    },

    async fetchPreviewManifest(startDate, endDate, templateName, siteName) {
        const prefix = getApiPrefix(templateName);
        return apiClient.get(`${prefix}/preview-manifest`, { startDate, endDate, templateName, siteName });
    },

    async fetchPreviewPageData({ startDate, endDate, pageKey, templateName, siteName }) {
        const prefix = getApiPrefix(templateName);
        return apiClient.get(`${prefix}/preview-page-data`, { startDate, endDate, pageKey, templateName, siteName });
    },

    async fetchTemplateHtml(templateName) {
        const prefix = getApiPrefix(templateName);
        const response = await apiClient.getRaw(`${prefix}/preview-template-html`, { templateName });

        if (!response.ok) {
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                const payload = await response.json();
                const error = new Error(payload?.userMessage || payload?.error || 'HTML 템플릿을 불러오지 못했습니다.');
                error.data = payload;
                throw error;
            }

            throw new Error('HTML 템플릿을 불러오지 못했습니다.');
        }

        return response.text();
    },

    getPagePreviewPdfUrl({ startDate, endDate, pageKey, templateName, download = false }) {
        const prefix = getApiPrefix(templateName);
        return buildAbsoluteApiUrl(`${prefix}/preview-pdf`, {
            startDate,
            endDate,
            pageKey,
            templateName,
            download: download ? '1' : undefined,
        });
    },

    getBatchPreviewPdfUrl({ startDate, endDate, templateName, siteName, download = false }) {
        const prefix = getApiPrefix(templateName);
        return buildAbsoluteApiUrl(`${prefix}/batch-pdf`, {
            startDate,
            endDate,
            templateName,
            siteName,
            download: download ? '1' : undefined,
        });
    },

    async getCachedPreviewPdfUrl(url) {
        if (!url) {
            return '';
        }

        if (previewPdfBlobUrlCache.has(url)) {
            return previewPdfBlobUrlCache.get(url);
        }

        if (previewPdfRequestCache.has(url)) {
            return previewPdfRequestCache.get(url);
        }

        const requestPromise = fetch(url, { cache: 'no-store' })
            .then(async (response) => {
                if (!response.ok) {
                    const contentType = response.headers.get('content-type') || '';
                    if (contentType.includes('application/json')) {
                        const payload = await response.json();
                        const error = new Error(payload?.userMessage || payload?.error || 'PDF 미리보기를 불러오지 못했습니다.');
                        error.data = payload;
                        throw error;
                    }

                    throw new Error('PDF 미리보기를 불러오지 못했습니다.');
                }

                const blob = await response.blob();
                const blobUrl = URL.createObjectURL(blob);
                previewPdfBlobUrlCache.set(url, blobUrl);
                previewPdfRequestCache.delete(url);
                return blobUrl;
            })
            .catch((error) => {
                previewPdfRequestCache.delete(url);
                throw error;
            });

        previewPdfRequestCache.set(url, requestPromise);
        return requestPromise;
    },

    primePreviewPdfUrls(urls = []) {
        urls.forEach((url) => {
            this.getCachedPreviewPdfUrl(url).catch(() => {});
        });
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

        console.log('[DailyLogModel] fetchExportExcel - URL:', url);
        console.log('[DailyLogModel] fetchExportExcel - ranges:', ranges);
        console.log('[DailyLogModel] fetchExportExcel - templateName:', templateName);
        console.log('[DailyLogModel] fetchExportExcel - siteName:', siteName);

        // 서버에 요청 → 서버가 파일을 생성하고 시스템 Excel로 열어줌
        return apiClient.get(url);
    }
};
