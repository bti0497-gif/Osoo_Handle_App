import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useWaterQualityViewModel } from './useWaterQualityViewModel';
import { useSettingsViewModel } from '../settings/useSettingsViewModel';
import { useDialog } from '../../components/common/DialogContext';
import { useBatchProcess } from '../../hooks/useBatchProcess';
import { getTodayKST } from '../../core/constants';
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
    { id: 'nh3_n', label: 'NH3-N', fullLabel: '암모니아성질소', bg: '#2563eb', subBg: '#1e40af', color: '#fff' },
    { id: 'no3_n', label: 'NO3-N', fullLabel: '질산성질소', bg: '#84cc16', subBg: '#4d7c0f', color: '#fff' },
    { id: 'po4_p', label: 'PO4-P', fullLabel: '인산염인', bg: '#6366f1', subBg: '#4338ca', color: '#fff' },
    { id: 'alkalinity', label: 'ALK', fullLabel: '알칼리도', bg: '#ef4444', subBg: '#b91c1c', color: '#fff' },
];

const WATER_LABEL_BY_ID = WATER_PARAMS.reduce((acc, item) => {
    acc[item.id] = item.fullLabel;
    return acc;
}, {});

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

const buildQntechImportMessage = (result) => {
    const rowCnt = result?.summary?.importedRowCount || 0;
    const photoCnt = result?.summary?.savedPhotoCount || 0;
    const driveErrors = result?.summary?.driveUploadErrorCount || 0;
    if (rowCnt === 0 && photoCnt === 0) {
        return 'QnTECH에 해당 날짜 데이터가 없습니다.';
    }
    return driveErrors > 0
        ? `값 ${rowCnt}건, 사진 ${photoCnt}건 저장됨, Drive 실패 ${driveErrors}건`
        : `값 ${rowCnt}건, 사진 ${photoCnt}건 저장됨`;
};

const waitForUiPaint = () => new Promise((resolve) => {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
        setTimeout(resolve, 0);
        return;
    }
    window.requestAnimationFrame(() => {
        window.requestAnimationFrame(resolve);
    });
});

const normalizeDisplayWaterValue = (value) => {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'number' && Number.isNaN(value)) return '초과';
    const normalized = String(value).trim();
    if (['-1', '-1.0', '-1.00', 'NaN', 'nan'].includes(normalized)) return '초과';
    return normalized;
};

const getShortName = (name) => {
    const map = {
        유량조정조: '유량',
        무산소조: '무산소',
        혐기조: '혐기',
        포기조: '포기',
        침전조: '침전',
        방류조: '방류',
    };
    return map[name] || String(name || '').slice(0, 3);
};

const getRowRoundValue = (row, fallbackOrder = 1) => {
    const numeric = Number(row?.measurementOrder ?? row?.measurement_order ?? fallbackOrder);
    return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallbackOrder;
};

const rowHasWaterData = (row, locations, po4pLocations) => {
    if (!row) return false;
    return WATER_PARAMS.some((param) => (
        locations.some((loc) => {
            if (param.id === 'po4_p' && !po4pLocations.includes(loc.name)) return false;
            return normalizeDisplayWaterValue(row[`${param.id}_${loc.name}`]) !== '';
        })
    ));
};

const ManagementFooter = ({ count, loading, onOpen }) => (
    <div className="flow-management-view__footer" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '12px 20px',
        border: '1px solid #e2e8f0',
        borderRadius: 10,
        backgroundColor: '#FAFAFA',
    }}>
        <span style={{ fontSize: 12, color: '#94A3B8', fontWeight: 700 }}>총 {count}건</span>
        <button
            type="button"
            onClick={onOpen}
            disabled={loading}
            style={{
                padding: '8px 16px',
                borderRadius: 6,
                border: '1px solid #2563eb',
                background: '#eff6ff',
                color: '#1d4ed8',
                fontWeight: 900,
                cursor: loading ? 'not-allowed' : 'pointer',
            }}
        >
            통합 데이터 작성
        </button>
    </div>
);

const WaterQualityView = ({ currentUser }) => {
    const { showToast, showAlert, showConfirm } = useDialog();
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
    const [modalState, setModalState] = useState({ open: false, tab: 'water', mode: 'add', date: null });
    const didInitTodaySelectRef = useRef(false);
    const didInitTodayScrollRef = useRef(false);
    const todayStr = getTodayKST();

    const activeLocations = useMemo(() => {
        const active = locationItems.filter((item) => item.checked);
        return active.length > 0 ? active : DEFAULT_WATER_LOCATION_ITEMS;
    }, [locationItems]);

    const isMbr = String(siteInfo?.method || '').trim().toUpperCase() === 'MBR';
    const po4pLocations = useMemo(() => (
        isMbr
            ? ['유량조정조', '포기조', '방류조']
            : ['유량조정조', '침전조', '방류조']
    ), [isMbr]);

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
    const modalDate = modalState.date || (modalState.mode === 'add' ? todayStr : (selectedRow?.date || todayStr));
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

    const buildWaterSummary = (locName, contextRow) => {
        if (!contextRow) return [];

        return WATER_PARAMS
            .filter((param) => param.id !== 'po4_p' || po4pLocations.includes(locName))
            .map((param) => ({
                label: WATER_LABEL_BY_ID[param.id],
                value: normalizeDisplayWaterValue(contextRow[`${param.id}_${locName}`]),
            }));
    };

    const buildModalContexts = () => {
        const rowsForDate = history
            .filter((row) => row.date === modalDate && !row.isFuture)
            .filter((row) => rowHasWaterData(row, activeLocations, po4pLocations) || row.rowKey === selectedRow?.rowKey);

        const contextRows = rowsForDate.length > 0 ? rowsForDate : [];
        const roundRows = contextRows;

        const rounds = roundRows.map((row, index) => {
            const value = row ? getRowRoundValue(row, index + 1) : 1;
            return {
                value,
                label: row?.displayLabel || row?.sourceLabel || `${value}회차`,
                measurementGroup: row?.measurementGroup || row?.measurement_group || `manual:${modalDate}:${value}`,
                sourceType: row?.sourceType || row?.source_type || 'manual',
                qntechProjectId: row?.qntechProjectId || row?.qntech_project_id || null,
            };
        });

        return {
            flow: {
                items: flowItems.filter((item) => item.checked).map((item) => ({
                    key: item.name,
                    label: item.name,
                    values: {},
                    previous: {},
                    summary: [],
                })),
            },
            medicine: {
                items: medicineItems.filter((item) => item.checked).map((item) => ({
                    key: item.name,
                    label: item.name,
                    values: {},
                    previous: {},
                    summary: [],
                })),
            },
            water: {
                measurementOrder: rounds[0]?.value || 1,
                rounds,
                items: activeLocations.map((loc) => {
                    const valuesByRound = {};
                    roundRows.forEach((row, index) => {
                        const roundValue = row ? getRowRoundValue(row, index + 1) : 1;
                        valuesByRound[roundValue] = WATER_PARAMS.reduce((acc, param) => {
                            acc[param.id] = normalizeDisplayWaterValue(row?.[`${param.id}_${loc.name}`]);
                            return acc;
                        }, {});
                    });

                    const summaryRow = selectedRow?.date === modalDate ? selectedRow : contextRows[0];
                    return {
                        key: loc.name,
                        label: loc.name,
                        values: valuesByRound[rounds[0]?.value || 1] || {},
                        valuesByRound,
                        previous: {},
                        po4pApplicable: po4pLocations.includes(loc.name),
                        summary: [
                            { label: '날짜', value: modalDate },
                            { label: '회차', value: summaryRow?.displayLabel || summaryRow?.sourceLabel || summaryRow?.measurementGroup },
                            ...buildWaterSummary(loc.name, summaryRow),
                        ],
                    };
                }),
            },
            kit: {
                items: kitItems.filter((item) => item.checked).map((item) => ({
                    key: item.name,
                    label: item.name,
                    values: {},
                    previous: {},
                    summary: [],
                })),
            },
        };
    };

    const handleRowSelect = (row) => {
        if (row.isFuture) return;
        setSelectedRowKey(row.rowKey);
    };

    const openModal = (mode = 'add') => {
        setModalState({
            open: true,
            tab: 'water',
            mode,
            date: selectedRow?.date || todayStr,
        });
    };

    const hasSelectedRowData = () => rowHasWaterData(selectedRow, activeLocations, po4pLocations);

    const openUnifiedModal = () => {
        openModal(hasSelectedRowData() ? 'edit' : 'add');
    };

    const handleQntechImportClick = async (targetDate = modalDate) => {
        if (!targetDate) {
            showToast?.('가져올 날짜를 선택하세요.', 'error');
            return null;
        }
        if (targetDate > todayStr) {
            showToast?.('오늘보다 미래 날짜는 불러올 수 없습니다.', 'error');
            return null;
        }
        let importedResult = null;
        const success = await batchProcess.executeBatch(
            [targetDate],
            (dateStr) => ({ id: dateStr, title: `${formatImportProgressDate(dateStr)} QnTECH 데이터` }),
            async (dateStr, updateMessage) => {
                updateMessage('QnTECH 서버에 접속 중...');
                await waitForUiPaint();
                const result = await handleImportFromQntech(dateStr, true);
                importedResult = result;
                updateMessage(buildQntechImportMessage(result));
            },
            { stopOnError: true }
        );

        setModalState((prev) => ({
            ...prev,
            date: targetDate,
            mode: 'edit',
        }));

        if (success) {
            const message = buildQntechImportMessage(importedResult);
            showToast?.(message, importedResult?.summary?.importedRowCount || importedResult?.summary?.savedPhotoCount ? 'success' : 'warning');
        } else {
            showToast?.('QnTECH 불러오기에 실패했습니다.', 'error');
        }

        return importedResult;
    };

    const handleQntechImportRangeClick = async (startDate, endDate) => {
        if (!startDate || !endDate) {
            showToast?.('가져올 기간을 선택하세요.', 'error');
            return;
        }
        if (startDate > endDate) {
            showToast?.('시작 날짜가 종료 날짜보다 늦을 수 없습니다.', 'error');
            return;
        }
        if (startDate > todayStr || endDate > todayStr) {
            showToast?.('오늘보다 미래 날짜는 불러올 수 없습니다.', 'error');
            return;
        }
        if (startDate === endDate) {
            await handleQntechImportClick(startDate);
            return;
        }

        const confirmed = await showConfirm?.('기간 불러오기는 즉시 저장됩니다. 기존 값이 있는 날짜는 값을 유지하고 사진을 함께 저장합니다. 계속할까요?');
        if (!confirmed) return;

        const datesToImport = [];
        let curr = new Date(startDate);
        const end = new Date(endDate);
        while (curr <= end) {
            datesToImport.push(formatLocalDate(curr));
            curr.setDate(curr.getDate() + 1);
        }

        let totalImportedRowCount = 0;
        let totalSavedPhotoCount = 0;
        let totalDriveUploadErrorCount = 0;
        const success = await batchProcess.executeBatch(
            datesToImport,
            (dateStr) => ({ id: dateStr, title: `${formatImportProgressDate(dateStr)} 데이터` }),
            async (dateStr, updateMessage) => {
                updateMessage('QnTECH 서버에서 수집 중...');
                await waitForUiPaint();
                const result = await handleImportFromQntech(dateStr, true);
                const rowCnt = result?.summary?.importedRowCount || 0;
                const photoCnt = result?.summary?.savedPhotoCount || 0;
                totalImportedRowCount += rowCnt;
                totalSavedPhotoCount += photoCnt;
                totalDriveUploadErrorCount += result?.summary?.driveUploadErrorCount || 0;
                updateMessage(buildQntechImportMessage(result));
            },
            { stopOnError: false }
        );

        if (success) {
            batchProcess.resetBatch();
            if (startDate <= modalDate && modalDate <= endDate) {
                setModalState((prev) => ({ ...prev, mode: 'edit' }));
            }
            showToast?.(
                totalDriveUploadErrorCount > 0
                    ? `기간 데이터 불러오기 완료 - 값 ${totalImportedRowCount}건, 사진 ${totalSavedPhotoCount}건, Drive 실패 ${totalDriveUploadErrorCount}건`
                    : `기간 데이터 불러오기 완료 - 값 ${totalImportedRowCount}건, 사진 ${totalSavedPhotoCount}건`,
                totalDriveUploadErrorCount > 0 ? 'warning' : 'success'
            );
        } else {
            showToast?.(`일부 불러오기 실패 - 성공: 값 ${totalImportedRowCount}건, 사진 ${totalSavedPhotoCount}건`, 'error');
        }
    };

    const handleSaveComplete = async ({ date }) => {
        await refresh();
        setModalState((prev) => ({ ...prev, date }));
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

    const renderRowHeader = (row) => {
        return (
            <div style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
                fontWeight: row.date === todayStr ? 900 : 800,
                fontSize: 10.5,
                color: row.rowKey === selectedRowKey ? '#92400e' : row.date === todayStr ? '#1d4ed8' : row.isFuture ? '#a0aec0' : '#475569',
                background: row.rowKey === selectedRowKey ? '#fde68a' : row.date === todayStr ? '#dbeafe' : '#f8fafc',
            }} title={row.displayLabel || row.sourceLabel || ''}>
                <span>{row.date}</span>
            </div>
        );
    };

    return (
        <div className="flow-management-view">
            <div className="flow-management-view__grid-scroll">
                <AdvancedDataGrid
                    {...ADVANCED_DATAGRID_READ_ONLY_PROPS}
                    title="수질분석 데이터"
                    description="그리드는 조회와 행 선택만 지원합니다. QnTECH 불러오기, 수동 추가와 수정은 통합 입력 모달에서 확인합니다."
                    columns={gridCols}
                    data={history}
                    keyField="rowKey"
                    scrollToKey={didInitTodayScrollRef.current ? null : scrollKey}
                    width="100%"
                    height={400}
                    showBottomBar={false}
                    selectionMode="row"
                    contextMenu={false}
                    rowHeaderWidth={94}
                    rowHeaderLabel="날짜"
                    onRowSelect={handleRowSelect}
                    onCellDoubleClick={() => openModal('edit')}
                    getRowStyle={getRowStyle}
                    renderRowHeader={renderRowHeader}
                    renderCell={renderCell}
                    onRefresh={refresh}
                />
            </div>

            <ManagementFooter
                count={history.length}
                loading={loading}
                onOpen={openUnifiedModal}
            />

            <UnifiedRecordModal
                isOpen={modalState.open}
                mode={modalState.mode}
                currentUser={currentUser}
                initialTab={modalState.tab}
                initialDate={modalDate}
                contexts={buildModalContexts()}
                isImportingQntech={isImportingFromQntech || batchProcess.isProcessing}
                onImportQntech={handleQntechImportClick}
                onImportQntechRange={handleQntechImportRangeClick}
                onClose={() => setModalState((prev) => ({ ...prev, open: false }))}
                onDateChange={(nextDate) => setModalState((prev) => ({
                    ...prev,
                    date: nextDate,
                    mode: rowHasWaterData(
                        history.find((row) => row.date === nextDate && rowHasWaterData(row, activeLocations, po4pLocations)),
                        activeLocations,
                        po4pLocations
                    ) ? 'edit' : 'add',
                }))}
                onSaveComplete={handleSaveComplete}
                onValidationError={(message) => showAlert?.(message)}
            />

            <BatchProgressDialog
                isOpen={batchProcess.tasks.length > 0}
                title={batchProcess.tasks.length > 1 ? 'QnTECH 데이터 일괄 가져오기' : 'QnTECH 데이터 가져오기'}
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
