import React, { useState } from 'react';
import { useWaterQualityViewModel } from '../water/useWaterQualityViewModel';
import { useSettingsViewModel } from '../settings/useSettingsViewModel';
import { useDialog } from '../../components/common/DialogProvider';
import AdvancedDataGrid from '../../components/common/AdvancedDataGrid';

const FacilityManagementView = ({ currentUser }) => {
    const { showAlert } = useDialog();
    const { locationItems } = useSettingsViewModel();
    const { history, pendingChanges } = useWaterQualityViewModel(currentUser, { showAlert });

    // ---- Visual Settings ----
    const [rowHeight, setRowHeight] = useState(36);
    const [headerRowHeight, setHeaderRowHeight] = useState(40);
    const [fontSize, setFontSize] = useState(13);
    const [headerFontSize, setHeaderFontSize] = useState(13);

    const [headerBgColor, setHeaderBgColor] = useState('#FAFAFA');
    const [headerTextColor, setHeaderTextColor] = useState('#0D0D0D');
    const [activeHeaderBgColor, setActiveHeaderBgColor] = useState('#E8E8E8');
    const [activeHeaderTextColor, setActiveHeaderTextColor] = useState('#0D0D0D');

    const [gridLineColor, setGridLineColor] = useState('#E8E8E8');
    const [gridLineWidth, setGridLineWidth] = useState(1);

    const [selectedCellBorderColor, setSelectedCellBorderColor] = useState('#E42313');
    const [selectedCellBorderWidth, setSelectedCellBorderWidth] = useState(2);

    // ---- Feature Settings ----
    const [showRowHeader, setShowRowHeader] = useState(true);
    const [showHorizontalLines, setShowHorizontalLines] = useState(true);
    const [showVerticalLines, setShowVerticalLines] = useState(true);
    const [selectionMode, setSelectionMode] = useState('cell');
    const [enableEditing, setEnableEditing] = useState(true);
    const [sortable, setSortable] = useState(true);
    const [resizableColumns, setResizableColumns] = useState(true);
    const [enableClipboard, setEnableClipboard] = useState(true);
    const [contextMenuEnabled, setContextMenuEnabled] = useState(true);
    const [showStatusBar, setShowStatusBar] = useState(true);
    const [highlightSelectionRow, setHighlightSelectionRow] = useState(true);
    const [highlightSelectionColumn, setHighlightSelectionColumn] = useState(true);
    const [startEditOnDoubleClick, setStartEditOnDoubleClick] = useState(true);
    const [startEditOnEnter, setStartEditOnEnter] = useState(true);
    const [startEditOnTyping, setStartEditOnTyping] = useState(true);
    const [typingEditMode, setTypingEditMode] = useState('overwrite');
    const [enterKeyBehavior, setEnterKeyBehavior] = useState('moveDown');
    const [cellAlign, setCellAlign] = useState('center');

    // ---- Generate Water Quality Schema ----
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
        { id: 'nh3_n', label: 'NH3-N' },
        { id: 'no3_n', label: 'NO3-N' },
        { id: 'po4_p', label: 'T-P (PO4-P)' },
        { id: 'alkalinity', label: '총알칼리도' }
    ];

    const advancedColumns = cols.map((c, index) => {
        const subCols = activeLocations
            .filter(loc => {
                if (c.id === 'po4_p' && !po4pLocations.includes(loc.name)) return false;
                return true;
            })
            .map(loc => ({
                id: `${c.id}_${loc.name}`,
                label: getShortName(loc.name),
                width: 60
            }));

        const isLastGroup = index === cols.length - 1;

        return {
            id: c.id,
            label: c.label,
            subCols,
            borderRight: !isLastGroup ? '2px solid #B0B0B0' : undefined
        };
    });

    const handleCellChange = (row, colId, newValue) => {
        showAlert('Cell Changed', `${colId}: ${newValue}`, 'info');
    };

    return (
        <div className="panel-container" style={{ padding: '20px', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
            <h1 style={{ fontSize: 22, fontWeight: 600, color: '#0D0D0D', fontFamily: "'Space Grotesk', sans-serif", marginBottom: 16, letterSpacing: '-0.5px', flexShrink: 0 }}>Grid Component Playground</h1>

            <div style={{ display: 'flex', gap: '20px', flex: 1, minHeight: 0 }}>
                {/* Left: Grid */}
                <div style={{ flex: 1, minWidth: 0, height: '100%' }}>
                    <AdvancedDataGrid
                        title="수질 분석 데이터"
                        description={`${history.length} records`}
                        columns={advancedColumns}
                        data={history}
                        keyField="date"

                        rowHeight={rowHeight}
                        headerRowHeight={headerRowHeight}
                        fontSize={fontSize}
                        headerFontSize={headerFontSize}

                        headerBgColor={headerBgColor}
                        headerTextColor={headerTextColor}
                        activeHeaderBgColor={activeHeaderBgColor}
                        activeHeaderTextColor={activeHeaderTextColor}
                        gridLineColor={gridLineColor}
                        gridLineWidth={gridLineWidth}
                        selectedCellBorderColor={selectedCellBorderColor}
                        selectedCellBorderWidth={selectedCellBorderWidth}

                        showRowHeader={showRowHeader}
                        showHorizontalLines={showHorizontalLines}
                        showVerticalLines={showVerticalLines}
                        selectionMode={selectionMode}
                        enableEditing={enableEditing}
                        sortable={sortable}
                        resizableColumns={resizableColumns}
                        enableClipboard={enableClipboard}
                        contextMenu={contextMenuEnabled}
                        showStatusBar={showStatusBar}
                        highlightSelectionRow={highlightSelectionRow}
                        highlightSelectionColumn={highlightSelectionColumn}
                        startEditOnDoubleClick={startEditOnDoubleClick}
                        startEditOnEnter={startEditOnEnter}
                        startEditOnTyping={startEditOnTyping}
                        typingEditMode={typingEditMode}
                        enterKeyBehavior={enterKeyBehavior}
                        cellAlign={cellAlign}

                        onCellChange={handleCellChange}
                        onRefresh={() => showAlert('Refresh', '새로고침 버튼 클릭', 'info')}
                    />
                </div>

                {/* Right: Controls Panel */}
                <div style={{ width: '300px', display: 'flex', flexDirection: 'column', overflow: 'hidden', border: `1px solid #E8E8E8`, backgroundColor: '#FFFFFF' }}>
                    <div style={{ padding: '14px 16px', borderBottom: '1px solid #E8E8E8' }}>
                        <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 15, color: '#0D0D0D', margin: 0 }}>속성 제어판</h3>
                        <p style={{ fontSize: 11, color: '#7A7A7A', margin: '2px 0 0', fontFamily: "'Inter', sans-serif" }}>파라미터를 조정하여 실시간 테스트</p>
                    </div>

                    <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '20px', fontFamily: "'Inter', sans-serif" }}>

                        {/* Features */}
                        <ControlSection title="기능 (Features)">
                            <SelectRow label="선택 모드" value={selectionMode} onChange={setSelectionMode} options={[{ v: 'cell', l: '셀 (Cell)' }, { v: 'row', l: '행 (Row)' }]} />
                            <SelectRow label="셀 정렬" value={cellAlign} onChange={setCellAlign} options={[{ v: 'left', l: '왼쪽' }, { v: 'center', l: '가운데' }, { v: 'right', l: '오른쪽' }]} />
                            <CheckRow label="편집 활성화" checked={enableEditing} onChange={setEnableEditing} />
                            <CheckRow label="정렬 (Sort)" checked={sortable} onChange={setSortable} />
                            <CheckRow label="열 크기 조절" checked={resizableColumns} onChange={setResizableColumns} />
                            <CheckRow label="클립보드 (Ctrl+C/V)" checked={enableClipboard} onChange={setEnableClipboard} />
                            <CheckRow label="우클릭 메뉴" checked={contextMenuEnabled} onChange={setContextMenuEnabled} />
                            <CheckRow label="상태바 (SUM/AVG)" checked={showStatusBar} onChange={setShowStatusBar} />
                            <CheckRow label="행 하이라이트" checked={highlightSelectionRow} onChange={setHighlightSelectionRow} />
                            <CheckRow label="열 하이라이트" checked={highlightSelectionColumn} onChange={setHighlightSelectionColumn} />
                            <CheckRow label="더블클릭 편집" checked={startEditOnDoubleClick} onChange={setStartEditOnDoubleClick} />
                            <CheckRow label="Enter 편집 시작" checked={startEditOnEnter} onChange={setStartEditOnEnter} />
                            <CheckRow label="타이핑 편집 시작" checked={startEditOnTyping} onChange={setStartEditOnTyping} />
                            <SelectRow label="타이핑 모드" value={typingEditMode} onChange={setTypingEditMode} options={[{ v: 'overwrite', l: '덮어쓰기' }, { v: 'append', l: '이어쓰기' }]} />
                            <SelectRow label="Enter 동작" value={enterKeyBehavior} onChange={setEnterKeyBehavior} options={[{ v: 'moveDown', l: '아래로 이동' }, { v: 'stay', l: '현재 셀 유지' }]} />
                        </ControlSection>

                        <hr style={{ border: 'none', borderTop: '1px solid #E8E8E8', margin: 0 }} />

                        {/* Visibility */}
                        <ControlSection title="표시 (Visibility)">
                            <CheckRow label="행 헤더 (#)" checked={showRowHeader} onChange={setShowRowHeader} />
                            <CheckRow label="가로선" checked={showHorizontalLines} onChange={setShowHorizontalLines} />
                            <CheckRow label="세로선" checked={showVerticalLines} onChange={setShowVerticalLines} />
                        </ControlSection>

                        <hr style={{ border: 'none', borderTop: '1px solid #E8E8E8', margin: 0 }} />

                        {/* Dimensions */}
                        <ControlSection title="크기 (Dimensions)">
                            <NumRow label="행 높이" value={rowHeight} onChange={setRowHeight} />
                            <NumRow label="헤더 높이" value={headerRowHeight} onChange={setHeaderRowHeight} />
                            <NumRow label="폰트 크기" value={fontSize} onChange={setFontSize} />
                            <NumRow label="헤더 폰트" value={headerFontSize} onChange={setHeaderFontSize} />
                            <NumRow label="선 굵기" value={gridLineWidth} onChange={setGridLineWidth} step={0.5} />
                            <NumRow label="선택 테두리" value={selectedCellBorderWidth} onChange={setSelectedCellBorderWidth} />
                        </ControlSection>

                        <hr style={{ border: 'none', borderTop: '1px solid #E8E8E8', margin: 0 }} />

                        {/* Colors */}
                        <ControlSection title="색상 (Colors)">
                            <ColorRow label="헤더 배경" value={headerBgColor} onChange={setHeaderBgColor} />
                            <ColorRow label="헤더 글자" value={headerTextColor} onChange={setHeaderTextColor} />
                            <ColorRow label="활성 헤더 배경" value={activeHeaderBgColor} onChange={setActiveHeaderBgColor} />
                            <ColorRow label="그리드 선" value={gridLineColor} onChange={setGridLineColor} />
                            <ColorRow label="선택 테두리" value={selectedCellBorderColor} onChange={setSelectedCellBorderColor} />
                        </ControlSection>
                    </div>
                </div>
            </div>
        </div>
    );
};

// ---- Control Components (Swiss Clean style) ----
const ControlSection = ({ title, children }) => (
    <div>
        <h4 style={{ fontSize: 11, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif", color: '#B0B0B0', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10, marginTop: 0 }}>{title}</h4>
        {children}
    </div>
);

const CheckRow = ({ label, checked, onChange }) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, cursor: 'pointer' }}>
        <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} style={{ accentColor: '#E42313' }} />
        <span style={{ fontSize: 13, color: '#0D0D0D' }}>{label}</span>
    </label>
);

const SelectRow = ({ label, value, onChange, options }) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 13, color: '#0D0D0D' }}>{label}</span>
        <select value={value} onChange={e => onChange(e.target.value)} style={{ border: '1px solid #E8E8E8', padding: '4px 8px', fontSize: 12, outline: 'none', fontFamily: "'Inter', sans-serif" }}>
            {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
    </div>
);

const NumRow = ({ label, value, onChange, step = 1 }) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 13, color: '#0D0D0D' }}>{label}</span>
        <input type="number" value={value} step={step} onChange={e => onChange(Number(e.target.value))} style={{ width: 56, border: '1px solid #E8E8E8', padding: '4px 6px', fontSize: 12, textAlign: 'right', outline: 'none', fontFamily: "'Inter', sans-serif" }} />
    </div>
);

const ColorRow = ({ label, value, onChange }) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 13, color: '#0D0D0D' }}>{label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="color" value={value} onChange={e => onChange(e.target.value)} style={{ width: 22, height: 22, padding: 0, border: '1px solid #E8E8E8', cursor: 'pointer' }} />
            <input type="text" value={value} onChange={e => onChange(e.target.value)} style={{ width: 68, border: '1px solid #E8E8E8', padding: '3px 6px', fontSize: 11, textAlign: 'center', fontFamily: 'monospace', textTransform: 'uppercase' }} />
        </div>
    </div>
);

export default FacilityManagementView;
