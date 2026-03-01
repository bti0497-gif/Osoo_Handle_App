import React, { useState } from 'react';
import { useKitViewModel } from './useKitViewModel';
import { useDialog } from '../../components/common/DialogProvider';
import AdvancedDataGrid from '../../components/common/AdvancedDataGrid';

const KitManagementView = ({ currentUser }) => {
    const { showAlert } = useDialog();
    const {
        history, loading, kitTypes,
        updateAmount, submitBatch, refresh, pendingChanges
    } = useKitViewModel(currentUser, { showAlert });

    const [selectedDate, setSelectedDate] = useState(null);
    const [isManualEditMode, setIsManualEditMode] = useState(false);
    const [doubleClickedDate, setDoubleClickedDate] = useState(null);
    const [activeInput, setActiveInput] = useState(null);
    const [localValue, setLocalValue] = useState(null);

    const todayStr = new Date().toISOString().split('T')[0];

    const fmt = (v) => {
        if (v === undefined || v === null || v === '' || isNaN(v)) return '';
        return Number(v).toLocaleString();
    };

    const vibrantColors = ['#1e3a8a', '#047857', '#b45309', '#4338ca', '#57534e'];

    // 동적 너비 계산 (최소 714px 유지, 키트당 156px + 헤더 84px)
    const calculatedWidth = Math.max(714, 84 + kitTypes.length * 156);

    const gridCols = kitTypes.map((type, idx) => ({
        id: type,
        label: type,
        headerStyle: { background: vibrantColors[idx % vibrantColors.length], color: '#fff' },
        subCols: [
            { id: `purchase_${type}`, type: 'purchase', label: '구매', width: 52, headerStyle: { background: vibrantColors[idx % vibrantColors.length], color: '#fff' } },
            { id: `usage_${type}`, type: 'usage', label: '사용', width: 52, headerStyle: { background: '#fef2f2', color: '#991b1b' } },
            { id: `inventory_${type}`, type: 'inventory', label: '재고', width: 52, headerStyle: { background: '#fef3c7', color: '#92400e' } }
        ]
    }));

    const hasPending = Object.keys(pendingChanges).length > 0;

    const handleRowSelect = (row) => {
        if (isManualEditMode && selectedDate === row.date) return;
        setSelectedDate(row.date === selectedDate ? null : row.date);
    };

    const handleRowDoubleClick = (row) => {
        if (row.date !== todayStr && !row.isFuture) {
            setDoubleClickedDate(row.date);
            setSelectedDate(row.date);
            setIsManualEditMode(true);
        }
    };

    const extraActions = (
        <>
            {selectedDate && !isManualEditMode && (
                <button
                    onClick={() => setIsManualEditMode(true)}
                    disabled={history.find(h => h.date === selectedDate)?.isFuture}
                    style={{
                        padding: '5px 14px', borderRadius: 6, border: '1px solid #cbd5e1',
                        fontWeight: 800, fontSize: 11, cursor: history.find(h => h.date === selectedDate)?.isFuture ? 'not-allowed' : 'pointer',
                        background: '#fff', color: '#475569',
                        display: 'flex', alignItems: 'center', gap: 4,
                        opacity: history.find(h => h.date === selectedDate)?.isFuture ? 0.5 : 1
                    }}
                >
                    <span className="material-icons" style={{ fontSize: 14 }}>edit</span>
                    수동으로 수정
                </button>
            )}
            {isManualEditMode && (
                <button
                    onClick={() => {
                        setIsManualEditMode(false);
                        setDoubleClickedDate(null);
                        setSelectedDate(null);
                    }}
                    style={{
                        padding: '5px 14px', borderRadius: 6, border: '1px solid #e2e8f0',
                        fontWeight: 800, fontSize: 11, cursor: 'pointer',
                        background: '#fff', color: '#64748b',
                    }}
                >
                    취소
                </button>
            )}
        </>
    );

    const handleSave = async () => {
        await submitBatch();
        setIsManualEditMode(false);
        setDoubleClickedDate(null);
        setSelectedDate(null);
    };

    const getRowStyle = (row, isSelected, isHovered) => {
        const isToday = row.date === todayStr;
        const isFuture = row.isFuture;
        const isEditingMode = isManualEditMode;

        let bg = 'transparent';
        let opacity = 1;

        if (isEditingMode && !isSelected) {
            bg = '#f8fafc';
            opacity = 0.5;
        } else if (isSelected) {
            bg = '#fef3c7';
        } else if (isToday) {
            bg = '#eff6ff';
        } else if (isFuture) {
            bg = '#fafafa';
        } else if (isHovered && !isEditingMode) {
            bg = '#e2e8f0';
        }

        return {
            background: bg !== 'transparent' ? bg : undefined,
            opacity,
            pointerEvents: (isEditingMode && !isSelected) ? 'none' : 'auto',
            cursor: (isEditingMode && !isSelected) ? 'default' : (isFuture ? 'default' : 'pointer'),
            ...(isSelected ? { outline: '2px solid #f59e0b', outlineOffset: -2, zIndex: 6 } : isToday ? { outline: '2px solid #3b82f6', outlineOffset: -2, zIndex: 5 } : {})
        };
    };

    const renderCell = (row, colGroup, subCol) => {
        const c = colGroup;
        const d = row[c.id] || { purchase: null, usage: null, inventory: null, error: null };

        const changed = pendingChanges[row.date]?.[c.id] !== undefined;
        const isSelected = selectedDate === row.date;
        const isToday = row.date === todayStr;
        const isFuture = row.isFuture;

        const isManual = isSelected && isManualEditMode;
        const isCellDoubleClicked = doubleClickedDate === row.date;
        const isReadOnly = (isFuture || (row.date !== todayStr)) && !isManual && !isCellDoubleClicked;

        const isActive = activeInput?.date === row.date && activeInput?.colId === c.id && activeInput?.type === subCol.type;

        const isInventory = subCol.type === 'inventory';
        const isPurchase = subCol.type === 'purchase';
        const isUsage = subCol.type === 'usage';

        const val = isPurchase ? d.purchase : (isUsage ? d.usage : d.inventory);
        const errorMsg = d.error;

        // 재고는 편집모드가 아니면 읽기전용 표시
        if (isInventory && isReadOnly) {
            return (
                <div style={{
                    width: '100%', height: '100%',
                    padding: '0 3px',
                    textAlign: 'right', fontWeight: 800, fontSize: 10.5,
                    color: val != null && val < 5 ? '#dc2626' : '#475569',
                    background: isFuture ? '#fafafa' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                    borderLeft: '1px solid #e2e8f0'
                }}>
                    {fmt(val) || '-'}
                </div>
            );
        }

        const bgColor = isPurchase ? '#eff6ff' : (isUsage ? '#fef2f2' : '#fef3c7');
        const activeBg = isPurchase ? '#dbeafe' : (isUsage ? '#fee2e2' : '#fef3c7');

        const displayVal = val != null ? Number(val).toLocaleString() : '';

        return (
            <div style={{ width: '100%', height: '100%', padding: '0 4px', background: errorMsg ? '#fee2e2' : ((isManual || isCellDoubleClicked || isToday) ? activeBg : (isFuture ? '#f5f5f5' : 'transparent')), display: 'flex', alignItems: 'center', justifyContent: 'flex-end', boxSizing: 'border-box' }} title={errorMsg || ''}>
                {isReadOnly ? (
                    <span style={{ fontWeight: 700, fontSize: 11, color: errorMsg ? '#dc2626' : (changed ? '#1d4ed8' : '#1e293b') }}>
                        {displayVal || '-'}
                    </span>
                ) : (
                    <input
                        type="text"
                        style={{
                            width: '100%', height: '100%', outline: 'none',
                            textAlign: 'right', fontWeight: 700, fontSize: 11,
                            color: errorMsg ? '#dc2626' : (changed && !isReadOnly ? '#1d4ed8' : '#1e293b'),
                            background: 'transparent',
                            border: errorMsg ? '2px inset #ef4444' : 'none',
                            boxSizing: 'border-box'
                        }}
                        value={isActive ? localValue : displayVal}
                        placeholder="-"
                        onChange={e => setLocalValue(e.target.value.replace(/,/g, ''))}
                        onFocus={() => {
                            if (isReadOnly) return;
                            setActiveInput({ date: row.date, colId: c.id, type: subCol.type });
                            setLocalValue(val != null ? String(val) : '');
                        }}
                        onBlur={() => {
                            if (isActive && localValue !== null) {
                                updateAmount(row.date, c.id, subCol.type, localValue);
                            }
                            setActiveInput(null);
                            setLocalValue(null);
                        }}
                        disabled={isReadOnly}
                    />
                )}
            </div>
        );
    };


    const renderRowHeader = (row) => {
        const isToday = row.date === todayStr;
        const isFuture = row.isFuture;
        const isSelected = selectedDate === row.date;
        return (
            <div style={{
                width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: isToday ? 900 : 800, fontSize: 10.5,
                color: isToday ? '#1d4ed8' : isFuture ? '#a0aec0' : '#475569',
                background: isSelected ? '#e2e8f0' : isToday ? '#dbeafe' : '#f8fafc',
            }}>
                {row.date}
            </div>
        );
    };

    return (
        <div style={{
            display: 'flex', flexDirection: 'column',
            height: '100%', width: calculatedWidth,
            backgroundColor: '#FFFFFF',
            borderRight: '1px solid #e2e8f0',
        }}>
            <AdvancedDataGrid
                title="분석키트 구매/사용/재고 관리"
                description="구매량과 사용량을 입력하면 재고가 자동 누적 계산됩니다."
                columns={gridCols}
                data={history}
                keyField="date"
                scrollToKey={todayStr}
                width={calculatedWidth}
                height={400}

                showBottomBar={false}
                selectionMode="row"
                enableEditing={false}
                contextMenu={false}
                rowHeaderWidth={84}
                rowHeaderLabel="날짜"

                onRowSelect={handleRowSelect}
                onCellDoubleClick={(row) => handleRowDoubleClick(row)}
                getRowStyle={getRowStyle}
                renderRowHeader={(row) => renderRowHeader(row)}
                renderCell={renderCell}

                onRefresh={refresh}
            />

            {/* 가운데 여유 공간 */}
            <div style={{ flex: 1 }} />

            {/* 하단 바 */}
            <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 16px', borderTop: '1px solid #e2e8f0', background: '#f8fafc', flexShrink: 0
            }}>
                <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600 }}>
                    총 {history.length}행
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                    {extraActions}
                    <button
                        onClick={handleSave}
                        disabled={!(hasPending || isManualEditMode) || loading}
                        style={{
                            padding: '5px 14px', borderRadius: 6, border: 'none',
                            fontWeight: 800, fontSize: 11, cursor: (hasPending || isManualEditMode) ? 'pointer' : 'default',
                            background: (hasPending || isManualEditMode) ? '#1e293b' : '#e2e8f0',
                            color: (hasPending || isManualEditMode) ? '#fff' : '#94a3b8',
                            display: 'flex', alignItems: 'center', gap: 4
                        }}
                    >
                        <span className="material-icons" style={{ fontSize: 14 }}>{(hasPending || isManualEditMode) ? 'save_alt' : 'check'}</span>
                        {loading ? '저장 중...' : (isManualEditMode || hasPending ? (isManualEditMode ? "수정사항 저장" : "재고 기록 저장") : '변경사항 없음')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default KitManagementView;
