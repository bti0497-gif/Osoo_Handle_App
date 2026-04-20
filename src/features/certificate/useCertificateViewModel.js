import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CertificateModel } from './CertificateModel';

const PRIVILEGED_ROLES = new Set(['admin', 'super_admin', 'central_admin']);

function toDisplayDate(value) {
    if (!value) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function normalizeRecord(item) {
    return {
        id: item.id,
        siteName: item.siteName || item.site_name || '-',
        fileName: item.fileName || item.file_name || '-',
        sampledAt: toDisplayDate(item.sampledAt || item.sampled_at),
        issuedAt: toDisplayDate(item.issuedAt || item.issued_at),
        downloadUrl: item.downloadUrl || item.download_url || '',
    };
}

export const useCertificateViewModel = (currentUser, { showToast, showAlert } = {}) => {
    const fileInputRef = useRef(null);
    const [records, setRecords] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedId, setSelectedId] = useState(null);
    const [selectedSite, setSelectedSite] = useState('ALL');

    const role = String(currentUser?.role || '').trim().toLowerCase();
    const isPrivileged = PRIVILEGED_ROLES.has(role);

    const fallbackSiteName = currentUser?.site_name1 || '현장';

    const loadRecords = useCallback(async () => {
        setIsLoading(true);
        try {
            const siteName = isPrivileged || selectedSite === 'ALL' ? undefined : selectedSite;
            const res = await CertificateModel.fetchList(siteName);
            const list = Array.isArray(res?.items) ? res.items.map(normalizeRecord) : [];
            setRecords(list);
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
    }, [isPrivileged, selectedSite, selectedId, showToast]);

    useEffect(() => {
        loadRecords();
    }, [loadRecords]);

    const visibleRecords = useMemo(() => {
        if (isPrivileged || selectedSite === 'ALL') {
            return records;
        }
        return records.filter((item) => item.siteName === selectedSite);
    }, [isPrivileged, records, selectedSite]);

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

    const openFileDialog = () => {
        if (!isPrivileged) return;
        fileInputRef.current?.click();
    };

    const handleUploadFiles = async (event) => {
        const files = Array.from(event.target.files || []);
        event.target.value = '';
        if (!files.length) return;
        if (!isPrivileged) return;

        setIsLoading(true);
        try {
            for (const file of files) {
                await CertificateModel.uploadPdf(file);
            }
            showToast?.(`${files.length}개 성적서 업로드 요청을 전송했습니다.`);
            await loadRecords();
        } catch (err) {
            console.error(err);
            showAlert?.('성적서 업로드 중 오류가 발생했습니다.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleDownload = async () => {
        if (!selectedRecord) {
            showAlert?.('다운로드할 성적서를 선택해 주세요.');
            return;
        }

        try {
            const info = await CertificateModel.getDownloadInfo(selectedRecord.id);
            const url = info?.downloadUrl || info?.download_url || selectedRecord.downloadUrl || '';
            if (!url) {
                showAlert?.('다운로드 링크를 찾을 수 없습니다.');
                return;
            }
            window.open(url, '_blank', 'noopener,noreferrer');
        } catch (err) {
            console.error(err);
            showAlert?.('다운로드 처리 중 오류가 발생했습니다.');
        }
    };

    const handlePrint = async () => {
        if (!selectedRecord) {
            showAlert?.('인쇄할 성적서를 선택해 주세요.');
            return;
        }

        try {
            const info = await CertificateModel.getDownloadInfo(selectedRecord.id);
            const url = info?.downloadUrl || info?.download_url || selectedRecord.downloadUrl || '';
            if (!url) {
                showAlert?.('인쇄 링크를 찾을 수 없습니다.');
                return;
            }
            const printWindow = window.open(url, '_blank', 'noopener,noreferrer');
            if (!printWindow) {
                showAlert?.('브라우저 팝업이 차단되어 인쇄 창을 열 수 없습니다.');
                return;
            }
            printWindow.focus();
            setTimeout(() => {
                try {
                    printWindow.print();
                } catch (_) {
                    // PDF 뷰어 정책상 자동 print가 막히면 사용자가 창에서 직접 인쇄한다.
                }
            }, 800);
        } catch (err) {
            console.error(err);
            showAlert?.('인쇄 처리 중 오류가 발생했습니다.');
        }
    };

    return {
        isPrivileged,
        isLoading,
        visibleRecords,
        selectedId,
        setSelectedId,
        selectedSite,
        setSelectedSite,
        siteOptions,
        fileInputRef,
        openFileDialog,
        handleUploadFiles,
        handleDownload,
        handlePrint,
    };
};