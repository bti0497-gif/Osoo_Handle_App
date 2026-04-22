import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CertificateModel } from './CertificateModel';
import { useBatchProcess } from '../../hooks/useBatchProcess';
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

/** 상대 /api/... 는 Vite(프론트) 호스트로 열려 로그인 화면이 뜸 → 로컬 브릿지 절대 URL로 통일 */
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
    const fileInputRef = useRef(null);
    const batchProcess = useBatchProcess();
    const [records, setRecords] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedId, setSelectedId] = useState(null);
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
            // 관리자: 전체 또는 선택 현장만 조회. 현장 계정: 항상 본인 현장(site_name1)으로 필터(ALL이어도 전체 조회 금지).
            let siteName;
            siteName = selectedSite === 'ALL' ? undefined : selectedSite;

            try {
                await CertificateModel.syncCache({
                    siteName,
                    year: selectedYear,
                    month: String(selectedMonth).padStart(2, '0'),
                }, authHeaders);
            } catch (syncErr) {
                console.warn('[Certificate] 캐시 동기화 실패:', syncErr?.message || syncErr);
            }

            const res = await CertificateModel.fetchList({
                siteName,
                year: selectedYear,
                month: String(selectedMonth).padStart(2, '0'),
            }, authHeaders);
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
    }, [isPrivileged, selectedSite, selectedId, showToast, fallbackSiteName, selectedYear, selectedMonth]);

    useEffect(() => {
        loadRecords();
    }, [loadRecords]);

    const visibleRecords = useMemo(() => {
        let filtered = records;
        if (!isPrivileged && selectedSite !== 'ALL') {
            filtered = filtered.filter((item) => item.siteName === selectedSite);
        }

        // 안전망: 서버가 월 필터를 아직 반영하지 않은 상태여도 관리자 화면에서는 월 선택대로 보여준다.
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
        const sorted = [...filtered].sort((a, b) => {
            const aRank = categoryOrder[a.category] ?? 9;
            const bRank = categoryOrder[b.category] ?? 9;
            if (aRank !== bRank) return aRank - bRank;

            const aDate = String(a.sortDate || '');
            const bDate = String(b.sortDate || '');
            const aValid = /^\d{4}-\d{2}-\d{2}$/.test(aDate);
            const bValid = /^\d{4}-\d{2}-\d{2}$/.test(bDate);
            if (aValid && bValid && aDate !== bDate) {
                return bDate.localeCompare(aDate);
            }
            if (aValid !== bValid) {
                return aValid ? -1 : 1;
            }

            return String(a.fileName || '').localeCompare(String(b.fileName || ''), 'ko');
        });

        return sorted;
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

    const openFileDialog = () => {
        if (!isPrivileged) return;
        fileInputRef.current?.click();
    };

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

    const handleUploadFiles = async (event) => {
        const raw = Array.from(event.target.files || []);
        event.target.value = '';
        if (!isPrivileged) return;
        const uploadedReportDates = [];

        const zipItems = raw
            .filter((f) => String(f.name || '').toLowerCase().endsWith('.zip'))
            .map((file, idx) => ({ file, idx }));
        if (!zipItems.length) {
            showAlert?.('.zip 파일만 선택할 수 있습니다. (추출 batch_export 등)');
            return;
        }
        if (raw.length > zipItems.length) {
            showToast?.('.zip이 아닌 파일은 건너뛰었습니다.', 'error');
        }

        const allOk = await batchProcess.executeBatch(
            zipItems,
            (item) => ({
                id: `zip-${item.idx}-${item.file.name}-${item.file.size}`,
                title: item.file.name,
            }),
            async (item, updateMsg) => {
                const { file } = item;
                const uploadTaskId = `zip-progress-${Date.now()}-${item.idx}`;
                let keepPolling = true;
                const pollIntervalMs = 800;
                const toRatio = (v) => {
                    const n = Number(v);
                    if (!Number.isFinite(n)) return 0;
                    return Math.max(0, Math.min(1, n));
                };
                const pollProgress = async () => {
                    while (keepPolling) {
                        try {
                            const progressRes = await CertificateModel.fetchZipUploadProgress(uploadTaskId, currentUser?.role);
                            const p = progressRes?.progress;
                            if (p) {
                                if (p.stage === 'zip_received') {
                                    updateMsg({ message: '압축을 풀고 있습니다...', progress: 0.1 });
                                } else if (p.stage === 'parsed') {
                                    updateMsg({
                                        message: `압축 해석 완료 · JSON ${p.jsonTotal || 0}건 · 이미지 ${p.fileTotal || 0}개`,
                                        progress: 0.2,
                                    });
                                } else if (p.stage === 'json_processing') {
                                    const total = Number(p.jsonTotal || 0);
                                    const processed = Number(p.jsonProcessed || 0);
                                    const phase = total > 0 ? toRatio(processed / total) : 1;
                                    updateMsg({
                                        message: `JSON 파일 처리 중... (${processed}/${total || 0})`,
                                        progress: 0.2 + (phase * 0.4),
                                    });
                                } else if (p.stage === 'image_uploading') {
                                    const total = Number(p.fileTotal || 0);
                                    const processed = Number(p.fileProcessed || 0);
                                    const phase = total > 0 ? toRatio(processed / total) : 1;
                                    updateMsg({
                                        message: `이미지 업로드 중... (${processed}/${total || 0}, 완료 ${p.fileUploaded || 0})`,
                                        progress: 0.6 + (phase * 0.35),
                                    });
                                } else if (p.stage === 'finalizing') {
                                    updateMsg({
                                        message: p.message || '저장 결과를 확인 중입니다...',
                                        progress: 0.97,
                                    });
                                } else if (p.stage === 'completed') {
                                    updateMsg({ message: p.message || '처리 완료', progress: 1 });
                                } else if (p.stage === 'failed') {
                                    updateMsg({ message: p.message || '처리 실패', progress: 1 });
                                } else if (p.message) {
                                    updateMsg(p.message);
                                }
                            }
                        } catch (_) {
                            // 업로드 시작 직후 progress 항목이 아직 없을 수 있음
                        }
                        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
                    }
                };

                updateMsg({ message: '서버로 ZIP 전송 중...', progress: 0.05 });
                const pollerPromise = pollProgress();
                let res;
                try {
                    res = await CertificateModel.uploadBatchZip(file, buildCertificateAuthHeaders(currentUser), uploadTaskId);
                } finally {
                    keepPolling = false;
                    await pollerPromise;
                }

                const inserted = res?.json?.inserted ?? 0;
                const totalRecords = res?.json?.total_records ?? 0;
                const up = res?.files?.uploaded_count ?? 0;
                const totalFiles = res?.files?.total_files ?? 0;
                const jsonErr = res?.json?.errors || [];
                const fileErr = res?.files?.errors || [];
                const warns = res?.json?.warnings || [];
                const jsonOnlyProblem = totalRecords > 0 && inserted === 0;
                const fileProcessedFailure = totalFiles > 0 && up === 0;
                const hardFailure = fileProcessedFailure || jsonOnlyProblem;
                const issueCount = jsonErr.length + fileErr.length + warns.length + (hardFailure ? 1 : 0);
                const fileItems = Array.isArray(res?.files?.items) ? res.files.items : [];
                fileItems.forEach((f) => {
                    const d = String(f?.report_date || '').trim();
                    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
                        uploadedReportDates.push(d);
                    }
                });

                updateMsg({ message: `DB ${inserted}건 · 이미지 ${up}개${issueCount ? ` · 이슈 ${issueCount}건` : ''}`, progress: 1 });
                if (hardFailure || fileErr.length > 0) {
                    const lines = [
                        ...[hardFailure ? '처리 가능한 데이터가 있었지만 반영 건수가 0건입니다.' : ''].filter(Boolean),
                        ...warns.slice(0, 2),
                        ...[...jsonErr, ...fileErr].slice(0, 2).map((e) => `${e.file || 'json'}: ${e.message}`),
                    ];
                    throw new Error(lines.join(' / ') || `${issueCount}건 이슈`);
                }
            },
            { stopOnError: false }
        );

        if (allOk && uploadedReportDates.length > 0) {
            uploadedReportDates.sort((a, b) => b.localeCompare(a));
            const latest = uploadedReportDates[0];
            const nextYear = Number(latest.slice(0, 4));
            const nextMonth = Number(latest.slice(5, 7));
            if (Number.isFinite(nextYear) && Number.isFinite(nextMonth)) {
                setSelectedYear(nextYear);
                setSelectedMonth(nextMonth);
            }
        }

        try {
            await loadRecords();
        } catch (e) {
            console.error(e);
        }

        if (allOk) {
            showToast?.(`${zipItems.length}개 ZIP 처리를 모두 완료했습니다.`);
        } else {
            showToast?.('일부 ZIP에서 오류가 있었습니다. 다이얼로그 메시지를 확인해 주세요.', 'error');
        }
    };

    const handleDownload = async () => {
        if (!selectedRecord) {
            showAlert?.('다운로드할 성적서를 선택해 주세요.');
            return;
        }

        try {
            const info = await CertificateModel.getDownloadInfo(selectedRecord.id);
            const url = absolutizeApiUrl(
                info?.downloadUrl || info?.download_url || selectedRecord.downloadUrl || ''
            );
            if (!url) {
                showAlert?.('다운로드 링크를 찾을 수 없습니다.');
                return;
            }
            // await 이후 window.open 은 팝업 차단됨 → fetch + Blob + a[download] 로 저장만 유도
            const res = await fetch(url, { credentials: 'omit' });
            if (!res.ok) {
                throw new Error(`파일을 받지 못했습니다. (${res.status})`);
            }
            const blob = await res.blob();
            const objectUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = objectUrl;
            a.download = safeDownloadFileName(selectedRecord.fileName);
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

    const handlePrint = async () => {
        if (!selectedRecord) {
            showAlert?.('인쇄할 성적서를 선택해 주세요.');
            return;
        }

        try {
            const info = await CertificateModel.getDownloadInfo(selectedRecord.id);
            const url = absolutizeApiUrl(
                info?.downloadUrl || info?.download_url || selectedRecord.downloadUrl || ''
            );
            if (!url) {
                showAlert?.('인쇄 링크를 찾을 수 없습니다.');
                return;
            }

            // 팝업 대신 숨김 iframe 인쇄: Electron/브라우저 팝업 차단 영향 최소화
            const res = await fetch(url, { credentials: 'omit' });
            if (!res.ok) {
                throw new Error(`파일을 불러오지 못했습니다. (${res.status})`);
            }
            const blob = await res.blob();
            const objectUrl = URL.createObjectURL(blob);
            const iframe = document.createElement('iframe');
            iframe.style.position = 'fixed';
            iframe.style.right = '0';
            iframe.style.bottom = '0';
            iframe.style.width = '0';
            iframe.style.height = '0';
            iframe.style.border = '0';
            iframe.src = objectUrl;
            document.body.appendChild(iframe);

            const cleanup = () => {
                try {
                    iframe.remove();
                } catch (_) {
                    /* noop */
                }
                setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
            };

            iframe.onload = () => {
                setTimeout(() => {
                    try {
                        iframe.contentWindow?.focus();
                        iframe.contentWindow?.print();
                    } catch (_) {
                        showAlert?.('자동 인쇄 호출에 실패했습니다. 다운받기 후 직접 인쇄해 주세요.');
                    } finally {
                        cleanup();
                    }
                }, 500);
            };
        } catch (err) {
            console.error(err);
            const msg = err?.data?.userMessage || err?.data?.message || err?.message || '인쇄 처리 중 오류가 발생했습니다.';
            showAlert?.(msg);
        }
    };

    return {
        isPrivileged,
        isLoading,
        visibleRecords,
        selectedRecord,
        selectedId,
        setSelectedId,
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
        fileInputRef,
        openFileDialog,
        handleUploadFiles,
        handleDownload,
        handlePrint,
        batchProcess,
    };
};