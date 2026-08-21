import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MedicineInModel } from '../../medicine/MedicineInModel';
import { SludgePhotoModel } from '../../sludge/SludgePhotoModel';
import SludgePhotoButton from '../../sludge/SludgePhotoButton';
import { apiClient } from '../../../core/api';
import { useDialog } from '../../../components/common/DialogContext';

const CATEGORIES = [
    { id: 'sludge', label: '슬러지 사진' },
    { id: 'medicine', label: '약품 입고사진' },
    { id: 'kit', label: '키트 입고사진' },
];

const amount = (value) => Number(value || 0).toLocaleString();
const normalizeLocalPhotoUrl = (url) => {
    const raw = String(url || '');
    if (raw.startsWith('/api/')) return raw;
    const match = raw.match(/\/(\d{4})\/(\d{8}-(?:슬러지\d+|청소필증\d*)\.jpg)$/);
    if (!match) return raw.replace(/^\/사진관리슬러지\//, '/사진관리/슬러지/');
    const stamp = match[2].slice(0, 8);
    const date = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`;
    return `/api/sludge-photos/photo?date=${encodeURIComponent(date)}&file=${encodeURIComponent(match[2])}`;
};

const emitPhotoDiagnostic = (event, details = {}) => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('osoo:focus-diagnostic', {
        detail: { event: `photo-${event}`, details },
    }));
};

const describePhotoFiles = (files) => {
    const list = Array.from(files || []);
    return {
        fileCount: list.length,
        totalBytes: list.reduce((sum, file) => sum + Number(file?.size || 0), 0),
    };
};

const nextInventoryPhotoIndex = (row) => {
    const urls = row?.photoUrls?.length ? row.photoUrls : row?.photoUrl ? [row.photoUrl] : [];
    if (urls.length === 0) return 0;
    const maxIndex = urls.reduce((currentMax, photoUrl) => {
        try {
            const relativePath = new URL(photoUrl, window.location.origin).searchParams.get('p') || '';
            const fileName = relativePath.split('/').pop() || '';
            const suffix = fileName.match(/-(\d+)\.[^.]+$/);
            return Math.max(currentMax, suffix ? Math.max(0, Number(suffix[1]) - 1) : 0);
        } catch {
            return currentMax;
        }
    }, 0);
    return maxIndex + 1;
};

export default function PhotoManagementTab({ date, onError }) {
    const { showConfirm, showToast } = useDialog();
    const [category, setCategory] = useState('sludge');
    const [data, setData] = useState({
        sludge: [], medicines: [], kits: [], tradePhotoDates: [], tradePhotoUrl: null, tradePhotoDate: null, tradePhotos: [],
    });
    const [loading, setLoading] = useState(false);
    const [busyKey, setBusyKey] = useState('');
    const [selectedKey, setSelectedKey] = useState('');
    const [previewPhoto, setPreviewPhoto] = useState(null);
    const [previewIndex, setPreviewIndex] = useState(0);
    const [previewZoom, setPreviewZoom] = useState(1);
    const [previewRotation, setPreviewRotation] = useState(0);
    const [localPhotoUrls, setLocalPhotoUrls] = useState({});
    const [photoLoadError, setPhotoLoadError] = useState('');
    const [isDeletingPhoto, setIsDeletingPhoto] = useState(false);
    const onErrorRef = useRef(onError);

    useEffect(() => {
        onErrorRef.current = onError;
    }, [onError]);

    const [year, month] = useMemo(
        () => String(date || '').split('-').map(Number),
        [date]
    );

    const reload = useCallback(async () => {
        if (!year || !month) return;
        setLoading(true);
        try {
            const [sludge, inventory] = await Promise.all([
                SludgePhotoModel.fetchByMonth(year, month),
                MedicineInModel.fetchMonthly(year, month),
            ]);
            if (!sludge?.success) throw new Error(sludge?.error || '슬러지 사진 정보를 불러오지 못했습니다.');
            if (!inventory?.success) throw new Error(inventory?.error || '입고 사진 정보를 불러오지 못했습니다.');
            setData({
                sludge: sludge.items || [],
                medicines: inventory.medicines || [],
                kits: inventory.kits || [],
                tradePhotoDates: inventory.tradePhotoDates || [],
                tradePhotoUrl: inventory.tradePhotoUrl || null,
                tradePhotoDate: inventory.tradePhotoDate || null,
                tradePhotos: inventory.tradePhotos || [],
            });
        } catch (error) {
            onErrorRef.current?.(error.message);
        } finally {
            setLoading(false);
        }
    }, [month, year]);

    useEffect(() => {
        reload();
    }, [reload]);

    const uploadSludge = async (row, type, files) => {
        const list = Array.from(files || []);
        if (!list.length) return;
        const key = `${row.date}:${type}`;
        emitPhotoDiagnostic('upload-handler-started', { category: 'sludge', date: row.date, type, ...describePhotoFiles(list) });
        setBusyKey(key);
        try {
            for (const file of list) {
                emitPhotoDiagnostic('upload-api-requested', { category: 'sludge', date: row.date, type, ...describePhotoFiles([file]) });
                const result = await SludgePhotoModel.uploadPhoto(row.date, type, file);
                if (!result?.success) throw new Error(result?.error || '사진 저장에 실패했습니다.');
                emitPhotoDiagnostic('upload-api-succeeded', { category: 'sludge', date: row.date, type });
            }
            await reload();
        } catch (error) {
            emitPhotoDiagnostic('upload-failed', { category: 'sludge', date: row.date, type, message: String(error?.message || error).slice(0, 240) });
            onError?.(error.message);
        } finally {
            setBusyKey('');
        }
    };

    const uploadInventory = async (row, files, isKit = false, itemName = row.name) => {
        const list = Array.from(files || []);
        if (!list.length) return;
        const key = `${row.date}:${itemName}`;
        emitPhotoDiagnostic('upload-handler-started', { category: isKit ? 'kit' : 'medicine', date: row.date, itemName, ...describePhotoFiles(list) });
        setBusyKey(key);
        try {
            const uploadedUrls = [];
            const indexedRow = itemName === '거래명세서'
                ? {
                    ...row,
                    photoUrls: data.tradePhotos
                        .filter((photo) => photo.date === row.date)
                        .map((photo) => photo.url),
                }
                : row;
            const nextPhotoIndex = nextInventoryPhotoIndex(indexedRow);
            for (let index = 0; index < list.length; index += 1) {
                emitPhotoDiagnostic('upload-api-requested', { category: isKit ? 'kit' : 'medicine', date: row.date, itemName, ...describePhotoFiles([list[index]]) });
                const result = await MedicineInModel.uploadPhoto(
                    row.date,
                    itemName,
                    list[index],
                    nextPhotoIndex + index
                );
                if (!result?.success) throw new Error(result?.error || '사진 저장에 실패했습니다.');
                emitPhotoDiagnostic('upload-api-succeeded', { category: isKit ? 'kit' : 'medicine', date: row.date, itemName });
                if (result.url) uploadedUrls.push(result.url);
            }
            await reload();
            if (uploadedUrls.length > 0) {
                setData((current) => {
                    if (itemName === '거래명세서') {
                        return {
                            ...current,
                            tradePhotoDates: [...new Set([...current.tradePhotoDates, row.date])],
                            tradePhotoDate: row.date,
                            tradePhotoUrl: uploadedUrls[uploadedUrls.length - 1],
                            tradePhotos: [...new Map([
                                ...current.tradePhotos,
                                ...uploadedUrls.map((url) => ({ date: row.date, name: '거래명세서', url })),
                            ].map((photo) => [photo.url, photo])).values()],
                        };
                    }
                    const collection = isKit ? 'kits' : 'medicines';
                    return {
                        ...current,
                        [collection]: current[collection].map((item) => (
                            item.date === row.date && item.name === itemName
                                ? {
                                    ...item,
                                    photoUrl: uploadedUrls.at(-1),
                                    photoUrls: [...new Set([...(item.photoUrls || []), ...uploadedUrls])],
                                }
                                : item
                        )),
                    };
                });
            }
        } catch (error) {
            emitPhotoDiagnostic('upload-failed', { category: isKit ? 'kit' : 'medicine', date: row.date, itemName, message: String(error?.message || error).slice(0, 240) });
            onError?.(error.message);
        } finally {
            setBusyKey('');
        }
    };

    const rows = category === 'sludge'
        ? data.sludge
        : category === 'medicine'
            ? data.medicines
            : data.kits;

    const rowKey = useCallback((row) => category === 'sludge'
        ? row.date
        : `${row.date}:${row.name}`, [category]);

    useEffect(() => {
        setSelectedKey((current) => rows.some((row) => rowKey(row) === current) ? current : '');
    }, [rowKey, rows]);

    const selectedRow = rows.find((row) => rowKey(row) === selectedKey) || null;

    const galleryPhotos = useMemo(() => {
        if (category === 'sludge') {
            return data.sludge.flatMap((row) => [
                ...(row.sludge_photo_urls?.length ? row.sludge_photo_urls : row.sludge_photo_url ? [row.sludge_photo_url] : [])
                    .map((url) => ({ date: row.date, label: '반출사진', url })),
                ...(row.certificate_photo_urls?.length
                    ? row.certificate_photo_urls
                    : row.certificate_photo_url
                        ? [row.certificate_photo_url]
                        : [])
                    .map((url) => ({ date: row.date, label: '청소필증', url })),
            ]);
        }
        const sourceRows = category === 'medicine' ? data.medicines : data.kits;
        const itemPhotos = sourceRows.flatMap((row) => (
            row.photoUrls?.length ? row.photoUrls : row.photoUrl ? [row.photoUrl] : []
        ).map((url) => ({
            date: row.date,
            label: category === 'kit' ? `${row.name} 키트사진` : `${row.name} 입고사진`,
            shortLabel: category === 'kit' ? '키트사진' : '입고사진',
            url,
        })));
        if (category !== 'medicine') return itemPhotos;
        return [
            ...itemPhotos,
            ...data.tradePhotos.map((photo) => ({ date: photo.date, label: '거래명세표', shortLabel: '거래명세표', url: photo.url })),
        ].sort((a, b) => a.date.localeCompare(b.date));
    }, [category, data.kits, data.medicines, data.sludge, data.tradePhotos]);

    useEffect(() => {
        let cancelled = false;
        const objectUrls = [];
        setLocalPhotoUrls({});
        setPhotoLoadError('');

        if (galleryPhotos.length === 0) return undefined;

        Promise.all(galleryPhotos.map(async (photo) => {
            try {
                const response = await apiClient.getRaw(normalizeLocalPhotoUrl(photo.url));
                if (!response.ok) return null;
                const objectUrl = URL.createObjectURL(await response.blob());
                objectUrls.push(objectUrl);
                return [photo.url, objectUrl];
            } catch {
                return null;
            }
        })).then((entries) => {
            if (cancelled) return;
            const loadedEntries = entries.filter(Boolean);
            setLocalPhotoUrls(Object.fromEntries(loadedEntries));
            if (loadedEntries.length === 0) setPhotoLoadError('로컬 사진을 불러오지 못했습니다.');
        });

        return () => {
            cancelled = true;
            objectUrls.forEach((url) => URL.revokeObjectURL(url));
        };
    }, [galleryPhotos]);

    const getLoadedPhotoUrl = (photo) => localPhotoUrls[photo.url] || '';

    const showPreviewAt = (index) => {
        if (galleryPhotos.length === 0) return;
        const normalizedIndex = (index + galleryPhotos.length) % galleryPhotos.length;
        const photo = galleryPhotos[normalizedIndex];
        const loadedUrl = getLoadedPhotoUrl(photo);
        if (!loadedUrl) return;
        setPreviewIndex(normalizedIndex);
        setPreviewPhoto({
            ...photo,
            sourceUrl: photo.url,
            date: photo.date || selectedRow?.date || '',
            url: loadedUrl,
        });
        setPreviewZoom(1);
        setPreviewRotation(0);
    };

    const openPreview = (photo) => {
        showPreviewAt(Math.max(0, galleryPhotos.findIndex((item) => item.url === photo.url)));
    };

    const closePreview = () => setPreviewPhoto(null);

    const downloadPreview = () => {
        if (!previewPhoto?.url) return;
        const link = document.createElement('a');
        link.href = previewPhoto.url;
        link.download = `${previewPhoto.date}_${previewPhoto.label}.jpg`;
        document.body.appendChild(link);
        link.click();
        link.remove();
    };

    const deletePreviewPhoto = async () => {
        if (!previewPhoto?.sourceUrl || isDeletingPhoto) return;
        const confirmed = await showConfirm(
            `${previewPhoto.date} ${previewPhoto.label} 사진을 삭제할까요?\n수치와 입고·반출 기록은 삭제되지 않습니다.`,
            '사진 삭제'
        );
        if (!confirmed) return;

        setIsDeletingPhoto(true);
        try {
            let result;
            if (previewPhoto.sourceUrl.startsWith('/api/sludge-photos/photo')) {
                const url = new URL(previewPhoto.sourceUrl, window.location.origin);
                result = await SludgePhotoModel.deletePhoto(
                    url.searchParams.get('date') || previewPhoto.date,
                    url.searchParams.get('file') || ''
                );
            } else {
                const url = new URL(previewPhoto.sourceUrl, window.location.origin);
                result = await MedicineInModel.deletePhoto(url.searchParams.get('p') || '');
            }
            if (!result?.success) throw new Error(result?.error || '사진을 삭제하지 못했습니다.');
            emitPhotoDiagnostic('delete-succeeded', {
                category,
                date: previewPhoto.date,
                label: previewPhoto.label,
            });
            closePreview();
            await reload();
            showToast('선택한 사진을 삭제했습니다.', 'success');
        } catch (error) {
            emitPhotoDiagnostic('delete-failed', {
                category,
                date: previewPhoto.date,
                label: previewPhoto.label,
                message: String(error?.message || error).slice(0, 240),
            });
            onErrorRef.current?.(error.message || '사진을 삭제하지 못했습니다.');
        } finally {
            setIsDeletingPhoto(false);
        }
    };

    return (
        <div className="unified-photo-management">
            <aside className="unified-photo-management__menu">
                {CATEGORIES.map((item) => (
                    <button
                        key={item.id}
                        type="button"
                        className={category === item.id ? 'is-active' : ''}
                        onClick={() => setCategory(item.id)}
                    >
                        {item.label}
                    </button>
                ))}
            </aside>
            <section className="unified-photo-management__content">
                <div className="unified-photo-management__heading">
                    <div className="unified-photo-management__heading-title">
                        <strong>{CATEGORIES.find((item) => item.id === category)?.label}</strong>
                        {category === 'medicine' && rows.length > 0 && (
                            <SludgePhotoButton
                                label="거래명세표"
                                multiple
                                busy={busyKey === `${rows[0].date}:거래명세서`}
                                hasPhoto={data.tradePhotoDates.length > 0}
                                onDiagnostic={(event, details) => emitPhotoDiagnostic(event, { category: 'medicine', date: rows[0].date, itemName: '거래명세서', ...details })}
                                onFiles={(files) => uploadInventory(rows[0], files, false, '거래명세서')}
                            />
                        )}
                    </div>
                    <span>{year}년 {month}월 · {rows.length}건</span>
                </div>
                {loading ? (
                    <div className="unified-photo-management__empty">사진 정보를 확인하는 중입니다.</div>
                ) : rows.length === 0 ? (
                    <div className="unified-photo-management__empty">선택한 달에 사진을 등록할 대상이 없습니다.</div>
                ) : (
                    <div className="unified-photo-management__rows">
                        {category === 'sludge' && rows.map((row) => (
                            <div
                                className={`unified-photo-management__row ${selectedKey === rowKey(row) ? 'is-selected' : ''}`}
                                key={row.date}
                                onClick={() => setSelectedKey(rowKey(row))}
                            >
                                <div className="unified-photo-management__summary"><strong>{row.date}</strong><span>반출량 {amount(row.sludge_amount)} m³</span></div>
                                <div className="unified-photo-management__actions">
                                    <SludgePhotoButton
                                        label="반출사진"
                                        multiple
                                        busy={busyKey === `${row.date}:sludge`}
                                        hasPhoto={Boolean(row.sludge_photo_url)}
                                        onDiagnostic={(event, details) => emitPhotoDiagnostic(event, { category: 'sludge', date: row.date, type: 'sludge', ...details })}
                                        onFiles={(files) => uploadSludge(row, 'sludge', files)}
                                    />
                                    <SludgePhotoButton
                                        label="청소필증"
                                        multiple
                                        busy={busyKey === `${row.date}:certificate`}
                                        hasPhoto={Boolean(row.certificate_photo_urls?.length || row.certificate_photo_url)}
                                        onDiagnostic={(event, details) => emitPhotoDiagnostic(event, { category: 'sludge', date: row.date, type: 'certificate', ...details })}
                                        onFiles={(files) => uploadSludge(row, 'certificate', files)}
                                    />
                                </div>
                            </div>
                        ))}
                        {category === 'medicine' && rows.map((row) => (
                            <div
                                className={`unified-photo-management__row ${selectedKey === rowKey(row) ? 'is-selected' : ''}`}
                                key={`${row.date}:${row.name}`}
                                onClick={() => setSelectedKey(rowKey(row))}
                            >
                                <div className="unified-photo-management__summary"><strong>{row.date} · {row.name}</strong><span>입고량 {amount(row.purchase)}</span></div>
                                <div className="unified-photo-management__actions">
                                    <SludgePhotoButton
                                        label="입고사진"
                                        multiple
                                        busy={busyKey === `${row.date}:${row.name}`}
                                        hasPhoto={Boolean(row.photoUrl)}
                                        onDiagnostic={(event, details) => emitPhotoDiagnostic(event, { category: 'medicine', date: row.date, itemName: row.name, ...details })}
                                        onFiles={(files) => uploadInventory(row, files)}
                                    />
                                </div>
                            </div>
                        ))}
                        {category === 'kit' && rows.map((row) => (
                            <div
                                className={`unified-photo-management__row ${selectedKey === rowKey(row) ? 'is-selected' : ''}`}
                                key={`${row.date}:${row.name}`}
                                onClick={() => setSelectedKey(rowKey(row))}
                            >
                                <div className="unified-photo-management__summary"><strong>{row.date} · {row.name}</strong><span>입고량 {amount(row.purchase)}</span></div>
                                <div className="unified-photo-management__actions">
                                    <SludgePhotoButton
                                        label="키트사진"
                                        multiple
                                        busy={busyKey === `${row.date}:${row.name}`}
                                        hasPhoto={Boolean(row.photoUrl)}
                                        onDiagnostic={(event, details) => emitPhotoDiagnostic(event, { category: 'kit', date: row.date, itemName: row.name, ...details })}
                                        onFiles={(files) => uploadInventory(row, files, true)}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                {!loading && rows.length > 0 && (
                    <div className="unified-photo-management__preview">
                        {galleryPhotos.length === 0 ? (
                            <div className="unified-photo-management__preview-empty">이 달에 저장된 로컬 사진이 없습니다.</div>
                        ) : photoLoadError ? (
                            <div className="unified-photo-management__preview-empty">{photoLoadError}</div>
                        ) : galleryPhotos.map((photo) => (
                            <button
                                key={`${photo.date}:${photo.label}:${photo.url}`}
                                type="button"
                                onClick={() => openPreview(photo)}
                                className="unified-photo-management__thumbnail"
                                disabled={!getLoadedPhotoUrl(photo)}
                            >
                                {getLoadedPhotoUrl(photo)
                                    ? <img src={getLoadedPhotoUrl(photo)} alt={photo.label} />
                                    : <span className="unified-photo-management__thumbnail-loading">불러오는 중…</span>}
                                <span>{photo.date} · {photo.label}</span>
                            </button>
                        ))}
                    </div>
                )}
            </section>
            {previewPhoto && (
                <div className="unified-photo-viewer" role="dialog" aria-modal="true" aria-label="사진 미리보기" onMouseDown={closePreview}>
                    <div className="unified-photo-viewer__window" onMouseDown={(event) => event.stopPropagation()}>
                        <header className="unified-photo-viewer__header">
                            <div><strong>{previewPhoto.label}</strong><span>{previewPhoto.date}</span></div>
                            <button type="button" onClick={closePreview} aria-label="미리보기 닫기">×</button>
                        </header>
                        <div className="unified-photo-viewer__canvas">
                            {galleryPhotos.length > 1 && (
                                <button type="button" className="unified-photo-viewer__nav is-prev" onClick={() => showPreviewAt(previewIndex - 1)} aria-label="이전 사진">‹</button>
                            )}
                            <img
                                src={previewPhoto.url}
                                alt={`${previewPhoto.date} ${previewPhoto.label}`}
                                style={{ transform: `scale(${previewZoom}) rotate(${previewRotation}deg)` }}
                            />
                            {galleryPhotos.length > 1 && (
                                <button type="button" className="unified-photo-viewer__nav is-next" onClick={() => showPreviewAt(previewIndex + 1)} aria-label="다음 사진">›</button>
                            )}
                        </div>
                        <footer className="unified-photo-viewer__toolbar">
                            <div className="unified-photo-viewer__tools">
                                <button type="button" onClick={() => setPreviewZoom((value) => Math.max(0.5, value - 0.25))} aria-label="축소">−</button>
                                <span>{Math.round(previewZoom * 100)}%</span>
                                <button type="button" onClick={() => setPreviewZoom((value) => Math.min(3, value + 0.25))} aria-label="확대">+</button>
                                <button type="button" onClick={() => setPreviewRotation((value) => (value + 90) % 360)} aria-label="회전">회전</button>
                            </div>
                            <div className="unified-photo-viewer__tools">
                                {galleryPhotos.length > 1 && <span>{previewIndex + 1} / {galleryPhotos.length}</span>}
                                <button type="button" className="is-danger" onClick={deletePreviewPhoto} disabled={isDeletingPhoto}>
                                    {isDeletingPhoto ? '삭제 중…' : '삭제'}
                                </button>
                                <button type="button" onClick={downloadPreview}>원본 저장</button>
                                <button type="button" onClick={closePreview}>닫기</button>
                            </div>
                        </footer>
                    </div>
                </div>
            )}
        </div>
    );
}
