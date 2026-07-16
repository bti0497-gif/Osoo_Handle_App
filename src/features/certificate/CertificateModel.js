import { apiClient, getApiBase } from '../../core/api';

const listCache = new Map();
const listPromiseCache = new Map();

function buildListCacheKey(params = {}, authHeaders = {}) {
    return JSON.stringify({
        siteName: params.siteName || '',
        year: params.year || '',
        month: params.month || '',
        role: authHeaders['x-user-role'] || '',
        name: authHeaders['x-user-name'] || '',
        site: authHeaders['x-user-site'] || '',
        sites: authHeaders['x-user-sites'] || '',
    });
}

function clearListCache() {
    listCache.clear();
    listPromiseCache.clear();
}

export const CertificateModel = {
    async fetchList({ siteName, year, month } = {}, authHeaders = {}, options = {}) {
        const params = {};
        if (siteName) {
            params.siteName = siteName;
        }
        if (year) {
            params.year = year;
        }
        if (month) {
            params.month = month;
        }
        const cacheKey = buildListCacheKey(params, authHeaders);
        if (!options.force && listCache.has(cacheKey)) {
            return listCache.get(cacheKey);
        }
        if (!options.force && listPromiseCache.has(cacheKey)) {
            return listPromiseCache.get(cacheKey);
        }

        const promise = apiClient.get('/api/certificates', params, {
            headers: authHeaders,
        }).then((result) => {
            listCache.set(cacheKey, result);
            return result;
        }).finally(() => {
            listPromiseCache.delete(cacheKey);
        });

        listPromiseCache.set(cacheKey, promise);
        return promise;
    },

    async syncCache({ siteName, year, month } = {}, authHeaders = {}) {
        const result = await apiClient.post('/api/certificates/sync-cache', {
            siteName,
            year,
            month,
        }, {
            headers: authHeaders,
        });
        clearListCache();
        return result;
    },

    async getDownloadInfo(certificateId) {
        return apiClient.get(`/api/certificates/${certificateId}/download`);
    },

    getPreviewUrl(certificateId, fileName = '') {
        const id = encodeURIComponent(String(certificateId || '').trim());
        const name = encodeURIComponent(String(fileName || '').trim());
        return `${getApiBase()}/api/certificates/files/${id}?name=${name}&preview=1`;
    },

    async downloadSelectedPdf(items, options = {}) {
        return apiClient.post('/api/certificates/download-selected-pdf', {
            items,
            year: options.year,
            month: options.month,
        }, {
            raw: true,
            timeout: 300000,
        });
    },

    clearListCache,
};
