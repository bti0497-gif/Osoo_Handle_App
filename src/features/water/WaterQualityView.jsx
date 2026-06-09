import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useWaterQualityViewModel } from './useWaterQualityViewModel';
import { useSettingsViewModel } from '../settings/useSettingsViewModel';
import { useDialog } from '../../components/common/DialogContext';
import { useBatchProcess } from '../../hooks/useBatchProcess';
import { BatchProgressDialog } from '../../components/common';
import AdvancedDataGrid from '../../components/common/AdvancedDataGrid';
import { ADVANCED_DATAGRID_READ_ONLY_PROPS } from '../../components/common/advancedDataGridPresets';
import UnifiedRecordModal from '../records/UnifiedRecordModal';

const DEFAULT_WATER_LOCATION_ITEMS = [
    { name: '유량조정조', checked: true },
    { name: '무산소조', checked: true },
    { name: '포기조', checked: true },
    { name: '침전조', checked: true },
    { name: '방류조', checked: true },
];

const WATER_PARAMS = [
    { id: 'nh3_n', label: 'NH3-N', bg: '#2563eb', subBg: '#1e40af', color: '#fff' },
    { id: 'no3_n', label: 'NO3-N', bg: '#84cc16', subBg: '#4d7c0f', color: '#fff' },
    { id: 'po4_p', label: 'T-P (PO4-P)', bg: '#6366f1', subBg: '#4338ca', color: '#fff' },
    { id: 'alkalinity', label: '알칼리도', bg: '#ef4444', subBg: '#b91c1c', color: '#fff' },
];

const formatLocalDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const formatImportProgressDate = (dateString) => {
    if (!dateString) return '';
    const [year, month, day] = String(dateString).split('-');
    if (!year || !month || !day) return dateString;
    return `${Number(month)}월 ${Number(day)}일`;
};

const normalizeDisplayWaterValue = (value) => {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'number' && Number.isNaN(value)) return '초과';
    const normalized = String(value).trim();
    if (['-1', '-1.0', '-1.00', 'NaN', 'nan'].includes(normalized)) return '초과';
    return normalized;
};

const getShortName = (name) => {
    if (name === '유량조정조') return '유량';
    if (name === '무산소조') return '무산소';
    if (name === '포기조') return '포기';
    if (name === '침전조') return '침전';
    if (name === '방류조') return '방류';
    if (name === '혐기조') return '혐기';
    return String(name || '').slice(0, 3);
};

const WaterQualityView = ({ currentUser }) => {
    const { showToast, showConfirm } = useDialog();
    const { itemState = {}, basicSiteState = {} } = useSettingsViewModel();
    const { flowItems = [], medicineItems = [], locationItems = [], kitItems = [] } = itemState;
    const { siteInfo = {} } = basicSiteState;
    const {
        history = [],
        loading,
        refresh,
        isImportingFromQntech,
        handleImportFromQntech,
    } = useWaterQualityViewModel(currentUser, { showToast });

    const batchProcess = useBatchProcess();
    const [selectedRowKey, setSelectedRowKey] = useState(null);
    const [rangeStartDate, setRangeStartDate] = useState(formatLocalDate(new Date()));
    const [rangeEndDate, setRangeEndDate] = useState(formatLocalDate(new Date()));
    const [modalState, setModalState] = useState({ open: false, tab: 'water', mode: 'add' });
    const didInitTodaySelectRef = useRef(false);
    const didInitTodayScrollRef = useRef(false);
    const todayStr = new Date().toISOString().split('T')[0];

    const activeLocations = useMemo(() => {
        const active = locationItems.filter((item) => item.checked);
        return active.length > 0 ? active : DEFAULT_WATER_LOCATION_ITEMS;
    }, [locationItems]);

    const isMbr = String(siteInfo?.method || '').trim().toUpperCase() === 'MBR';
    const po4pLocations = isMbr
        ? ['유량조정조', '포기조', '방류조']
        : ['유량조정조', '침전조', '방류조'];

    useEffect(() => {
        if (didInitTodaySelectRef.current) return;
        const todayRow = history.find((row) => row.date === todayStr);
        if (!todayRow?.rowKey) return;
        setSelectedRowKey(todayRow.rowKey);
        didInitTodaySelectRef.current = true;
    }, [history, todayStr]);

    useEffect(() => {
        if (!didInitTodayScrollRef.current && history.length > 0) {
            didInitTodayScrollRef.current = true;
        }
    }, [history.length]);

    const selectedRow = history.find((row) => row.rowKey === selectedRowKey) || null;
    const scrollKey = history.find((row) => row.date === todayStr)?.rowKey || null;

    const gridCols = WATER_PARAMS.map((param) => {
        const subCols = activeLocations
            .filter((loc) => param.id !== 'po4_p' || po4pLocations.includes(loc.name))
            .map((loc) => ({
                id: `${param.id}_${loc.name}`,
                label: getShortName(loc.name),
                width: 50,
                headerStyle: { background: param.subBg, color: param.color, fontSize: '0.7rem' },
            }));

        return {
            id: param.id,
            label: param.label,
            headerStyle: { background: param.bg, color: param.color },
            subCols,
        };
    });

    const buildModalContexts = () => ({
        flow: { items: flowItems.filter((item) => item.checked).map((item) => ({ key: item.name, label: item.name, values: {}, previous: {}, summary: [] })) },
        medicine: { items: medicineItems.filter((item) => item.checked).map((item) => ({ key: item.name, label: item.name, values: {}, previous: {}, summary: [] })) },
        water: {
            items: WATER_PARAMS.flatMap((param) => (
                activeLocations
                    .filter((loc) => param.id !== 'po4_p' || po4pLocations.includes(loc.name))
                    .map((loc) => {
                        const colId = `${param.id}_${loc.name}`;
                        const value = selectedRow?.[colId];
                        return {
                            key: colId,
                            label: `${param.label} / ${loc.name}`,
                            values: { result: normalizeDisplayWaterValue(value) },
                            previous: {},
                            summary: [
                                { label: '날짜', value: selectedRow?.date },
                                { label: '회차', value: selectedRow?.measurementGroup || selectedRow?.measurement_group },
                                { label: '현재값', value: normalizeDisplayWaterValue(value) },
                            ],
                        };
                    })
            )),
        },
        kit: { items: kitItems.filter((item) => item.checked).map((item) => ({ key: item.name, label: item.name, values: {}, previous: {}, summary: [] })) },
    });

    const handleRowSelect = (row) => {
        if (row.isFuture) return;
        setSelectedRowKey(row.rowKey);
        setRangeStartDate(row.date);
        setRangeEndDate(row.date);
    };

    const openModal = (mode = 'add') => {
        setModalState({ open: true, tab: 'water', mode });
    };

    const handleQntechImportClick = async () => {
        if (!rangeStartDate || !rangeEndDate) {
            showToast('가져올 날짜를 선택하세요.', 'error');
            return;
        }
        if (rangeStartDate > rangeEndDate) {
            showToast('앞의 날짜가 뒤의 날짜보다 클 수 없습니다.', 'error');
            return;
        }
        if (rangeStartDate > todayStr || rangeEndDate > todayStr) {
            showToast('오늘보다 미래 날짜는 불러올 수 없습니다.', 'error');
            return;
        }
        if (rangeStartDate === rangeEndDate) {
            await handleImportFromQntech(rangeStartDate);
            return;
        }

        const confirmed = await showConfirm?.('기간 불러오기는 즉시 저장됩니다. 기존 값이 있는 날짜는 값은 유지하고 사진만 저장합니다. 계속할까요?');
        if (!confirmed) return;

        const datesToImport = [];
        let curr = new Date(rangeStartDate);
        const end = new Date(rangeEndDate);
        while (curr <= end) {
            datesToImport.push(formatLocalDate(curr));
            curr.setDate(curr.getDate() + 1);
        }

        let totalImportedRowCount = 0;
        let totalSavedPhotoCount = 0;
        const success = await batchProcess.executeBatch(
            datesToImport,
            (dateStr) => ({ id: dateStr, title: `${formatImportProgressDate(dateStr)} 데이터` }),
            async (dateStr, updateMessage) => {
                updateMessage('QnTECH 서버에서 수집 중...');
                const result = await handleImportFromQntech(dateStr, true);
                if (result?.summary) {
                    const rowCnt = result.summary.importedRowCount || 0;
                    const photoCnt = result.summary.savedPhotoCount || 0;
                    totalImportedRowCount += rowCnt;
                    totalSavedPhotoCount += photoCnt;
                    updateMessage(`값 ${rowCnt}건, 사진 ${photoCnt}장 저장됨`);
                } else {
                    updateMessage('저장 완료');
                }
            },
            { stopOnError: false }
        );

        if (success) {
            batchProcess.resetBatch();
            showToast(`기간 데이터 불러오기 완료 - 값 ${totalImportedRowCount}건, 사진 ${totalSavedPhotoCount}장`);
        } else {
            showToast(`일부 불러오기 실패 - 성공: 값 ${totalImportedRowCount}건, 사진 ${totalSavedPhotoCount}장`, 'error');
        }
    };

    const getRowStyle = (row, _selected, isHovered) => {
        const isSelected = row.rowKey === selectedRowKey;
        const isToday = row.date === todayStr;
        return {
            background: isSelected ? '#fef3c7' : isToday ? '#eff6ff' : isHovered ? '#e2e8f0' : undefined,
            opacity: row.isFuture ? 0.55 : 1,
            pointerEvents: row.isFuture ? 'none' : 'auto',
            cursor: row.isFuture ? 'default' : 'pointer',
        };
    };

    const renderCell = (row, col) => {
        const value = normalizeDisplayWaterValue(row[col.id]);
        const errorMsg = row[`${col.id}_error`];
        return (
            <div style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                padding: '0 6px',
                fontSize: 11,
                fontWeight: 800,
                color: errorMsg ? '#dc2626' : '#1e293b',
                background: row.isFuture ? '#fafafa' : 'transparent',
            }} title={errorMsg || ''}>
                {value}
            </div>
        );
    };

    const renderRowHeader = (row) => (
        <div style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: row.date === todayStr ? 900 : 800,
            fontSize: 10.5,
            color: row.rowKey === selectedRowKey ? '#92400e' : row.date === todayStr ? '#1d4ed8' : row.isFuture ? '#a0aec0' : '#475569',
            background: row.rowKey === selectedRowKey ? '#fde68a' : row.date === todayStr ? '#dbeafe' : '#f8fafc',
        }}>
            {row.date}
        </div>
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', minWidth: 0, minHeight: 0, backgroundColor: '#fff' }}>
            <AdvancedDataGrid
                {...ADVANCED_DATAGRID_READ_ONLY_PROPS}
                title="수질분석 데이터"
                description="그리드는 조회와 행 선택만 지원합니다. QnTECH 불러오기는 즉시 저장되며, 수동 추가/수정은 통합 입력 모달에서 UX를 확인합니다."
                columns={gridCols}
                data={history}
                keyField="rowKey"
                scrollToKey={didInitTodayScrollRef.current ? null : scrollKey}
                width="100%"
                height={400}
                showBottomBar={false}
                selectionMode="row"
                contextMenu={false}
                rowHeaderWidth={84}
                rowHeaderLabel="날짜"
                onRowSelect={handleRowSelect}
                onCellDoubleClick={() => openModal('edit')}
                getRowStyle={getRowStyle}
                renderRowHeader={renderRowHeader}
                renderCell={renderCell}
                onRefresh={refresh}
            />

            <div style={{ padding: '12px 16px', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', borderTop: '1px dashed #e2e8f0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="date" value={rangeStartDate} onChange={(e) => setRangeStartDate(e.target.value)} style={{ height: 32, borderRadius: 6, border: '1px solid #cbd5e1', padding: '0 10px', fontSize: 12, fontWeight: 700, color: '#334155' }} />
                    <span style={{ fontSize: 11, fontWeight: 800, color: '#64748b' }}>~</span>
                    <input type="date" value={rangeEndDate} onChange={(e) => setRangeEndDate(e.target.value)} style={{ height: 32, borderRadius: 6, border: '1px solid #cbd5e1', padding: '0 10px', fontSize: 12, fontWeight: 700, color: '#334155' }} />
                    <button type="button" onClick={handleQntechImportClick} disabled={(isImportingFromQntech || batchProcess.isProcessing) || !rangeStartDate || !rangeEndDate} style={{ padding: '7px 14px', borderRadius: 6, border: '1px solid #cbd5e1', fontWeight: 900, fontSize: 12, cursor: (isImportingFromQntech || batchProcess.isProcessing) ? 'wait' : 'pointer', background: '#f8fafc', color: '#0f172a' }}>
                        {(isImportingFromQntech || batchProcess.isProcessing) ? '불러오는 중...' : '데이터 불러오기'}
                    </button>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" onClick={() => openModal('add')} disabled={loading} style={{ padding: '8px 14px', borderRadius: 6, border: '1px solid #2563eb', background: '#eff6ff', color: '#1d4ed8', fontWeight: 900, cursor: 'pointer' }}>추가</button>
                    <button type="button" onClick={() => openModal('edit')} disabled={!selectedRowKey || loading} style={{ padding: '8px 14px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', color: selectedRowKey ? '#334155' : '#94a3b8', fontWeight: 900, cursor: selectedRowKey ? 'pointer' : 'not-allowed' }}>수정</button>
                </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', borderTop: '1px solid #e2e8f0', background: '#f8fafc', flexShrink: 0 }}>
                <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 800 }}>총 {history.length}행</span>
            </div>

            <UnifiedRecordModal
                isOpen={modalState.open}
                mode={modalState.mode}
                initialTab={modalState.tab}
                initialDate={modalState.mode === 'add' ? todayStr : (selectedRow?.date || todayStr)}
                contexts={buildModalContexts()}
                onClose={() => setModalState((prev) => ({ ...prev, open: false }))}
                onSaveDraft={() => showToast?.('저장 API 연결 전입니다. 현재는 입력 UX만 확인합니다.')}
            />

            <BatchProgressDialog
                isOpen={batchProcess.tasks.length > 0}
                title="QnTECH 데이터 일괄 가져오기"
                tasks={batchProcess.tasks}
                progress={batchProcess.progress}
                isProcessing={batchProcess.isProcessing}
                isFinished={batchProcess.isFinished}
                onClose={() => batchProcess.resetBatch()}
            />
        </div>
    );
};

export default WaterQualityView;
