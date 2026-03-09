import { apiClient } from '../../core/api';

const previewPdfBlobUrlCache = new Map();
const previewPdfRequestCache = new Map();
const PREVIEW_PDF_URL_VERSION = '2026-03-09-photo-orientation-v2';

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

    async fetchPreviewManifest(startDate, endDate, templateName) {
        return apiClient.get('/api/logs/preview-manifest', { startDate, endDate, templateName });
    },

    getPagePreviewPdfUrl({ startDate, endDate, pageKey, templateName, download = false }) {
        return buildAbsoluteApiUrl('/api/logs/preview-pdf', {
            startDate,
            endDate,
            pageKey,
            templateName,
            download: download ? '1' : undefined,
        });
    },

    getBatchPreviewPdfUrl({ startDate, endDate, templateName, download = false }) {
        return buildAbsoluteApiUrl('/api/logs/batch-pdf', {
            startDate,
            endDate,
            templateName,
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
    }
};
