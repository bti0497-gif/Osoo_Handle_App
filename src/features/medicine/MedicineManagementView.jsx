import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMedicineViewModel } from './useMedicineViewModel';
import { useSettingsViewModel } from '../settings/useSettingsViewModel';
import { useDialog } from '../../components/common/DialogContext';
import AdvancedDataGrid from '../../components/common/AdvancedDataGrid';
import { ADVANCED_DATAGRID_READ_ONLY_PROPS } from '../../components/common/advancedDataGridPresets';
import UnifiedRecordModal from '../records/UnifiedRecordModal';

const COLORS = ['#1e3a8a', '#047857', '#b45309', '#4338ca', '#57534e'];

const todayText = () => new Date().toISOString().split('T')[0];

const formatNumber = (value) => {
    if (value === null || value === undefined || value === '' || Number.isNaN(Number(value))) return '';
    return Number(value).toLocaleString();
};

const getPreviousInventoryCell = (history, selectedDate, name) => {
    const idx = history.findIndex((row) => row.date === selectedDate);
    for (let i = idx - 1; i >= 0; i -= 1) {
        const cell = history[i]?.[name];
        if (cell?.inventory !== null && cell?.inventory !== undefined) return cell;
    }
    return null;
};

const MedicineManagementView = ({ currentUser }) => {
    const { showAlert } = useDialog();
    const { itemState = {} } = useSettingsViewModel();
    const { flowItems = [], medicineItems = [], locationItems = [], kitItems = [] } = itemState;
    const { history = [], loading, medicineTypes = [], refresh } = useMedicineViewModel(currentUser, { showAlert });

    const [selectedDate, setSelectedDate] = useState(null);
    const [modalState, setModalState] = useState({ open: false, tab: 'medicine', mode: 'add' });
    const didInitTodaySelectRef = useRef(false);
    const didInitTodayScrollRef = useRef(false);
    const todayStr = todayText();

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

    const activeMedicineNames = useMemo(() => {
        if (medicineTypes.length > 0) return medicineTypes;
        return medicineItems.filter((item) => item.checked).map((item) => item.name);
    }, [medicineTypes, medicineItems]);

    const gridCols = activeMedicineNames.map((name, idx) => ({
        id: name,
        label: name,
        headerStyle: { background: COLORS[idx % COLORS.length], color: '#fff' },
        subCols: [
            { id: `purchase_${name}`, type: 'purchase', label: '입고', width: 52, headerStyle: { background: COLORS[idx % COLORS.length], color: '#fff' } },
            { id: `usage_${name}`, type: 'usage', label: '사용', width: 52, headerStyle: { background: '#fef2f2', color: '#991b1b' } },
            { id: `inventory_${name}`, type: 'inventory', label: '재고', width: 58, headerStyle: { background: '#fef3c7', color: '#92400e' } },
        ],
    }));

    const buildModalContexts = () => ({
        flow: { items: flowItems.filter((item) => item.checked).map((item) => ({ key: item.name, label: item.name, values: {}, previous: {}, summary: [] })) },
        medicine: {
            items: activeMedicineNames.map((name) => {
                const cell = selectedRow?.[name] || {};
                const prev = getPreviousInventoryCell(history, selectedDate, name);
                return {
                    key: name,
                    label: name,
                    values: {
                        purchase: cell.purchase ?? '',
                        usage: cell.usage ?? '',
                        inventory: cell.inventory ?? '',
                    },
                    previous: { inventory: prev?.inventory ?? '' },
                    summary: [
                        { label: '직전 재고', value: prev?.inventory },
                        { label: '현재 입고', value: cell.purchase },
                        { label: '현재 사용', value: cell.usage },
                        { label: '현재 재고', value: cell.inventory },
                    ],
                };
            }),
        },
        water: { items: locationItems.filter((item) => item.checked).map((item) => ({ key: item.name, label: item.name, values: {}, previous: {}, summary: [] })) },
        kit: { items: kitItems.filter((item) => item.checked).map((item) => ({ key: item.name, label: item.name, values: {}, previous: {}, summary: [] })) },
    });

    const handleRowSelect = (row) => {
        if (row.isFuture || row.date > todayStr) return;
        setSelectedDate(row.date);
    };

    const openModal = (mode = 'add') => {
        setModalState({ open: true, tab: 'medicine', mode });
    };

    const renderCell = (row, col) => {
        const medicineName = col.parentId;
        if (!medicineName) return null;
        const cell = row[medicineName] || {};
        const value = col.type === 'purchase' ? cell.purchase : col.type === 'usage' ? cell.usage : cell.inventory;
        const isLowInventory = col.type === 'inventory' && value != null && Number(value) < 50;
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
                color: cell.error ? '#dc2626' : isLowInventory ? '#dc2626' : '#1e293b',
                background: row.isFuture ? '#fafafa' : 'transparent',
            }} title={cell.error || ''}>
                {formatNumber(value)}
            </div>
        );
    };

    const getRowStyle = (row, _selected, isHovered) => {
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

    const renderRowHeader = (row) => (
        <div style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: row.date === todayStr ? 900 : 800,
            fontSize: 10.5,
            color: row.date === selectedDate ? '#92400e' : row.date === todayStr ? '#1d4ed8' : row.isFuture ? '#a0aec0' : '#475569',
            background: row.date === selectedDate ? '#fde68a' : row.date === todayStr ? '#dbeafe' : '#f8fafc',
        }}>
            {row.date}
        </div>
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', minWidth: 0, minHeight: 0, backgroundColor: '#fff' }}>
            <AdvancedDataGrid
                {...ADVANCED_DATAGRID_READ_ONLY_PROPS}
                title="약품 입고/사용/재고 데이터"
                description="그리드는 조회와 행 선택만 지원합니다. 추가와 수정은 통합 입력 모달에서 확인합니다."
                columns={gridCols}
                data={history}
                keyField="date"
                scrollToKey={didInitTodayScrollRef.current ? null : todayStr}
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

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', borderTop: '1px solid #e2e8f0', background: '#f8fafc', flexShrink: 0 }}>
                <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 800 }}>총 {history.length}일</span>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" onClick={() => openModal('add')} disabled={loading} style={{ padding: '8px 14px', borderRadius: 6, border: '1px solid #2563eb', background: '#eff6ff', color: '#1d4ed8', fontWeight: 900, cursor: 'pointer' }}>추가</button>
                    <button type="button" onClick={() => openModal('edit')} disabled={!selectedDate || loading} style={{ padding: '8px 14px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', color: selectedDate ? '#334155' : '#94a3b8', fontWeight: 900, cursor: selectedDate ? 'pointer' : 'not-allowed' }}>수정</button>
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

export default MedicineManagementView;
