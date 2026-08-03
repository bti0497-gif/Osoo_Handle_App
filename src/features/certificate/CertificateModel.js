import { apiClient, getApiBase } from '../../core/api';

const listCache = new Map();
const listPromiseCache = new Map();

function buildListCacheKey(params = {}, authHeaders = {}) {
    return JSON.stringify({
        siteName: params.siteName || '',
        year: params.year || '',
        month: params.month || '',
        source: params.source || 'local',
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

function buildAuthHeaders(user) {
    if (!user) return {};
    const enc = (value) => encodeURIComponent(String(value ?? '').trim());
    const managedSites = Array.isArray(user.managed_sites)
        ? user.managed_sites.map((site) => String(site?.site_name || '').trim()).filter(Boolean)
        : [];
    return {
        'x-user-role': enc(user.role),
        'x-user-name': enc(user.name),
        'x-user-site': enc(user.site_name1 || user.site),
        'x-user-sites': enc(JSON.stringify(managedSites)),
    };
}

export const CertificateModel = {
    async fetchList({ siteName, year, month, source = 'local' } = {}, authHeaders = {}, options = {}) {
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
        params.source = source;
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

    async syncLocalFiles({ items = [], year, month } = {}, authHeaders = {}) {
        return apiClient.post('/api/certificates/sync-local-files', {
            items: items.map((item) => ({ id: item.id, fileName: item.fileName || item.file_name })),
            year,
            month,
        }, {
            headers: authHeaders,
            timeout: 300000,
        });
    },

    async syncCurrentMonthInBackground(user) {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const authHeaders = buildAuthHeaders(user);
        const listResult = await this.fetchList({ year, month, source: 'drive' }, authHeaders, { force: true });
        const items = Array.isArray(listResult?.items) ? listResult.items : [];
        const pendingItems = items.filter((item) => !item.localCached);
        if (pendingItems.length === 0) return { success: true, cachedCount: items.length, downloadedCount: 0 };
        const syncResult = await this.syncLocalFiles({ items: pendingItems, year, month }, authHeaders);
        clearListCache();
        return { ...syncResult, downloadedCount: Number(syncResult?.cachedCount || 0) };
    },

    resolveLocalUrl(url = '') {
        const value = String(url || '').trim();
        if (!value) return '';
        if (/^https?:\/\//i.test(value)) return value;
        return `${getApiBase()}${value.startsWith('/') ? value : `/${value}`}`;
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
