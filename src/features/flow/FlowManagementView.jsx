import React, { useState } from 'react';
import { useFlowViewModel } from './useFlowViewModel';
import { useSettingsViewModel } from '../settings/useSettingsViewModel';
import { useDialog } from '../../components/common/DialogProvider';
import DataGrid from '../../components/common/DataGrid';

const FlowManagementView = ({ currentUser }) => {
    const { showAlert } = useDialog();
    const { flowItems } = useSettingsViewModel();
    const {
        history, loading, correctData,
        updateReading, updateManualReading, submitBatch, refresh, pendingChanges
    } = useFlowViewModel(currentUser, { showAlert });

    const [selectedDate, setSelectedDate] = useState(null);
    const [isManualEditMode, setIsManualEditMode] = useState(false);
    const [doubleClickedDate, setDoubleClickedDate] = useState(null);
    const [activeInput, setActiveInput] = useState(null); // { date, colId, type }
    const [localValue, setLocalValue] = useState(null);

    const todayStr = new Date().toISOString().split('T')[0];

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
            subCols: [
                { id: 'raw', label: c.name === '슬러지' ? '반출량' : '적산', width: 68, headerStyle: { background: baseColors[c.name] || '#1e3a8a', color: '#fff' } },
                { id: 'diff', label: '누계', width: 52, headerStyle: { background: '#fff', color: '#1e40af' } }
            ]
        };
    });

    // Calculate dynamic width: 84 (frozen col) + (120 per flow col) + 40 padding/borders
    const calculatedWidth = 84 + (activeFlows.length * 120) + 40;

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

    const renderCell = (row, colGroup, subCol) => {
        const c = colGroup;
        const d = row[c.id]?.isUserInput
            ? { reading: row[c.id].raw, flow: row[c.id].diff, error: row[c.id].error }
            : correctData(row[c.id]);

        const changed = pendingChanges[row.date]?.[c.id];
        const isSelected = selectedDate === row.date;
        const isToday = row.date === todayStr;
        const isFuture = row.isFuture;
        const isManual = isSelected && isManualEditMode;
        const isCellDoubleClicked = doubleClickedDate === row.date;

        const isReadOnly = (isFuture || row.date !== todayStr) && !isManual && !isCellDoubleClicked;

        const isRawActive = activeInput?.date === row.date && activeInput?.colId === c.id && activeInput?.type === 'raw';
        const isDiffActive = activeInput?.date === row.date && activeInput?.colId === c.id && activeInput?.type === 'diff';

        if (subCol.id === 'raw') {
            const displayVal = d.reading != null ? Number(d.reading).toLocaleString() : '';
            return (
                <div style={{ width: '100%', height: '100%', padding: '0 4px', background: d.error ? '#fee2e2' : (isManual || isCellDoubleClicked || isToday ? '#fef08a' : (isFuture ? '#f5f5f5' : 'transparent')), display: 'flex', alignItems: 'center', justifyContent: 'flex-end', boxSizing: 'border-box' }} title={d.error || ''}>
                    {isReadOnly ? (
                        <span style={{ fontWeight: 700, fontSize: 11, color: d.error ? '#dc2626' : (changed ? '#1d4ed8' : '#1e293b') }}>
                            {displayVal || '-'}
                        </span>
                    ) : (
                        <input
                            type="text"
                            style={{
                                width: '100%', height: '100%', outline: 'none',
                                textAlign: 'right', fontWeight: 700, fontSize: 11,
                                color: d.error ? '#dc2626' : (changed ? '#1d4ed8' : '#1e293b'),
                                background: 'transparent',
                                border: d.error ? '2px inset #ef4444' : 'none',
                                boxSizing: 'border-box'
                            }}
                            value={isRawActive ? localValue : displayVal}
                            placeholder="-"
                            onChange={e => setLocalValue(e.target.value.replace(/,/g, ''))}
                            onFocus={() => {
                                setActiveInput({ date: row.date, colId: c.id, type: 'raw' });
                                setLocalValue(d.reading != null ? String(d.reading) : '');
                            }}
                            onBlur={() => {
                                if (isRawActive && localValue !== null) {
                                    if (isManual || isCellDoubleClicked) updateManualReading(row.date, c.id, 'raw', localValue);
                                    else updateReading(row.date, c.id, localValue);
                                }
                                setActiveInput(null);
                                setLocalValue(null);
                            }}
                        />
                    )}
                </div>
            );
        } else {
            const displayVal = d.flow != null ? Number(d.flow).toLocaleString() : '';
            return (
                <div style={{
                    width: '100%', height: '100%',
                    padding: isManual || isCellDoubleClicked ? '0 4px' : '0 3px',
                    textAlign: 'right', fontWeight: 600, fontSize: 10.5,
                    color: d.flow != null ? '#475569' : '#d1d5db',
                    background: isManual || isCellDoubleClicked ? '#fef08a' : (isFuture ? '#fafafa' : 'transparent'),
                    display: 'flex', alignItems: 'center', justifyContent: 'flex-end'
                }}>
                    {isManual || isCellDoubleClicked ? (
                        <input
                            type="text"
                            style={{
                                width: '100%', height: '100%', outline: 'none', border: 'none',
                                textAlign: 'right', fontWeight: 700, fontSize: 10.5,
                                color: changed ? '#1d4ed8' : '#1e293b',
                                background: 'transparent',
                                boxSizing: 'border-box'
                            }}
                            value={isDiffActive ? localValue : displayVal}
                            placeholder="-"
                            onChange={e => setLocalValue(e.target.value.replace(/,/g, ''))}
                            onFocus={() => {
                                setActiveInput({ date: row.date, colId: c.id, type: 'diff' });
                                setLocalValue(d.flow != null ? String(d.flow) : '');
                            }}
                            onBlur={() => {
                                if (isDiffActive && localValue !== null) updateManualReading(row.date, c.id, 'diff', localValue);
                                setActiveInput(null);
                                setLocalValue(null);
                            }}
                        />
                    ) : (displayVal || '-')}
                </div>
            );
        }
    };

    const getRowStyle = (row, isSelected, isHovered) => {
        const isToday = row.date === todayStr;
        const isFuture = row.isFuture;
        const isEditingMode = isManualEditMode;

        let bg = '#fff';
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
            bg = '#e2e8f0'; // Darkened from #f1f5f9 for better contrast
        }

        return {
            background: bg,
            opacity,
            pointerEvents: (isEditingMode && !isSelected) ? 'none' : 'auto',
            cursor: (isEditingMode && !isSelected) ? 'default' : (isFuture ? 'default' : 'pointer'),
            ...(isSelected ? { outline: '2px solid #f59e0b', outlineOffset: -2, zIndex: 6 } : isToday ? { outline: '2px solid #3b82f6', outlineOffset: -2, zIndex: 5 } : {})
        };
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
                background: isSelected ? '#fef3c7' : isToday ? '#dbeafe' : '#f8fafc',
            }}>
                {row.date}
            </div>
        );
    };

    return (
        <DataGrid
            title="유량 검침값 등록"
            description="노란색 셀에 검침(적산) 수치를 입력하면 누계가 자동 계산됩니다."
            columns={gridCols}
            data={history}
            keyField="date"
            scrollToKey={todayStr}
            width={calculatedWidth}

            selectedRowKey={selectedDate}
            onRowSelect={handleRowSelect}
            onRowDoubleClick={handleRowDoubleClick}
            getRowStyle={getRowStyle}

            renderRowHeader={renderRowHeader}
            renderCell={renderCell}

            onSave={handleSave}
            onRefresh={refresh}
            saveLabel={isManualEditMode ? "수정사항 저장" : "변경사항 저장"}
            hasPending={hasPending || isManualEditMode}
            loading={loading}
            extraActions={extraActions}
        />
    );
};

export default FlowManagementView;
