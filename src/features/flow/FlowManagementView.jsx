import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFlowViewModel } from './useFlowViewModel';
import { useSettingsViewModel } from '../settings/useSettingsViewModel';
import { useDialog } from '../../components/common/DialogContext';
import AdvancedDataGrid from '../../components/common/AdvancedDataGrid';
import { ADVANCED_DATAGRID_READ_ONLY_PROPS } from '../../components/common/advancedDataGridPresets';
import { getTodayKST } from '../../core/constants';
import UnifiedRecordModal from '../records/UnifiedRecordModal';

const DEFAULT_FLOW_VIEW_ITEMS = [
    { name: '유입유량계', checked: true },
    { name: '방류유량계', checked: true },
    { name: '내부반송유량계', checked: true },
    { name: '외부반송유량계', checked: true },
    { name: '전력량계', checked: true },
    { name: '슬러지', checked: true },
];

const FLOW_COLORS = ['#1e3a8a', '#047857', '#b45309', '#4338ca', '#57534e', '#0e7490'];

const formatNumber = (value) => {
    if (value === null || value === undefined || value === '' || Number.isNaN(Number(value))) return '';
    return Number(value).toLocaleString();
};

const getPreviousFlowCell = (history, selectedDate, flowName) => {
    const idx = history.findIndex((row) => row.date === selectedDate);
    for (let i = idx - 1; i >= 0; i -= 1) {
        const cell = history[i]?.[flowName];
        if (cell?.raw !== null && cell?.raw !== undefined) {
            return cell;
        }
    }
    return null;
};

const FlowManagementView = ({ currentUser }) => {
    const { showAlert } = useDialog();
    const { itemState = {} } = useSettingsViewModel();
    const { flowItems = [], medicineItems = [], locationItems = [], kitItems = [] } = itemState;
    const visibleFlowItems = useMemo(() => {
        const active = flowItems.filter((item) => item.checked);
        return active.length > 0 ? active : DEFAULT_FLOW_VIEW_ITEMS;
    }, [flowItems]);
    const flowMeterTypes = useMemo(() => visibleFlowItems.map((item) => item.name), [visibleFlowItems]);
    const { history = [], loading, correctData, refresh } = useFlowViewModel(currentUser, { showAlert, flowTypes: flowMeterTypes });

    const [selectedDate, setSelectedDate] = useState(null);
    const [modalState, setModalState] = useState({ open: false, tab: 'flow', mode: 'add' });
    const didInitTodaySelectRef = useRef(false);
    const didInitTodayScrollRef = useRef(false);
    const todayStr = getTodayKST();

    useEffect(() => {
        if (didInitTodaySelectRef.current) return;
        if (!history.some((row) => row.date === todayStr)) return;
        setSelectedDate(todayStr);
        didInitTodaySelectRef.current = true;
    }, [history, todayStr]);

    useEffect(() => {
        if (!didInitTodayScrollRef.current && history.length > 0) {
            didInitTodayScrollRef.current = true;
        }
    }, [history.length]);

    const selectedRow = history.find((row) => row.date === selectedDate) || null;

    const gridCols = visibleFlowItems.map((item, idx) => ({
        id: item.name,
        label: item.name.replace('계', ''),
        headerBgColor: FLOW_COLORS[idx % FLOW_COLORS.length],
        headerTextColor: '#fff',
        subCols: [
            { id: `${item.name}_raw`, label: item.name === '슬러지' ? '반출량' : '검침값', width: 72, headerBgColor: FLOW_COLORS[idx % FLOW_COLORS.length], headerTextColor: '#fff' },
            { id: `${item.name}_diff`, label: '유량', width: 58, headerBgColor: '#fff', headerTextColor: '#1e40af' },
        ],
    }));

    const buildModalContexts = () => ({
        flow: {
            items: visibleFlowItems.map((item) => {
                const cell = selectedRow?.[item.name]?.isUserInput
                    ? { reading: selectedRow[item.name].raw, flow: selectedRow[item.name].diff }
                    : correctData(selectedRow?.[item.name]);
                const prev = getPreviousFlowCell(history, selectedDate, item.name);
                return {
                    key: item.name,
                    label: item.name,
                    values: { reading: cell?.reading ?? '', flow: cell?.flow ?? '' },
                    previous: { reading: prev?.raw ?? '', flow: prev?.diff ?? '' },
                    summary: [
                        { label: '직전 검침값', value: prev?.raw },
                        { label: '직전 유량값', value: prev?.diff },
                        { label: '현재 검침값', value: cell?.reading },
                        { label: '현재 유량값', value: cell?.flow },
                    ],
                };
            }),
        },
        medicine: { items: medicineItems.filter((item) => item.checked).map((item) => ({ key: item.name, label: item.name, values: {}, previous: {}, summary: [] })) },
        water: { items: locationItems.filter((item) => item.checked).map((item) => ({ key: item.name, label: item.name, values: {}, previous: {}, summary: [] })) },
        kit: { items: kitItems.filter((item) => item.checked).map((item) => ({ key: item.name, label: item.name, values: {}, previous: {}, summary: [] })) },
    });

    const handleRowSelect = (row) => {
        if (row.isFuture || row.date > todayStr) return;
        setSelectedDate(row.date);
    };

    const openModal = (mode = 'add') => {
        setModalState({ open: true, tab: 'flow', mode });
    };

    const renderCell = (row, col) => {
        const flowName = col.parentId;
        if (!flowName) return null;
        const data = row[flowName]?.isUserInput
            ? { reading: row[flowName].raw, flow: row[flowName].diff, error: row[flowName].error }
            : correctData(row[flowName]);
        const value = col.id.endsWith('_raw') ? data.reading : data.flow;
        return (
            <div style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                padding: '0 6px',
                color: data.error ? '#dc2626' : '#1e293b',
                fontSize: col.id.endsWith('_raw') ? 11 : 10.5,
                fontWeight: col.id.endsWith('_raw') ? 800 : 700,
                background: row.isFuture ? '#fafafa' : 'transparent',
            }} title={data.error || ''}>
                {formatNumber(value)}
            </div>
        );
    };

    const getRowStyle = (row, _gridSelected, isHovered) => {
        const isSelected = row.date === selectedDate;
        const isToday = row.date === todayStr;
        const isFuture = row.isFuture || row.date > todayStr;
        return {
            background: isSelected ? '#fef3c7' : isToday ? '#eff6ff' : isHovered ? '#e2e8f0' : undefined,
            opacity: isFuture ? 0.55 : 1,
            pointerEvents: isFuture ? 'none' : 'auto',
            cursor: isFuture ? 'default' : 'pointer',
        };
    };

    const renderRowHeader = (row) => {
        const isSelected = row.date === selectedDate;
        const isToday = row.date === todayStr;
        const isFuture = row.isFuture || row.date > todayStr;
        return (
            <div style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: isToday ? 900 : 800,
                fontSize: 10.5,
                color: isSelected ? '#92400e' : isToday ? '#1d4ed8' : isFuture ? '#a0aec0' : '#475569',
                background: isSelected ? '#fde68a' : isToday ? '#dbeafe' : '#f8fafc',
            }}>
                {row.date}
            </div>
        );
    };

    return (
        <div className="flow-management-view">
            <div className="flow-management-view__grid-scroll">
                <AdvancedDataGrid
                    {...ADVANCED_DATAGRID_READ_ONLY_PROPS}
                    title="유량 검침 데이터"
                    description="그리드는 조회와 행 선택만 지원합니다. 추가와 수정은 통합 입력 모달에서 확인합니다."
                    columns={gridCols}
                    data={history}
                    keyField="date"
                    scrollToKey={didInitTodayScrollRef.current ? null : todayStr}
                    width="100%"
                    height={400}
                    rowHeaderWidth={84}
                    rowHeaderLabel="날짜"
                    showBottomBar={false}
                    selectionMode="row"
                    contextMenu={false}
                    onRowSelect={handleRowSelect}
                    onCellDoubleClick={() => openModal('edit')}
                    getRowStyle={getRowStyle}
                    renderRowHeader={renderRowHeader}
                    renderCell={renderCell}
                    onRefresh={refresh}
                />
            </div>

            <div className="flow-management-view__footer" style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 20px',
                border: '1px solid #e2e8f0',
                borderRadius: 10,
                backgroundColor: '#FAFAFA',
            }}>
                <span style={{ fontSize: 12, color: '#94A3B8', fontWeight: 700 }}>{history.length} records</span>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" onClick={() => openModal('add')} disabled={loading} style={{ padding: '8px 14px', borderRadius: 6, border: '1px solid #2563eb', background: '#eff6ff', color: '#1d4ed8', fontWeight: 900, cursor: 'pointer' }}>
                        추가
                    </button>
                    <button type="button" onClick={() => openModal('edit')} disabled={!selectedDate || loading} style={{ padding: '8px 14px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', color: selectedDate ? '#334155' : '#94a3b8', fontWeight: 900, cursor: selectedDate ? 'pointer' : 'not-allowed' }}>
                        수정
                    </button>
                </div>
            </div>

            <UnifiedRecordModal
                isOpen={modalState.open}
                mode={modalState.mode}
                initialTab={modalState.tab}
                initialDate={modalState.mode === 'add' ? todayStr : (selectedDate || todayStr)}
                contexts={buildModalContexts()}
                onClose={() => setModalState((prev) => ({ ...prev, open: false }))}
                onSaveDraft={() => showAlert?.('저장 API 연결 전입니다. 현재는 입력 UX만 확인합니다.')}
            />
        </div>
    );
};

export default FlowManagementView;
