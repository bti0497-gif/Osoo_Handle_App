import React, { useState, useEffect, useRef } from 'react';
import { useFlowViewModel } from './useFlowViewModel';
import { useSettingsViewModel } from '../settings/useSettingsViewModel';
import { useDialog } from '../../components/common/DialogContext';
import AdvancedDataGrid from '../../components/common/AdvancedDataGrid';

const FlowManagementView = ({ currentUser }) => {
    const { showAlert, showConfirm } = useDialog();
    const { flowItems } = useSettingsViewModel();
    const {
        history, loading, correctData,
        updateReading, updateManualReading, submitBatch, refresh, pendingChanges
    } = useFlowViewModel(currentUser, { showAlert });

    const [selectedDate, setSelectedDate] = useState(null);
    const [isManualEditMode, setIsManualEditMode] = useState(false);
    const [doubleClickedCell, setDoubleClickedCell] = useState(null); // { date, colId }
    const [activeInput, setActiveInput] = useState(null); // { date, colId, type }
    const [localValue, setLocalValue] = useState(null);
    const [isElecReverse, setIsElecReverse] = useState(() => localStorage.getItem('flowElecReverse') === 'true');
    const [todaySaved, setTodaySaved] = useState(false); // 오늘 날짜 저장 완료 여부
    const closeModeAfterBlurRef = useRef(false);

    const todayStr = new Date().toISOString().split('T')[0];

    const closeEditMode = () => {
        setIsManualEditMode(false);
        setDoubleClickedCell(null);
        setSelectedDate(null);
    };

    // ESC 키로 수동 편집 모드 종료
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

    const activeFlows = flowItems.filter(i => i.checked);
    const hasPending = Object.keys(pendingChanges).length > 0;

    const baseColors = {
        '유입유량계': '#1e3a8a',
        '방류유량계': '#047857',
        '내부반송유량계': '#b45309',
        '외부반송유량계': '#4338ca',
        '내부반송유량계2': '#9a3412', // for 2-series
        '외부반송유량계2': '#3730a3', // for 2-series
        '슬러지': '#57534e',
        '전력량계': '#0e7490'
    };

    const gridCols = activeFlows.map(c => {
        return {
            id: c.name,
            label: c.name.replace('계', ''),
            headerBgColor: baseColors[c.name] || '#1e3a8a',
            headerTextColor: '#fff',
            subCols: [
                { id: `${c.name}_raw`, label: c.name === '슬러지' ? '반출량' : '적산', width: 68, headerBgColor: baseColors[c.name] || '#1e3a8a', headerTextColor: '#fff' },
                { id: `${c.name}_diff`, label: '누계', width: 52, headerBgColor: '#fff', headerTextColor: '#1e40af' }
            ]
        };
    });

    // Calculate dynamic width: 84 (frozen col) + (120 per flow col) + 40 padding/borders
    const calculatedWidth = 84 + (activeFlows.length * 120) + 40;

    const handleRowSelect = (row) => {
        if (row.isFuture || row.date > todayStr) return;
        if (isManualEditMode && selectedDate === row.date) return;
        setSelectedDate(row.date);
    };

    const handleElecReverseToggle = async (nextChecked) => {
        if (nextChecked) {
            setIsElecReverse(true);
            localStorage.setItem('flowElecReverse', 'true');
            return;
        }

        const confirmed = await showConfirm?.('이 동작은 전력량 계산을 다시 설정합니다. 계속하시겠습니까?');
        if (!confirmed) return;

        setIsElecReverse(false);
        localStorage.setItem('flowElecReverse', 'false');
    };

    const handleCellDoubleClick = (row, col) => {
        if (row.isFuture) return;
        // 오늘 날짜이고 아직 저장 전이면 이미 편집 가능하므로 더블클릭 불필요
        if (row.date === todayStr && !todaySaved) return;
        // 과거 날짜 또는 저장 후 오늘 날짜: 해당 셀만 편집 가능
        setDoubleClickedCell({ date: row.date, colId: col?.id || null });
        setSelectedDate(row.date);
    };

    const extraActions = (
        <>
            {/* 전력량 누계 계산 체크박스 */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#64748b', cursor: 'pointer', userSelect: 'none' }}>
                <input type="checkbox" checked={isElecReverse} onChange={e => { void handleElecReverseToggle(e.target.checked); }} style={{ accentColor: '#0e7490' }} />
                전력량 누계 계산
            </label>
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
        closeEditMode();
        setTodaySaved(true); // 저장 후 오늘 날짜도 읽기전용
    };

    const renderCell = (row, col, val) => {
        const flowName = col.parentId;
        if (!flowName) return val;
        const subType = col.id.endsWith('_raw') ? 'raw' : 'diff';

        // 수동 편집 모드에서 선택된 행이 아니면 비활성화
        const isLockedOut = isManualEditMode && selectedDate !== row.date;
        if (isLockedOut) {
            const ld = row[flowName]?.isUserInput
                ? { reading: row[flowName].raw, flow: row[flowName].diff }
                : correctData(row[flowName]);
            const lockVal = subType === 'raw'
                ? (ld.reading != null ? Number(ld.reading).toLocaleString() : '')
                : (ld.flow != null ? Number(ld.flow).toLocaleString() : '');
            return (
                <div style={{ position: 'absolute', inset: 0, padding: '0 4px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', opacity: 0.4, pointerEvents: 'none', background: '#f8fafc' }}>
                    <span style={{ fontSize: subType === 'raw' ? 11 : 10.5, color: '#94a3b8' }}>{lockVal}</span>
                </div>
            );
        }

        const d = row[flowName]?.isUserInput
            ? { reading: row[flowName].raw, flow: row[flowName].diff, error: row[flowName].error }
            : correctData(row[flowName]);

        const changed = pendingChanges[row.date]?.[flowName];
        const isSelected = selectedDate === row.date;
        const isToday = row.date === todayStr;
        const isFuture = row.isFuture || row.date > todayStr;
        const isManual = isSelected && isManualEditMode;
        // 더블클릭은 해당 셀만 편집 가능 (셀 단위 체크)
        const isCellDoubleClicked = doubleClickedCell?.date === row.date && doubleClickedCell?.colId === col.id;
        // 전력량 역계산 모드: 누계를 입력하면 적산 자동계산 (오늘 날짜이고 저장 전에만)
        const isElecRev = isElecReverse && flowName === '전력량계' && isToday && !todaySaved;

        const isReadOnly = (isFuture || row.date !== todayStr || todaySaved) && !isManual && !isCellDoubleClicked;

        const isRawActive = activeInput?.date === row.date && activeInput?.colId === flowName && activeInput?.type === 'raw';
        const isDiffActive = activeInput?.date === row.date && activeInput?.colId === flowName && activeInput?.type === 'diff';

        // 전력량 역계산: raw 셀은 자동계산, diff 셀은 편집 가능
        if (isElecRev && subType === 'raw') {
            const displayVal = d.reading != null ? Number(d.reading).toLocaleString() : '';
            return (
                <div style={{ position: 'absolute', inset: 0, padding: '0 4px', background: '#e0f2fe', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', boxSizing: 'border-box', pointerEvents: 'none' }} title="누계값으로 자동 계산">
                    <span style={{ fontWeight: 700, fontSize: 11, color: '#0369a1' }}>{displayVal}</span>
                </div>
            );
        }
        if (isElecRev && subType === 'diff') {
            const displayVal = d.flow != null ? Number(d.flow).toLocaleString() : '';
            return (
                <div style={{ position: 'absolute', inset: 0, padding: '0 4px', background: '#fef08a', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', boxSizing: 'border-box', pointerEvents: 'none' }}>
                    <input
                        type="text"
                        style={{
                            width: '100%', height: '100%', outline: 'none', border: 'none',
                            textAlign: 'right', fontWeight: 700, fontSize: 11,
                            color: changed ? '#1d4ed8' : '#1e293b',
                            background: 'transparent',
                            boxSizing: 'border-box',
                            pointerEvents: 'auto'
                        }}
                        value={isDiffActive ? localValue : displayVal}
                        placeholder="사용량 입력"
                        onChange={e => { const v = e.target.value.replace(/,/g, ''); if (v === '' || /^-?\d*\.?\d*$/.test(v)) setLocalValue(v); }}
                            onKeyDown={e => {
                                if (e.key === 'Enter') e.target.blur();
                                if (e.key === 'Escape') {
                                    closeModeAfterBlurRef.current = true;
                                    e.preventDefault();
                                    e.stopPropagation();
                                    e.currentTarget.blur();
                                }
                            }}
                        onFocus={() => {
                            setActiveInput({ date: row.date, colId: flowName, type: 'diff' });
                            setLocalValue(d.flow != null ? String(d.flow) : '');
                        }}
                            onBlur={async () => {
                            if (isDiffActive && localValue !== null && localValue !== '') {
                                // 적산 = 어제 적산 + 오늘 누계(사용량)
                                const todayIdx = history.findIndex(h => h.date === row.date);
                                const prevRow = todayIdx > 0 ? history[todayIdx - 1] : null;
                                const prevData = prevRow ? (prevRow[flowName]?.isUserInput ? { reading: prevRow[flowName].raw } : correctData(prevRow[flowName])) : null;
                                const prevReading = prevData?.reading ?? 0;
                                const newReading = Number(prevReading) + Number(localValue);
                                // 누계(사용량)와 적산을 각각 직접 저장 (자동계산 우회)
                                updateManualReading(row.date, flowName, 'diff', localValue);
                                updateManualReading(row.date, flowName, 'raw', String(newReading));
                            }
                            setActiveInput(null);
                            setLocalValue(null);
                                if (closeModeAfterBlurRef.current) {
                                    closeModeAfterBlurRef.current = false;
                                    await submitBatch({ targetDates: [row.date], silent: true });
                                    closeEditMode();
                                }
                        }}
                    />
                </div>
            );
        }

        if (subType === 'raw') {
            const displayVal = d.reading != null ? Number(d.reading).toLocaleString() : '';
            return (
                <div style={{ position: 'absolute', inset: 0, padding: '0 4px', background: d.error ? '#fee2e2' : ((!isReadOnly && (isManual || isCellDoubleClicked || (isToday && !todaySaved))) ? '#fef08a' : (isFuture ? '#f5f5f5' : 'transparent')), display: 'flex', alignItems: 'center', justifyContent: 'flex-end', boxSizing: 'border-box', pointerEvents: 'none' }} title={d.error || ''}>
                    {isReadOnly ? (
                        <span style={{ fontWeight: 700, fontSize: 11, color: d.error ? '#dc2626' : (changed ? '#1d4ed8' : '#1e293b') }}>
                            {displayVal}
                        </span>
                    ) : (
                        <input
                            type="text"
                            autoFocus={isCellDoubleClicked}
                            style={{
                                width: '100%', height: '100%', outline: 'none',
                                textAlign: 'right', fontWeight: 700, fontSize: 11,
                                color: d.error ? '#dc2626' : (changed ? '#1d4ed8' : '#1e293b'),
                                background: 'transparent',
                                border: d.error ? '2px inset #ef4444' : 'none',
                                boxSizing: 'border-box',
                                pointerEvents: 'auto'
                            }}
                            value={isRawActive ? localValue : displayVal}
                            onChange={e => { const v = e.target.value.replace(/,/g, ''); if (v === '' || /^-?\d*\.?\d*$/.test(v)) setLocalValue(v); }}
                            onKeyDown={e => {
                                if (e.key === 'Enter') e.target.blur();
                                if (e.key === 'Escape') {
                                    closeModeAfterBlurRef.current = true;
                                    e.preventDefault();
                                    e.stopPropagation();
                                    e.currentTarget.blur();
                                }
                            }}
                            onFocus={e => {
                                setActiveInput({ date: row.date, colId: flowName, type: 'raw' });
                                setLocalValue(d.reading != null ? String(d.reading) : '');
                                if (!isCellDoubleClicked) e.target.select();
                            }}
                            onBlur={async () => {
                                if (isRawActive && localValue !== null) {
                                    if (isManual) updateManualReading(row.date, flowName, 'raw', localValue);
                                    else updateReading(row.date, flowName, localValue);
                                }
                                setActiveInput(null);
                                setLocalValue(null);
                                // 더블클릭 셀 편집 후 blur 시 자동 저장 및 수동모드 해제
                                if (isCellDoubleClicked) {
                                    setDoubleClickedCell(null);
                                    await submitBatch({ targetDates: [row.date], silent: true });
                                }
                                if (closeModeAfterBlurRef.current) {
                                    closeModeAfterBlurRef.current = false;
                                    await submitBatch({ targetDates: [row.date], silent: true });
                                    closeEditMode();
                                }
                            }}
                        />
                    )}
                </div>
            );
        } else {
            const displayVal = d.flow != null ? Number(d.flow).toLocaleString() : '';
            return (
                <div style={{
                    position: 'absolute', inset: 0,
                    padding: isManual || isCellDoubleClicked ? '0 4px' : '0 3px',
                    textAlign: 'right', fontWeight: 600, fontSize: 10.5,
                    color: d.flow != null ? '#475569' : '#d1d5db',
                    background: isManual || isCellDoubleClicked ? '#fef08a' : (isFuture ? '#fafafa' : 'transparent'),
                    display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                    pointerEvents: 'none'
                }}>
                    {isManual || isCellDoubleClicked ? (
                        <input
                            type="text"
                            autoFocus={isCellDoubleClicked}
                            style={{
                                width: '100%', height: '100%', outline: 'none', border: 'none',
                                textAlign: 'right', fontWeight: 700, fontSize: 10.5,
                                color: changed ? '#1d4ed8' : '#1e293b',
                                background: 'transparent',
                                boxSizing: 'border-box',
                                pointerEvents: 'auto'
                            }}
                            value={isDiffActive ? localValue : displayVal}
                            onChange={e => { const v = e.target.value.replace(/,/g, ''); if (v === '' || /^-?\d*\.?\d*$/.test(v)) setLocalValue(v); }}
                            onKeyDown={e => {
                                if (e.key === 'Enter') e.target.blur();
                                if (e.key === 'Escape') {
                                    closeModeAfterBlurRef.current = true;
                                    e.preventDefault();
                                    e.stopPropagation();
                                    e.currentTarget.blur();
                                }
                            }}
                            onFocus={e => {
                                setActiveInput({ date: row.date, colId: flowName, type: 'diff' });
                                setLocalValue(d.flow != null ? String(d.flow) : '');
                                if (!isCellDoubleClicked) e.target.select();
                            }}
                            onBlur={async () => {
                                if (isDiffActive && localValue !== null) updateManualReading(row.date, flowName, 'diff', localValue);
                                setActiveInput(null);
                                setLocalValue(null);
                                // 더블클릭 셀 편집 후 blur 시 자동 저장 및 수동모드 해제
                                if (isCellDoubleClicked) {
                                    setDoubleClickedCell(null);
                                    await submitBatch({ targetDates: [row.date], silent: true });
                                }
                                if (closeModeAfterBlurRef.current) {
                                    closeModeAfterBlurRef.current = false;
                                    await submitBatch({ targetDates: [row.date], silent: true });
                                    closeEditMode();
                                }
                            }}
                        />
                    ) : (displayVal || '')}
                </div>
            );
        }
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
        };
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
                background: isSelected ? '#fef3c7' : isToday ? '#dbeafe' : '#f8fafc',
                pointerEvents: isFuture ? 'none' : 'auto',
                cursor: isFuture ? 'default' : 'pointer',
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
            borderRight: '1px solid #e2e8f0', // 오른쪽 경계선만 추가
        }}>
            <AdvancedDataGrid
                title="유량 검침값 등록"
                description="노란색 셀에 검침(적산) 수치를 입력하면 누계가 자동 계산됩니다."
                columns={gridCols}
                data={history}
                keyField="date"
                scrollToKey={todayStr}
                width={calculatedWidth}
                height={400}
                rowHeaderWidth={84}
                rowHeaderLabel="날짜"
                showBottomBar={false}
                selectionMode="row"
                enableEditing={false}
                contextMenu={false}
                onRowSelect={handleRowSelect}
                onCellDoubleClick={(row, col) => handleCellDoubleClick(row, col)}
                getRowStyle={getRowStyle}
                renderRowHeader={(item) => renderRowHeader(item)}
                renderCell={renderCell}
                onRefresh={refresh}
            />

            {/* 가운데 여유 공간 (판넬 내부) */}
            <div style={{ flex: 1 }} />

            {/* 하단 버튼 바 (판넬 내부 하단) */}
            <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '12px 20px', borderTop: '1px solid #e2e8f0', flexShrink: 0,
                backgroundColor: '#FAFAFA'
            }}>
                <span style={{ fontSize: 12, color: '#94A3B8', fontWeight: 500 }}>{history.length} records</span>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    {extraActions}
                    <button
                        onClick={handleSave}
                        disabled={!(hasPending || isManualEditMode) || loading}
                        style={{
                            padding: '8px 16px', border: 'none', borderRadius: '4px',
                            fontWeight: 600, fontSize: 13, fontFamily: "'Space Grotesk', sans-serif",
                            cursor: (hasPending || isManualEditMode) ? 'pointer' : 'not-allowed',
                            background: (hasPending || isManualEditMode) ? '#0D0D0D' : '#E8E8E8',
                            color: (hasPending || isManualEditMode) ? '#FFFFFF' : '#A0A0A0',
                            display: 'flex', alignItems: 'center', gap: 6,
                            transition: 'all 0.15s ease'
                        }}
                    >
                        <span className="material-icons" style={{ fontSize: 16 }}>{(hasPending || isManualEditMode) ? 'save' : 'check'}</span>
                        {loading ? '저장 중...' : (hasPending || isManualEditMode) ? (isManualEditMode ? '수정사항 저장' : '변경사항 저장') : '저장됨'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default FlowManagementView;
