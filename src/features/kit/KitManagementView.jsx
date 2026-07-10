import React, { useMemo, useState } from 'react';
import { useKitViewModel } from './useKitViewModel';
import { useSettingsViewModel } from '../settings/useSettingsViewModel';
import { useDialog } from '../../components/common/DialogContext';
import AdvancedDataGrid from '../../components/common/AdvancedDataGrid';
import { ADVANCED_DATAGRID_READ_ONLY_PROPS } from '../../components/common/advancedDataGridPresets';
import UnifiedRecordModal from '../records/UnifiedRecordModal';
import { getTodayKST } from '../../core/constants';

const COLORS = ['#1e3a8a', '#047857', '#b45309', '#4338ca', '#57534e'];

const todayText = () => getTodayKST();

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
        <button type="button" onClick={onOpen} disabled={loading} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #2563eb', background: '#eff6ff', color: '#1d4ed8', fontWeight: 900, cursor: loading ? 'not-allowed' : 'pointer' }}>통합 데이터 작성</button>
    </div>
);

const KitManagementView = ({ currentUser, workspaceSession = {}, onWorkspaceSessionChange }) => {
    const { showAlert } = useDialog();
    const { itemState = {} } = useSettingsViewModel();
    const { flowItems = [], medicineItems = [], locationItems = [], kitItems = [] } = itemState;
    const {
        history = [],
        loading,
        kitTypes = [],
        isSyncingAnalysisKits,
        syncAnalysisKits,
        refresh,
    } = useKitViewModel(currentUser, { showAlert });

    const [selectedDate, setSelectedDate] = useState(() => workspaceSession.selectedKey || null);
    const [modalState, setModalState] = useState({ open: false, tab: 'kit', mode: 'add' });
    const todayStr = todayText();
    const defaultSelectedDate = history.some((row) => row.date === selectedDate) ? selectedDate : todayStr;

    const selectedRow = history.find((row) => row.date === selectedDate) || null;

    const activeKitNames = useMemo(() => {
        if (kitTypes.length > 0) return kitTypes;
        return kitItems.filter((item) => item.checked).map((item) => item.name);
    }, [kitTypes, kitItems]);

    const kitDefaultAmountMap = useMemo(() => {
        const map = new Map();
        kitItems.forEach((item) => {
            map.set(String(item.name || '').trim(), Number(item.defaultAmount) || 0);
        });
        return map;
    }, [kitItems]);

    const gridCols = activeKitNames.map((name, idx) => ({
        id: name,
        label: name,
        headerStyle: { background: COLORS[idx % COLORS.length], color: '#fff' },
        subCols: [
            { id: `purchase_${name}`, type: 'purchase', label: '구매', width: 52, headerStyle: { background: COLORS[idx % COLORS.length], color: '#fff' } },
            { id: `usage_${name}`, type: 'usage', label: '사용', width: 52, headerStyle: { background: '#fef2f2', color: '#991b1b' } },
            { id: `inventory_${name}`, type: 'inventory', label: '재고', width: 58, headerStyle: { background: '#fef3c7', color: '#92400e' } },
        ],
    }));

    const buildModalContexts = () => ({
        flow: { items: flowItems.filter((item) => item.checked).map((item) => ({ key: item.name, label: item.name, values: {}, previous: {}, summary: [] })) },
        medicine: { items: medicineItems.filter((item) => item.checked).map((item) => ({ key: item.name, label: item.name, values: {}, previous: {}, summary: [] })) },
        water: { items: locationItems.filter((item) => item.checked).map((item) => ({ key: item.name, label: item.name, values: {}, previous: {}, summary: [] })) },
        kit: {
            items: activeKitNames.map((name) => {
                const cell = selectedRow?.[name] || {};
                const prev = getPreviousInventoryCell(history, selectedDate, name);
                return {
                    key: name,
                    label: name,
                    defaultPurchase: kitDefaultAmountMap.get(String(name).trim()) ?? 0,
                    values: {
                        purchase: cell.purchase ?? '',
                        usage: cell.usage ?? '',
                        inventory: cell.inventory ?? '',
                    },
                    previous: { inventory: prev?.inventory ?? '' },
                    summary: [
                        { label: '직전 재고', value: prev?.inventory },
                        { label: '현재 구매', value: cell.purchase },
                        { label: '현재 사용', value: cell.usage },
                        { label: '현재 재고', value: cell.inventory },
                    ],
                };
            }),
        },
    });

    const handleRowSelect = (row) => {
        if (row.isFuture || row.date > todayStr) return;
        setSelectedDate(row.date);
        onWorkspaceSessionChange?.({ selectedKey: row.date });
    };

    const openModal = (mode = 'add') => {
        setModalState({ open: true, tab: 'kit', mode });
    };

    const hasSelectedRowData = () => {
        if (!selectedRow) return false;
        return activeKitNames.some((name) => {
            const cell = selectedRow[name];
            return cell?.purchase !== null && cell?.purchase !== undefined
                || cell?.usage !== null && cell?.usage !== undefined
                || cell?.inventory !== null && cell?.inventory !== undefined;
        });
    };

    const openUnifiedModal = () => {
        openModal(hasSelectedRowData() ? 'edit' : 'add');
    };

    const handleSaveComplete = async ({ date }) => {
        setSelectedDate(date);
        onWorkspaceSessionChange?.({ selectedKey: date });
        await refresh();
    };

    const renderCell = (row, col) => {
        const kitName = col.parentId;
        if (!kitName) return null;
        const cell = row[kitName] || {};
        const value = col.type === 'purchase' ? cell.purchase : col.type === 'usage' ? cell.usage : cell.inventory;
        const isLowInventory = col.type === 'inventory' && value != null && Number(value) < 5;
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
        <div className="flow-management-view">
            <div className="flow-management-view__grid-scroll">
                <AdvancedDataGrid
                    {...ADVANCED_DATAGRID_READ_ONLY_PROPS}
                    title="분석키트 구매/사용/재고 데이터"
                    description="그리드는 조회와 행 선택만 지원합니다. 추가와 수정은 통합 입력 모달에서 확인합니다."
                    columns={gridCols}
                    data={history}
                    keyField="date"
                    defaultSelectedRowKey={defaultSelectedDate}
                    scrollToKey={Number.isFinite(workspaceSession.scrollTop) ? null : todayStr}
                    initialScrollTop={workspaceSession.scrollTop}
                    onScrollPositionChange={(scrollTop) => onWorkspaceSessionChange?.({ scrollTop })}
                    width="100%"
                    height={360}
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
                initialDate={selectedDate || todayStr}
                contexts={buildModalContexts()}
                isSyncingAnalysisKits={isSyncingAnalysisKits}
                onClose={() => setModalState((prev) => ({ ...prev, open: false }))}
                onSaveComplete={handleSaveComplete}
                onSyncAnalysisKits={syncAnalysisKits}
            />
        </div>
    );
};

export default KitManagementView;
