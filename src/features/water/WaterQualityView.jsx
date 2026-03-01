import React, { useState } from 'react';
import { useWaterQualityViewModel } from './useWaterQualityViewModel';
import { useSettingsViewModel } from '../settings/useSettingsViewModel';
import { useDialog } from '../../components/common/DialogProvider';
import AdvancedDataGrid from '../../components/common/AdvancedDataGrid';

const WaterQualityView = ({ currentUser }) => {
    const { showAlert } = useDialog();
    const { locationItems, config } = useSettingsViewModel();
    const {
        history, loading,
        updateReading, submitBatch, refresh, pendingChanges
    } = useWaterQualityViewModel(currentUser, { showAlert });

    const [selectedDate, setSelectedDate] = useState(null);
    const [isManualEditMode, setIsManualEditMode] = useState(false);
    const [doubleClickedDate, setDoubleClickedDate] = useState(null);
    const [activeInput, setActiveInput] = useState(null);
    const [localValue, setLocalValue] = useState(null);

    const todayStr = new Date().toISOString().split('T')[0];

    const activeLocations = locationItems.filter(i => i.checked);
    const po4pLocations = ['유량조정조', '포기조', '방류조'];

    const getShortName = (name) => {
        if (name === '유량조정조') return '유량';
        if (name === '무산소조') return '무산';
        if (name === '포기조') return '포기';
        if (name === '침전조') return '침전';
        if (name === '방류조') return '방류';
        if (name === '혐기조') return '혐기';
        return name.substring(0, 2);
    };

    const cols = [
        { id: 'nh3_n', label: 'NH3-N', bg: '#2563eb', subBg: '#1e40af', color: '#fff' }, // 파란색 -> 약간 어두운 파란색
        { id: 'no3_n', label: 'NO3-N', bg: '#84cc16', subBg: '#4d7c0f', color: '#fff' }, // 연두색 -> 약간 어두운 연두색
        { id: 'po4_p', label: 'T-P (PO4-P)', bg: '#6366f1', subBg: '#4338ca', color: '#fff' }, // 청보라색 -> 약간 어두운 청보라색
        { id: 'alkalinity', label: '총알칼리도', bg: '#ef4444', subBg: '#b91c1c', color: '#fff' } // 빨간색 -> 약간 어두운 빨간색
    ];

    const hasPending = Object.keys(pendingChanges).length > 0;

    const totalSubColsCount = (activeLocations.length * 3) + activeLocations.filter(loc => po4pLocations.includes(loc.name)).length;
    // 동적 너비 계산 (최소 714px 유지, 서브컬럼당 45px + 헤더 84px)
    const calculatedWidth = Math.max(714, 84 + totalSubColsCount * 45);

    const gridCols = cols.map(c => {
        const subCols = activeLocations
            .filter(loc => {
                if (c.id === 'po4_p' && !po4pLocations.includes(loc.name)) return false;
                return true;
            })
            .map(loc => ({
                id: `${c.id}_${loc.name}`,
                label: getShortName(loc.name),
                width: 45,
                headerStyle: { background: c.subBg, color: c.color, fontSize: '0.7rem' }
            }));

        return {
            id: c.id,
            label: c.label,
            headerStyle: { background: c.bg, color: c.color },
            subCols
        };
    });

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
        const colId = subCol.id;
        const val = row[colId];
        const errorMsg = row[`${colId}_error`];

        const changed = pendingChanges[row.date]?.[colId] !== undefined;
        const isSelected = selectedDate === row.date;
        const isToday = row.date === todayStr;
        const isFuture = row.isFuture;

        const isManual = isSelected && isManualEditMode;
        const isCellDoubleClicked = doubleClickedDate === row.date;
        const isReadOnly = (isFuture || (row.date !== todayStr)) && !isManual && !isCellDoubleClicked;

        const isRawActive = activeInput?.date === row.date && activeInput?.colId === colId;

        // format to 1 decimal place for display
        const displayVal = val != null ? Number(val).toFixed(1) : '';

        return (
            <div style={{ width: '100%', height: '100%', padding: '0 4px', background: errorMsg ? '#fee2e2' : (isSelected || isToday ? '#fef08a' : (isFuture ? '#f5f5f5' : 'transparent')), display: 'flex', alignItems: 'center', justifyContent: 'flex-end', boxSizing: 'border-box' }} title={errorMsg || ''}>
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
                        value={isRawActive ? localValue : displayVal}
                        placeholder="-"
                        onChange={e => {
                            let val = e.target.value.replace(/,/g, '');
                            // allow only one decimal point
                            const parts = val.split('.');
                            if (parts.length > 2) val = parts[0] + '.' + parts.slice(1).join('');
                            setLocalValue(val);
                        }}
                        onFocus={() => {
                            if (isReadOnly) return;
                            setActiveInput({ date: row.date, colId: colId });
                            setLocalValue(val != null ? String(val) : '');
                        }}
                        onBlur={() => {
                            if (isRawActive && localValue !== null) {
                                // Extract parameter and location from colId (e.g. nh3_n_유량조정조)
                                const lastUnderscore = colId.lastIndexOf('_');
                                const paramId = colId.substring(0, lastUnderscore);
                                const locName = colId.substring(lastUnderscore + 1);

                                updateReading(row.date, locName, paramId, localValue);
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
                background: isSelected ? '#fef3c7' : isToday ? '#dbeafe' : '#f8fafc',
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
                title="수질 분석 데이터 등록"
                description="노란색 셀을 클릭하여 분석 수치를 입력하세요. (과거 데이터를 수정하려면 해당 행을 클릭하세요)"
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
                        {loading ? '저장 중...' : (isManualEditMode || hasPending ? (isManualEditMode ? "수정사항 저장" : "데이터 저장") : '변경사항 없음')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default WaterQualityView;
