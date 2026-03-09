import React, { useState, useEffect, useRef } from 'react';
import { useWaterQualityViewModel } from './useWaterQualityViewModel';
import { useSettingsViewModel } from '../settings/useSettingsViewModel';
import { useDialog } from '../../components/common/DialogProvider';
import AdvancedDataGrid from '../../components/common/AdvancedDataGrid';

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

const normalizeDisplayWaterValue = (value) => {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'number' && Number.isNaN(value)) return '초과';

    const normalized = String(value).trim();
    if (['-1', '-1.0', '-1.00', 'NaN', 'nan'].includes(normalized)) {
        return '초과';
    }

    return normalized;
};

const WaterQualityView = ({ currentUser }) => {
    const { showAlert, showConfirm } = useDialog();
    const { locationItems, config } = useSettingsViewModel();
    const {
        history, loading,
        updateReading, submitBatch, refresh, pendingChanges,
        isImportingFromQntech, isImportingRangeFromQntech,
        rangeImportProgress,
        handleImportFromQntech, handleImportRangeFromQntech
    } = useWaterQualityViewModel(currentUser, { showAlert });

    const [selectedRowKey, setSelectedRowKey] = useState(null);
    const [isManualEditMode, setIsManualEditMode] = useState(false);
    const [doubleClickedCell, setDoubleClickedCell] = useState(null); // { date, colId }
    const [activeInput, setActiveInput] = useState(null);
    const [localValue, setLocalValue] = useState(null);
    const [todaySaved, setTodaySaved] = useState(false);
    const [rangeStartDate, setRangeStartDate] = useState(formatLocalDate(new Date()));
    const [rangeEndDate, setRangeEndDate] = useState(formatLocalDate(new Date()));
    const closeModeAfterBlurRef = useRef(false);

    const todayStr = new Date().toISOString().split('T')[0];

    const closeEditMode = () => {
        setIsManualEditMode(false);
        setDoubleClickedCell(null);
        setSelectedRowKey(null);
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

    const scrollKey = history.find((row) => row.date === todayStr)?.rowKey || null;

    const activeLocations = locationItems.filter(i => i.checked);
    const po4pLocations = ['유량조정조', '포기조', '방류조'];
    const selectedRow = history.find((row) => row.rowKey === selectedRowKey) || null;

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
    // 동적 너비 계산 (최소 714px 유지, 서브컬럼당 45px + 헤더 84px + 버퍼 40px)
    const calculatedWidth = Math.max(714, 84 + totalSubColsCount * 45 + 40);

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
        if (row.isFuture) return; // 미래 날짜 선택 차단
        if (isManualEditMode && selectedRowKey === row.rowKey) return;
        const nextSelectedRowKey = row.rowKey === selectedRowKey ? null : row.rowKey;
        setSelectedRowKey(nextSelectedRowKey);

        if (nextSelectedRowKey) {
            setRangeStartDate(row.date);
            setRangeEndDate(row.date);
        }
    };

    const handleCellDoubleClick = (row, col) => {
        if ((row.date !== todayStr || todaySaved) && !row.isFuture) {
            setDoubleClickedCell({ rowKey: row.rowKey, colId: col.id });
            setSelectedRowKey(row.rowKey);
        }
    };

    const extraActions = (
        <>
            {selectedRowKey && !isManualEditMode && (
                <button
                    onClick={() => setIsManualEditMode(true)}
                    disabled={selectedRow?.isFuture}
                    style={{
                        padding: '5px 14px', borderRadius: 6, border: '1px solid #cbd5e1',
                        fontWeight: 800, fontSize: 11, cursor: selectedRow?.isFuture ? 'not-allowed' : 'pointer',
                        background: '#fff', color: '#475569',
                        display: 'flex', alignItems: 'center', gap: 4,
                        opacity: selectedRow?.isFuture ? 0.5 : 1
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

    const handleQntechImportClick = async () => {
        if (!rangeStartDate || !rangeEndDate) {
            showAlert?.('가져올 날짜를 선택하세요.');
            return;
        }

        if (rangeStartDate > rangeEndDate) {
            showAlert?.('앞의 날짜는 뒤의 날짜보다 클 수 없습니다.');
            return;
        }

        if (rangeStartDate > todayStr || rangeEndDate > todayStr) {
            showAlert?.('오늘날짜보다 미래의 날짜는 불러올 수 없습니다.');
            return;
        }

        if (rangeStartDate === rangeEndDate) {
            await handleImportFromQntech(rangeStartDate);
            return;
        }

        const confirmed = await showConfirm?.('기간 불러오기는 즉시 저장됩니다. 기존 값이 있는 날짜는 값은 유지하고 사진만 저장합니다. 계속하시겠습니까?');
        if (!confirmed) return;
        await handleImportRangeFromQntech(rangeStartDate, rangeEndDate);
    };

    const rangeImportStatusText = isImportingRangeFromQntech
        ? (() => {
            const dateLabel = formatImportProgressDate(rangeImportProgress.currentDate);
            const countLabel = rangeImportProgress.totalDates > 0
                ? `(${rangeImportProgress.completedDates}/${rangeImportProgress.totalDates})`
                : '';

            if (dateLabel) {
                return `${dateLabel} 데이터 불러오는 중... ${countLabel}`.trim();
            }

            return rangeImportProgress.message || '기간 데이터를 불러오는 중...';
        })()
        : '';

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
            pointerEvents: (isFuture || (isEditingMode && !isSelected)) ? 'none' : 'auto',
            cursor: (isFuture || (isEditingMode && !isSelected)) ? 'default' : 'pointer',
        };
    };

    const renderCell = (row, col) => {
        const colId = col?.id;
        if (!colId) return null;

        const val = row[colId];
        const errorMsg = row[`${colId}_error`];

        const changed = pendingChanges[row.rowKey]?.[colId] !== undefined;
        const isSelected = selectedRowKey === row.rowKey;
        const isToday = row.date === todayStr;
        const isFuture = row.isFuture;

        const isManual = isSelected && isManualEditMode;
        const isCellDoubleClicked = doubleClickedCell?.rowKey === row.rowKey && doubleClickedCell?.colId === colId;
        const isReadOnly = (isFuture || row.date !== todayStr || todaySaved) && !isManual && !isCellDoubleClicked;

        const isRawActive = activeInput?.rowKey === row.rowKey && activeInput?.colId === colId;

        const displayVal = normalizeDisplayWaterValue(val);

        return (
            <div style={{
                position: 'absolute',
                inset: 0,
                padding: '0 4px',
                background: errorMsg ? '#fee2e2' : ((!isReadOnly && (isSelected || isToday)) ? '#fef08a' : (isFuture ? '#f5f5f5' : 'transparent')),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
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
                            boxSizing: 'border-box'
                        }}
                        value={isRawActive ? localValue : displayVal}
                        placeholder="-"
                        onChange={e => {
                            setLocalValue(e.target.value);
                        }}
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
                            setActiveInput({ rowKey: row.rowKey, colId: colId });
                            setLocalValue(normalizeDisplayWaterValue(val));
                            if (!isCellDoubleClicked) e.target.select();
                        }}
                        onBlur={async () => {
                            if (isRawActive && localValue !== null) {
                                // Extract parameter and location from colId (e.g. nh3_n_유량조정조)
                                const lastUnderscore = colId.lastIndexOf('_');
                                const paramId = colId.substring(0, lastUnderscore);
                                const locName = colId.substring(lastUnderscore + 1);

                                updateReading(row.rowKey, locName, paramId, localValue);
                            }
                            setActiveInput(null);
                            setLocalValue(null);
                            if (isCellDoubleClicked) {
                                setDoubleClickedCell(null);
                                await submitBatch({ targetRowKeys: [row.rowKey], silent: true });
                            }
                            if (closeModeAfterBlurRef.current) {
                                closeModeAfterBlurRef.current = false;
                                await submitBatch({ targetRowKeys: [row.rowKey], silent: true });
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
        const isFuture = row.isFuture;
        const isSelected = selectedRowKey === row.rowKey;
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
                keyField="rowKey"
                scrollToKey={scrollKey}
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

            {/* 그리드 아래 가져오기 전용 영역 */}
            <div style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-end',
                gap: 0,
                minHeight: 0
            }}>
                <div style={{
                    padding: '12px 16px',
                    background: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    gap: 8,
                    flexWrap: 'wrap'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input
                            type="date"
                            value={rangeStartDate}
                            onChange={(e) => setRangeStartDate(e.target.value)}
                            style={{
                                height: 30,
                                borderRadius: 6,
                                border: '1px solid #cbd5e1',
                                padding: '0 10px',
                                fontSize: 11,
                                fontWeight: 700,
                                color: '#334155'
                            }}
                        />
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>~</span>
                        <input
                            type="date"
                            value={rangeEndDate}
                            onChange={(e) => setRangeEndDate(e.target.value)}
                            style={{
                                height: 30,
                                borderRadius: 6,
                                border: '1px solid #cbd5e1',
                                padding: '0 10px',
                                fontSize: 11,
                                fontWeight: 700,
                                color: '#334155'
                            }}
                        />
                        <button
                            onClick={handleQntechImportClick}
                            disabled={(isImportingFromQntech || isImportingRangeFromQntech) || !rangeStartDate || !rangeEndDate}
                            style={{
                                padding: '5px 14px', borderRadius: 6, border: '1px solid #cbd5e1',
                                fontWeight: 800, fontSize: 11,
                                cursor: (isImportingFromQntech || isImportingRangeFromQntech) ? 'wait' : 'pointer',
                                background: '#f8fafc', color: '#0f172a',
                                display: 'flex', alignItems: 'center', gap: 4,
                                opacity: (isImportingFromQntech || isImportingRangeFromQntech) ? 0.7 : 1
                            }}
                        >
                            <span className="material-icons" style={{ fontSize: 14 }}>cloud_download</span>
                            {(isImportingFromQntech || isImportingRangeFromQntech) ? '가져오는 중...' : 'QnTECH 가져오기'}
                        </button>
                    </div>
                    {isImportingRangeFromQntech && (
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '7px 10px',
                            borderRadius: 8,
                            background: '#eff6ff',
                            color: '#1d4ed8',
                            fontSize: 11,
                            fontWeight: 800
                        }}>
                            <span className="material-icons" style={{ fontSize: 14 }}>hourglass_top</span>
                            <span>{rangeImportStatusText}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* 하단 바 */}
            <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 16px', borderTop: '1px solid #e2e8f0', background: '#f8fafc', flexShrink: 0
            }}>
                <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600 }}>
                    총 {history.length}행
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
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
