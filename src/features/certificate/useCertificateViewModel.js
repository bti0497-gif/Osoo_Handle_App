import { useCallback, useEffect, useMemo, useState } from 'react';
import { CertificateModel } from './CertificateModel';
import { getApiBase } from '../../core/api/serverConfig.js';

const PRIVILEGED_ROLES = new Set(['admin', 'super_admin', 'central_admin', 'group_admin']);

function toDisplayDate(value) {
    if (!value) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function buildCertificateAuthHeaders(user) {
    if (!user) return {};
    const enc = (v) => encodeURIComponent(String(v ?? '').trim());
    const managedSites = Array.isArray(user.managed_sites)
        ? user.managed_sites
            .map((s) => String(s?.site_name || '').trim())
            .filter(Boolean)
        : [];
    return {
        'x-user-role': enc(user.role),
        'x-user-name': enc(user.name),
        'x-user-site': enc(user.site_name1 || user.site),
        'x-user-sites': enc(JSON.stringify(managedSites)),
    };
}

function absolutizeApiUrl(url) {
    const s = String(url || '').trim();
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) return s;
    const base = String(getApiBase() || '').replace(/\/$/, '');
    return `${base}${s.startsWith('/') ? s : `/${s}`}`;
}

function safeDownloadFileName(name) {
    const raw = String(name || 'certificate').trim() || 'certificate';
    return raw.replace(/["\r\n\\/:*?<>|]+/g, '_').slice(0, 180);
}

function normalizeRecord(item) {
    const fileName = item.fileName || item.file_name || '-';
    const lowerFileName = String(fileName || '').toLowerCase();
    const category = lowerFileName.includes('mlss') ? 'mlss' : 'certificate';
    const sortDate = String(item.issuedAt || item.issued_at || item.sampledAt || item.sampled_at || '');
    return {
        id: item.id,
        siteName: item.siteName || item.site_name || '-',
        fileName,
        category,
        sortDate,
        sampledAt: toDisplayDate(item.sampledAt || item.sampled_at),
        issuedAt: toDisplayDate(item.issuedAt || item.issued_at),
        downloadUrl: absolutizeApiUrl(item.downloadUrl || item.download_url || ''),
    };
}

export const useCertificateViewModel = (currentUser, { showToast, showAlert } = {}) => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const [records, setRecords] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedId, setSelectedId] = useState(null);
    const [selectedCertificateIds, setSelectedCertificateIds] = useState(() => new Set());
    const [selectedSite, setSelectedSite] = useState('ALL');
    const [selectedYear, setSelectedYear] = useState(currentYear);
    const [selectedMonth, setSelectedMonth] = useState(currentMonth);

    const role = String(currentUser?.role || '').trim().toLowerCase();
    const isPrivileged = PRIVILEGED_ROLES.has(role);
    const fallbackSiteName = currentUser?.site_name1 || '현장';

    const loadRecords = useCallback(async () => {
        setIsLoading(true);
        try {
            const authHeaders = buildCertificateAuthHeaders(currentUser);
            const siteName = selectedSite === 'ALL' ? undefined : selectedSite;
            const month = String(selectedMonth).padStart(2, '0');

            try {
                await CertificateModel.syncCache({ siteName, year: selectedYear, month }, authHeaders);
            } catch (syncErr) {
                console.warn('[Certificate] 캐시 동기화 실패:', syncErr?.message || syncErr);
            }

            const res = await CertificateModel.fetchList({ siteName, year: selectedYear, month }, authHeaders);
            const list = Array.isArray(res?.items) ? res.items.map(normalizeRecord) : [];
            setRecords(list);
            setSelectedCertificateIds((prev) => {
                const validIds = new Set(list.map((item) => item.id));
                return new Set(Array.from(prev).filter((id) => validIds.has(id)));
            });
            if (list.length === 0) {
                setSelectedId(null);
            } else if (!list.some((item) => item.id === selectedId)) {
                setSelectedId(list[0].id);
            }
        } catch (err) {
            console.error(err);
            showToast?.('성적서 목록을 불러오지 못했습니다.', 'error');
            setRecords([]);
            setSelectedId(null);
        } finally {
            setIsLoading(false);
        }
    }, [currentUser, selectedSite, selectedYear, selectedMonth, selectedId, showToast]);

    useEffect(() => {
        loadRecords();
    }, [loadRecords]);

    const visibleRecords = useMemo(() => {
        let filtered = records;
        if (!isPrivileged && selectedSite !== 'ALL') {
            filtered = filtered.filter((item) => item.siteName === selectedSite);
        }

        if (isPrivileged) {
            const yy = String(selectedYear);
            const mm = String(selectedMonth).padStart(2, '0');
            filtered = filtered.filter((item) => {
                const d = String(item.issuedAt || item.sampledAt || '');
                if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return true;
                return d.slice(0, 4) === yy && d.slice(5, 7) === mm;
            });
        }

        const categoryOrder = { certificate: 0, mlss: 1 };
        return [...filtered].sort((a, b) => {
            const aRank = categoryOrder[a.category] ?? 9;
            const bRank = categoryOrder[b.category] ?? 9;
            if (aRank !== bRank) return aRank - bRank;

            const aDate = String(a.sortDate || '');
            const bDate = String(b.sortDate || '');
            const aValid = /^\d{4}-\d{2}-\d{2}$/.test(aDate);
            const bValid = /^\d{4}-\d{2}-\d{2}$/.test(bDate);
            if (aValid && bValid && aDate !== bDate) return bDate.localeCompare(aDate);
            if (aValid !== bValid) return aValid ? -1 : 1;
            return String(a.fileName || '').localeCompare(String(b.fileName || ''), 'ko');
        });
    }, [isPrivileged, records, selectedSite, selectedYear, selectedMonth]);

    const siteOptions = useMemo(() => {
        const names = new Set();
        records.forEach((item) => {
            if (item.siteName && item.siteName !== '-') {
                names.add(item.siteName);
            }
        });
        if (names.size === 0 && fallbackSiteName) {
            names.add(fallbackSiteName);
        }
        return ['ALL', ...Array.from(names)];
    }, [records, fallbackSiteName]);

    const selectedRecord = useMemo(
        () => visibleRecords.find((item) => item.id === selectedId) || null,
        [visibleRecords, selectedId]
    );

    const selectedRecords = useMemo(
        () => visibleRecords.filter((item) => selectedCertificateIds.has(item.id)),
        [visibleRecords, selectedCertificateIds]
    );

    const allVisibleSelected = visibleRecords.length > 0
        && visibleRecords.every((item) => selectedCertificateIds.has(item.id));

    const toggleCertificateSelection = useCallback((id) => {
        const normalizedId = String(id || '').trim();
        if (!normalizedId) return;
        setSelectedCertificateIds((prev) => {
            const next = new Set(prev);
            if (next.has(normalizedId)) {
                next.delete(normalizedId);
            } else {
                next.add(normalizedId);
            }
            return next;
        });
    }, []);

    const toggleAllVisibleSelection = useCallback(() => {
        setSelectedCertificateIds((prev) => {
            const next = new Set(prev);
            if (visibleRecords.length > 0 && visibleRecords.every((item) => next.has(item.id))) {
                visibleRecords.forEach((item) => next.delete(item.id));
            } else {
                visibleRecords.forEach((item) => next.add(item.id));
            }
            return next;
        });
    }, [visibleRecords]);

    const yearOptions = useMemo(() => {
        const set = new Set([currentYear, currentYear - 1, selectedYear]);
        return Array.from(set).sort((a, b) => b - a);
    }, [currentYear, selectedYear]);
    const monthOptions = useMemo(() => Array.from({ length: 12 }, (_, idx) => idx + 1), []);

    const moveMonth = useCallback((delta) => {
        setSelectedMonth((prevMonth) => {
            const base = new Date(selectedYear, prevMonth - 1, 1);
            base.setMonth(base.getMonth() + delta);
            setSelectedYear(base.getFullYear());
            return base.getMonth() + 1;
        });
    }, [selectedYear]);

    const handleDownload = async () => {
        if (selectedRecords.length === 0) {
            showAlert?.('다운로드할 성적서를 체크해 주세요.');
            return;
        }

        try {
            const res = await CertificateModel.downloadSelectedPdf(
                selectedRecords.map((item) => ({ id: item.id, fileName: item.fileName }))
            );
            if (!res.ok) {
                const errorText = await res.text().catch(() => '');
                throw new Error(errorText || `PDF 파일을 받지 못했습니다. (${res.status})`);
            }
            const blob = await res.blob();
            const objectUrl = URL.createObjectURL(blob);
            const disposition = res.headers.get('content-disposition') || '';
            const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
            const fallbackName = selectedRecords.length === 1
                ? `${safeDownloadFileName(selectedRecords[0].fileName).replace(/\.[^.]+$/, '')}.pdf`
                : `성적서_${selectedRecords.length}건.pdf`;
            const a = document.createElement('a');
            a.href = objectUrl;
            a.download = encodedName ? decodeURIComponent(encodedName) : fallbackName;
            a.rel = 'noreferrer';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
        } catch (err) {
            console.error(err);
            const msg = err?.data?.userMessage || err?.data?.message || err?.message || '다운로드 처리 중 오류가 발생했습니다.';
            showAlert?.(msg);
        }
    };

    return {
        isPrivileged,
        isLoading,
        visibleRecords,
        selectedRecord,
        selectedRecords,
        selectedId,
        setSelectedId,
        selectedCertificateIds,
        toggleCertificateSelection,
        toggleAllVisibleSelection,
        allVisibleSelected,
        selectedSite,
        setSelectedSite,
        selectedYear,
        setSelectedYear,
        selectedMonth,
        setSelectedMonth,
        yearOptions,
        monthOptions,
        moveMonth,
        siteOptions,
        handleDownload,
    };
};
