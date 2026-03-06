import React, { useState, useEffect, useRef } from 'react';
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
    const [doubleClickedCell, setDoubleClickedCell] = useState(null); // { date, colId }
    const [activeInput, setActiveInput] = useState(null);
    const [localValue, setLocalValue] = useState(null);
    const [todaySaved, setTodaySaved] = useState(false);
    const closeModeAfterBlurRef = useRef(false);

    const todayStr = new Date().toISOString().split('T')[0];

    const closeEditMode = () => {
        setIsManualEditMode(false);
        setDoubleClickedCell(null);
        setSelectedDate(null);
    };

    useEffect(() => {
        const handleEsc = (e) => {
            if (e.key !== 'Escape') return;

            const activeElement = document.activeElement;
            const isEditableElement = activeElement && ['INPUT', 'TEXTAREA'].includes(activeElement.tagName);

            if (isEditableElement && activeInput) {
                closeModeAfterBlurRef.current = true;
                activeElement.blur();
                return;
            }

            if (isManualEditMode || doubleClickedCell) {
                closeEditMode();
            }
        };

        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [activeInput, isManualEditMode, doubleClickedCell]);

    const fmt = (v) => {
        if (v === undefined || v === null || v === '' || isNaN(v)) return '';
        return Number(v).toLocaleString();
    };

    const vibrantColors = ['#1e3a8a', '#047857', '#b45309', '#4338ca', '#57534e'];

    // 동적 너비 계산 (최소 714px 유지, 키트당 156px + 헤더 84px + 버퍼 40px)
    const calculatedWidth = Math.max(714, 84 + kitTypes.length * 156 + 40);

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
        const isFutureRow = row.isFuture || row.date > todayStr;
        if (isFutureRow) return; // 미래 날짜 선택 차단
        if (isManualEditMode && selectedDate === row.date) return;
        setSelectedDate(row.date === selectedDate ? null : row.date);
    };

    const handleCellDoubleClick = (row, col) => {
        const isFutureRow = row.isFuture || row.date > todayStr;
        if (isFutureRow) return; // 미래 날짜 더블클릭 차단
        if (row.date !== todayStr || todaySaved) {
            setDoubleClickedCell({ date: row.date, colId: col.id });
            setSelectedDate(row.date);
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
                    onClick={closeEditMode}
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
        setTodaySaved(true);
        closeEditMode();
    };

    const getRowStyle = (row, isSelected, isHovered) => {
        const isToday = row.date === todayStr;
        const isFuture = row.isFuture || row.date > todayStr;
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
            pointerEvents: (isFuture || (isEditingMode && !isSelected)) ? 'none' : 'auto',
            cursor: (isFuture || (isEditingMode && !isSelected)) ? 'default' : 'pointer',
            userSelect: isFuture ? 'none' : 'auto'
        };
    };

    const renderCell = (row, col, val, isCellTargeted) => {
        // col is a leaf column from AdvancedDataGrid: { id, type, parentId, ... }
        const kitName = col.parentId; // 키트명 (parent group id)
        if (!kitName) return val;

        const subType = col.type; // 'purchase' | 'usage' | 'inventory'
        const d = row[kitName] || { purchase: null, usage: null, inventory: null, error: null };

        const changed = pendingChanges[row.date]?.[kitName] !== undefined;
        const isSelected = selectedDate === row.date;
        const isToday = row.date === todayStr;
        const isFuture = row.isFuture || row.date > todayStr;

        const isManual = isSelected && isManualEditMode;
        const isCellDoubleClicked = doubleClickedCell?.date === row.date && doubleClickedCell?.colId === col.id;
        const isReadOnly = (isFuture || row.date !== todayStr || todaySaved) && !isManual && !isCellDoubleClicked;

        const isActive = activeInput?.date === row.date && activeInput?.colId === kitName && activeInput?.type === subType;

        const isInventory = subType === 'inventory';
        const isPurchase = subType === 'purchase';
        const isUsage = subType === 'usage';

        const cellVal = isPurchase ? d.purchase : (isUsage ? d.usage : d.inventory);
        const errorMsg = d.error;

        // 재고: 수동수정 모드에서만 편집 가능, 더블클릭이나 일반 모드에서는 읽기전용
        if (isInventory && !isManual) {
            return (
                <div style={{
                    position: 'absolute', inset: 0,
                    padding: '0 3px',
                    textAlign: 'right', fontWeight: 800, fontSize: 10.5,
                    color: cellVal != null && cellVal < 5 ? '#dc2626' : '#475569',
                    background: isFuture ? '#fafafa' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                    boxSizing: 'border-box',
                    borderLeft: '1px solid #e2e8f0',
                    pointerEvents: isFuture ? 'none' : 'auto',
                    opacity: isFuture ? 0.6 : 1
                }}>
                    {fmt(cellVal) || '-'}
                </div>
            );
        }

        const displayVal = cellVal != null ? Number(cellVal).toLocaleString() : '';

        // 편집 가능할 때만 노란색
        const cellBg = errorMsg ? '#fee2e2'
            : (!isReadOnly && (isManual || isCellDoubleClicked || isToday)) ? '#fef08a'
                : (isFuture ? '#f5f5f5' : 'transparent');

        return (
            <div style={{
                position: 'absolute', inset: 0,
                padding: '0 4px',
                background: cellBg,
                display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                boxSizing: 'border-box',
                pointerEvents: isFuture ? 'none' : 'auto',
                opacity: isFuture ? 0.6 : 1
            }} title={errorMsg || ''}>
                {isReadOnly ? (
                    <span style={{ fontWeight: 700, fontSize: 11, color: errorMsg ? '#dc2626' : (changed ? '#1d4ed8' : '#1e293b') }}>
                        {displayVal || '-'}
                    </span>
                ) : (
                    <input
                        type="text"
                        autoFocus={isCellDoubleClicked}
                        style={{
                            width: '100%', height: '100%', outline: 'none',
                            textAlign: 'right', fontWeight: 700, fontSize: 11,
                            color: errorMsg ? '#dc2626' : (changed && !isReadOnly ? '#1d4ed8' : '#1e293b'),
                            background: 'transparent',
                            border: errorMsg ? '2px inset #ef4444' : 'none',
                            boxSizing: 'border-box',
                            pointerEvents: isReadOnly ? 'none' : 'auto'
                        }}
                        value={isActive ? localValue : displayVal}
                        placeholder="-"
                        onChange={e => setLocalValue(e.target.value.replace(/,/g, ''))}
                        onKeyDown={e => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                            if (e.key === 'Escape') {
                                closeModeAfterBlurRef.current = true;
                                e.preventDefault();
                                e.stopPropagation();
                                e.currentTarget.blur();
                            }
                        }}
                        onFocus={e => {
                            if (isReadOnly) return;
                            setActiveInput({ date: row.date, colId: kitName, type: subType });
                            setLocalValue(cellVal != null ? String(cellVal) : '');
                            if (!isCellDoubleClicked) e.target.select();
                        }}
                        onBlur={async () => {
                            if (isActive && localValue !== null) {
                                updateAmount(row.date, kitName, subType, localValue);
                            }
                            setActiveInput(null);
                            setLocalValue(null);
                            if (isCellDoubleClicked) {
                                setDoubleClickedCell(null);
                                await submitBatch({ targetDates: history.filter(item => item.date >= row.date).map(item => item.date), silent: true });
                            }
                            if (closeModeAfterBlurRef.current) {
                                closeModeAfterBlurRef.current = false;
                                await submitBatch({ targetDates: history.filter(item => item.date >= row.date).map(item => item.date), silent: true });
                                closeEditMode();
                            }
                        }}
                        disabled={isReadOnly}
                    />
                )}
            </div>
        );
    };


    const renderRowHeader = (row) => {
        const isToday = row.date === todayStr;
        const isFuture = row.isFuture || row.date > todayStr;
        const isSelected = selectedDate === row.date;
        return (
            <div style={{
                width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: isToday ? 900 : 800, fontSize: 10.5,
                color: isToday ? '#1d4ed8' : isFuture ? '#a0aec0' : '#475569',
                background: isSelected ? '#e2e8f0' : isToday ? '#dbeafe' : '#f8fafc',
                pointerEvents: isFuture ? 'none' : 'auto',
                cursor: isFuture ? 'default' : 'pointer'
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
                onCellDoubleClick={(row, col) => handleCellDoubleClick(row, col)}
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
