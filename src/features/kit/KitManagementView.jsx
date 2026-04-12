import React, { useState, useEffect } from 'react';
import { useKitViewModel } from './useKitViewModel';
import { useDialog } from '../../components/common/DialogProvider';
import AdvancedDataGrid from '../../components/common/AdvancedDataGrid';

const KitManagementView = ({ currentUser }) => {
    const { showAlert } = useDialog();
    const {
        history, loading, kitTypes,
        isSyncingAnalysisKits, lastKitSyncSummary,
        showPurchaseModal, setShowPurchaseModal,
        purchaseDate, setPurchaseDate,
        purchaseItems, setPurchaseItems,
        isSavingPurchase,
        autoSaveStatus,
        openPurchaseModal, savePurchase,
        updateAmount, submitBatch, syncAnalysisKits, refresh, pendingChanges
    } = useKitViewModel(currentUser, { showAlert });

    const [selectedDate, setSelectedDate] = useState(null);
    const [doubleClickedCell, setDoubleClickedCell] = useState(null); // { date, colId }
    const [selectedUsageCell, setSelectedUsageCell] = useState(null); // { date, kitName }
    const [activeInput, setActiveInput] = useState(null);
    const [localValue, setLocalValue] = useState(null);
    const [isCellSelecting, setIsCellSelecting] = useState(false);

    const todayStr = new Date().toISOString().split('T')[0];
    const syncBaseDate = selectedDate || todayStr;

    const closeEditMode = () => {
        setDoubleClickedCell(null);
    };

    useEffect(() => {
        const handleEsc = (e) => {
            if (e.key !== 'Escape') return;

            const activeElement = document.activeElement;
            const isEditableElement = activeElement && ['INPUT', 'TEXTAREA'].includes(activeElement.tagName);

            if (isEditableElement && activeInput) {
                activeElement.blur();
                return;
            }

            if (doubleClickedCell) {
                closeEditMode();
            }
        };

        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [activeInput, doubleClickedCell]);

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
        if (!isCellSelecting) {
            setSelectedUsageCell(null);
        }
        setIsCellSelecting(false);
        setSelectedDate(row.date);
    };

    const handleCellDoubleClick = (row, col) => {
        const isFutureRow = row.isFuture || row.date > todayStr;
        if (isFutureRow) return; // 미래 날짜 더블클릭 차단
        setDoubleClickedCell({ date: row.date, colId: col.id });
        setSelectedDate(row.date);
    };

    const handleSyncAnalysis = async () => {
        await syncAnalysisKits(syncBaseDate);
    };

    const handleAdjustUsage = (delta) => {
        // 셀 우선: 같은 날짜/키트의 사용량만 증감
        if (selectedUsageCell?.date && selectedUsageCell?.kitName) {
            const row = history.find(r => r.date === selectedUsageCell.date);
            if (!row) return;
            const current = Number(row[selectedUsageCell.kitName]?.usage || 0);
            const next = Math.max(0, current + delta);
            updateAmount(selectedUsageCell.date, selectedUsageCell.kitName, 'usage', String(next));
            return;
        }

        // 행 선택: 해당 날짜의 모든 키트 사용량 일괄 증감
        if (selectedDate) {
            const row = history.find(r => r.date === selectedDate);
            if (!row) return;
            kitTypes.forEach((kitName) => {
                const current = Number(row[kitName]?.usage || 0);
                const next = Math.max(0, current + delta);
                updateAmount(selectedDate, kitName, 'usage', String(next));
            });
            return;
        }

        showAlert('먼저 날짜 행 또는 셀을 선택하세요.');
    };

    const saveStatusText = autoSaveStatus === 'saving'
        ? '저장 중...'
        : autoSaveStatus === 'saved'
            ? '저장완료..'
            : autoSaveStatus === 'error'
                ? '저장 실패'
                : '변경사항 없음';

    const getRowStyle = (row, isSelected, isHovered) => {
        const isToday = row.date === todayStr;
        const isFuture = row.isFuture || row.date > todayStr;

        let bg = 'transparent';
        let opacity = 1;

        if (isSelected) {
            bg = '#fef3c7';
        } else if (isToday) {
            bg = '#eff6ff';
        } else if (isFuture) {
            bg = '#fafafa';
        } else if (isHovered) {
            bg = '#e2e8f0';
        }

        return {
            background: bg !== 'transparent' ? bg : undefined,
            opacity,
            pointerEvents: isFuture ? 'none' : 'auto',
            cursor: isFuture ? 'default' : 'pointer',
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
        const isFuture = row.isFuture || row.date > todayStr;

        const isCellDoubleClicked = doubleClickedCell?.date === row.date && doubleClickedCell?.colId === col.id;
        const isReadOnly = isFuture || !isCellDoubleClicked;

        const isActive = activeInput?.date === row.date && activeInput?.colId === kitName && activeInput?.type === subType;

        const isInventory = subType === 'inventory';
        const isPurchase = subType === 'purchase';
        const isUsage = subType === 'usage';
        const isUsageCellSelected = selectedUsageCell?.date === row.date && selectedUsageCell?.kitName === kitName;

        const cellVal = isPurchase ? d.purchase : (isUsage ? d.usage : d.inventory);
        const errorMsg = d.error;

        // 재고는 직접 편집하지 않고 계산 결과만 표시
        if (isInventory) {
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
                    outline: isUsageCellSelected ? '2px solid #22c55e' : 'none',
                    pointerEvents: isFuture ? 'none' : 'auto',
                    opacity: isFuture ? 0.6 : 1
                }}
                    onMouseDown={() => setIsCellSelecting(true)}
                    onClick={() => {
                        if (isFuture) return;
                        setSelectedUsageCell({ date: row.date, kitName });
                        setSelectedDate(row.date);
                    }}
                >
                    {fmt(cellVal) || ''}
                </div>
            );
        }

        const displayVal = cellVal != null ? Number(cellVal).toLocaleString() : '';

        // 편집 가능할 때만 노란색
        const cellBg = errorMsg ? '#fee2e2'
            : (isCellDoubleClicked ? '#fef08a' : (isFuture ? '#f5f5f5' : 'transparent'));

        return (
            <div style={{
                position: 'absolute', inset: 0,
                padding: '0 4px',
                background: cellBg,
                display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                boxSizing: 'border-box',
                outline: isUsageCellSelected ? '2px solid #22c55e' : 'none',
                pointerEvents: isFuture ? 'none' : 'auto',
                opacity: isFuture ? 0.6 : 1
            }}
                title={errorMsg || ''}
                onMouseDown={() => setIsCellSelecting(true)}
                onClick={() => {
                    if (isFuture) return;
                    setSelectedUsageCell({ date: row.date, kitName });
                    setSelectedDate(row.date);
                }}
            >
                {isReadOnly ? (
                    <span style={{ fontWeight: 700, fontSize: 11, color: errorMsg ? '#dc2626' : (changed ? '#1d4ed8' : '#1e293b') }}>
                        {displayVal || ''}
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
                        onChange={e => setLocalValue(e.target.value.replace(/,/g, ''))}
                        onKeyDown={e => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                            if (e.key === 'Escape') {
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
                        onBlur={() => {
                            if (isActive && localValue !== null) {
                                updateAmount(row.date, kitName, subType, localValue);
                            }
                            setActiveInput(null);
                            setLocalValue(null);
                            if (isCellDoubleClicked) {
                                setDoubleClickedCell(null);
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
        <>
        <div style={{
            display: 'flex', flexDirection: 'column',
            height: '100%', width: calculatedWidth,
            backgroundColor: '#FFFFFF',
            borderRight: '1px solid #e2e8f0',
        }}>
            <AdvancedDataGrid
                title="분석키트 구매/사용/재고 관리"
                description="셀 더블클릭으로만 구매/사용을 수정하며, 재고는 수정일 이후 자동 재계산됩니다."
                columns={gridCols}
                data={history}
                keyField="date"
                scrollToKey={todayStr}
                width={calculatedWidth}
                height={300}

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

            {/* 분석키트 동기화 + 구매 영역 */}
            <div style={{
                borderTop: '1px dashed #e2e8f0',
                borderBottom: '1px solid #e2e8f0',
                background: '#ffffff',
                padding: '10px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                minHeight: 84
            }}>
                {/* 구매 행 */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#475569' }}>
                        분석키트 구매 ({selectedDate ? `기준일: ${syncBaseDate}` : `오늘: ${todayStr}`})
                    </div>
                    <button
                        onClick={() => openPurchaseModal(syncBaseDate)}
                        disabled={loading}
                        style={{
                            padding: '6px 14px',
                            borderRadius: 6,
                            border: '1px solid #3b82f6',
                            fontWeight: 800,
                            fontSize: 11,
                            cursor: loading ? 'not-allowed' : 'pointer',
                            background: loading ? '#e2e8f0' : '#eff6ff',
                            color: loading ? '#94a3b8' : '#1d4ed8'
                        }}
                    >
                        분석키트 구매 입력
                    </button>
                </div>
                {/* 동기화 행 */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#475569' }}>
                        분석키트 동기화 ({selectedDate ? `기준월: ${syncBaseDate.slice(0, 7)}` : `올해 전체 (${new Date().getFullYear()}-01-01 ~ 오늘)`})
                    </div>
                    <button
                        onClick={handleSyncAnalysis}
                        disabled={isSyncingAnalysisKits || loading}
                        style={{
                            padding: '6px 14px',
                            borderRadius: 6,
                            border: '1px solid #cbd5e1',
                            fontWeight: 800,
                            fontSize: 11,
                            cursor: (isSyncingAnalysisKits || loading) ? 'not-allowed' : 'pointer',
                            background: (isSyncingAnalysisKits || loading) ? '#e2e8f0' : '#ffffff',
                            color: (isSyncingAnalysisKits || loading) ? '#94a3b8' : '#1e293b'
                        }}
                    >
                        {isSyncingAnalysisKits ? '동기화 중...' : '분석키트 동기화'}
                    </button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#475569' }}>
                        분석횟수 보정 ({selectedUsageCell ? `셀 기준: ${selectedUsageCell.date} / ${selectedUsageCell.kitName}` : (selectedDate ? `행 기준: ${selectedDate} 전체 키트` : '선택 필요')})
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button
                            onClick={() => handleAdjustUsage(1)}
                            disabled={loading}
                            style={{
                                padding: '6px 12px',
                                borderRadius: 6,
                                border: '1px solid #16a34a',
                                fontWeight: 800,
                                fontSize: 11,
                                cursor: loading ? 'not-allowed' : 'pointer',
                                background: loading ? '#e2e8f0' : '#f0fdf4',
                                color: loading ? '#94a3b8' : '#166534'
                            }}
                        >분석횟수 +1</button>
                        <button
                            onClick={() => handleAdjustUsage(-1)}
                            disabled={loading}
                            style={{
                                padding: '6px 12px',
                                borderRadius: 6,
                                border: '1px solid #dc2626',
                                fontWeight: 800,
                                fontSize: 11,
                                cursor: loading ? 'not-allowed' : 'pointer',
                                background: loading ? '#e2e8f0' : '#fef2f2',
                                color: loading ? '#94a3b8' : '#991b1b'
                            }}
                        >분석횟수 -1</button>
                    </div>
                </div>
                {lastKitSyncSummary && (
                    <div style={{ fontSize: 10, color: '#334155', lineHeight: 1.45 }}>
                        적용구간 {lastKitSyncSummary.startDate} ~ {lastKitSyncSummary.endDate} |
                        {(lastKitSyncSummary.summary?.updatedCellCount || 0) > 0
                            ? ` 신규반영 ${lastKitSyncSummary.summary.unsyncedDateCount}일 (${lastKitSyncSummary.summary.updatedCellCount}셀)`
                            : ` 변경없음`
                        } | 이미일치 {lastKitSyncSummary.summary?.alreadyMatchedCellCount || 0}셀
                    </div>
                )}
            </div>

            {/* 하단 바 */}
            <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 16px',
                borderTop: '1px solid #e2e8f0',
                background: '#f8fafc',
                flexShrink: 0,
                marginTop: 'auto',
                position: 'sticky',
                bottom: 0,
                zIndex: 5
            }}>
                <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600 }}>
                    총 {history.length}행
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button
                        onClick={() => {}}
                        disabled={true}
                        style={{
                            padding: '5px 14px', borderRadius: 6, border: 'none',
                            fontWeight: 800, fontSize: 11, cursor: 'default',
                            background: autoSaveStatus === 'saving' ? '#1e293b' : '#e2e8f0',
                            color: autoSaveStatus === 'saving' ? '#fff' : '#94a3b8',
                            display: 'flex', alignItems: 'center', gap: 4
                        }}
                    >
                        <span className="material-icons" style={{ fontSize: 14 }}>{autoSaveStatus === 'saving' ? 'save_alt' : 'check'}</span>
                        {saveStatusText}
                    </button>
                </div>
            </div>
        </div>

        {/* 분析키트 구매 입력 모달 */}
        {showPurchaseModal && (
            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
                <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.18)', width: 360, padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.875rem', fontWeight: 800, color: '#1e293b' }}>분析키트 구매 입력</span>
                        <button onClick={() => setShowPurchaseModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '1.1rem', lineHeight: 1 }}>✕</button>
                    </div>
                    {/* 날짜 선택 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontSize: '0.75rem', color: '#334155', fontWeight: 700, width: 60 }}>구매 날짜</span>
                        <input
                            type="date"
                            value={purchaseDate}
                            onChange={e => setPurchaseDate(e.target.value)}
                            style={{ flex: 1, height: 32, border: '1px solid #cbd5e1', borderRadius: 6, padding: '0 8px', fontSize: '0.75rem', color: '#1e293b' }}
                        />
                    </div>
                    {/* 키트별 구매량 */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {purchaseItems.map((item, idx) => (
                            <div key={item.kitName} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ flex: 1, fontSize: '0.75rem', color: '#334155' }}>{item.kitName}</span>
                                <input
                                    type="number"
                                    min="0"
                                    value={item.purchaseAmount}
                                    onChange={e => {
                                        const updated = [...purchaseItems];
                                        updated[idx] = { ...updated[idx], purchaseAmount: e.target.value === '' ? '' : Number(e.target.value) };
                                        setPurchaseItems(updated);
                                    }}
                                    style={{ width: 72, height: 30, border: '1px solid #cbd5e1', borderRadius: 6, padding: '0 8px', fontSize: '0.75rem', textAlign: 'right' }}
                                />
                                <span style={{ fontSize: '0.7rem', color: '#64748b', width: 20 }}>개</span>
                            </div>
                        ))}
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                        <button
                            onClick={() => setShowPurchaseModal(false)}
                            style={{ padding: '6px 16px', fontSize: '0.75rem', border: '1px solid #cbd5e1', borderRadius: 6, background: '#f8fafc', cursor: 'pointer', color: '#475569' }}
                        >닫기</button>
                        <button
                            onClick={savePurchase}
                            disabled={isSavingPurchase || !purchaseDate}
                            style={{ padding: '6px 16px', fontSize: '0.75rem', border: 'none', borderRadius: 6, background: (isSavingPurchase || !purchaseDate) ? '#94a3b8' : '#1e293b', color: '#fff', cursor: (isSavingPurchase || !purchaseDate) ? 'not-allowed' : 'pointer' }}
                        >{isSavingPurchase ? '저장 중...' : '저장'}</button>
                    </div>
                </div>
            </div>
        )}
        </>
    );
};

export default KitManagementView;
