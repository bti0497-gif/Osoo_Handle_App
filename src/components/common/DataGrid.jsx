import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';

const DataGrid = ({
    title,
    description,
    columns = [], // { id, label, subCols: [ { id, label, width, headerStyle } ] }
    data = [],
    keyField = 'id',
    rowHeight = 30, // base row height
    headerRowHeight = 32, // header row height
    renderRowHeader, // (row) => ReactNode
    renderCell, // (row, col, subCol) => ReactNode

    // States
    selectedRowKey,
    onRowSelect,
    onRowDoubleClick,
    getRowStyle, // (row) => style object

    // Bottom Bar Actions
    onSave,
    onRefresh,
    saveLabel = '저장',
    hasPending = false,
    loading = false,
    extraActions, // ReactNode

    scrollToKey,
    width = 860
}) => {
    const [scrollTop, setScrollTop] = useState(0);
    const [scrollLeft, setScrollLeft] = useState(0);
    const [hoveredRowKey, setHoveredRowKey] = useState(null);
    const [hoveredColId, setHoveredColId] = useState(null);

    const bodyScrollRef = useRef(null);
    const headerScrollRef = useRef(null);

    // Sync header scroll
    const handleBodyScroll = (e) => {
        setScrollTop(e.target.scrollTop);
        setScrollLeft(e.target.scrollLeft);
        if (headerScrollRef.current) {
            headerScrollRef.current.scrollLeft = e.target.scrollLeft;
        }
    };

    // Calculate dimensions
    const frozenWidth = 84;
    let totalGridWidth = frozenWidth;
    columns.forEach(c => {
        c.subCols.forEach(sc => {
            totalGridWidth += sc.width || 60;
        });
    });

    const totalHeight = data.length * rowHeight;

    // Viewport calculation for virtualization
    const viewportHeight = 600; // rough max height
    const overscan = 15;

    const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const endIndex = Math.min(data.length - 1, Math.floor((scrollTop + viewportHeight) / rowHeight) + overscan);

    const visibleData = useMemo(() => {
        const sliced = [];
        for (let i = startIndex; i <= endIndex; i++) {
            if (data[i]) sliced.push({ index: i, item: data[i] });
        }
        return sliced;
    }, [data, startIndex, endIndex]);

    useEffect(() => {
        if (scrollToKey && data.length > 0 && bodyScrollRef.current) {
            const idx = data.findIndex(d => d[keyField] === scrollToKey);
            if (idx !== -1) {
                const h = bodyScrollRef.current.clientHeight;
                bodyScrollRef.current.scrollTop = (idx * rowHeight) - (h / 2) + (rowHeight / 2);
            }
        }
    }, [scrollToKey, data, keyField, rowHeight]);

    return (
        <div style={{
            display: 'flex', flexDirection: 'column',
            height: '100%', width: width,
            backgroundColor: '#FFFFFF',
            borderRight: '1px solid #e2e8f0',
        }}>

            {/* 패널 타이틀 영역 */}
            <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid #e2e8f0', flexShrink: 0, backgroundColor: '#fff' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h1 style={{ fontSize: '18px', fontWeight: 900, color: '#1e293b', margin: 0 }}>{title}</h1>
                    <button onClick={onRefresh} style={{ display: 'flex', alignItems: 'center', gap: 3, background: 'none', border: '1px solid #e2e8f0', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: '#64748b' }}>
                        <span className="material-icons" style={{ fontSize: 13 }}>refresh</span>새로고침
                    </button>
                </div>
                {description && <p style={{ fontSize: 10, color: '#94a3b8', margin: '4px 0 0', fontWeight: 500 }}>{description}</p>}
            </div>

            {/* 테이블 헤더 영역 (분리됨) */}
            <div ref={headerScrollRef} style={{ overflow: 'hidden', borderBottom: '2px solid #64748b', backgroundColor: '#fff', flexShrink: 0 }}>
                <div style={{ width: totalGridWidth, position: 'relative', display: 'flex' }}>

                    {/* Frozen Header */}
                    <div style={{ width: frozenWidth, flexShrink: 0, position: 'sticky', left: 0, zIndex: 12, display: 'flex', flexDirection: 'column', backgroundColor: '#1e3a8a', borderRight: '1px solid #2563eb', boxSizing: 'border-box' }}>
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#fff' }}>날짜</div>
                    </div>

                    {/* Scrolling Header */}
                    <div style={{ flex: 1, display: 'flex' }}>
                        {columns.map(c => {
                            const baseBg = c.headerStyle?.background || c.subCols[0]?.headerStyle?.background || '#1e40af';
                            const baseColor = c.headerStyle?.color || c.subCols[0]?.headerStyle?.color || '#fff';

                            return (
                                <div key={c.id} style={{ display: 'flex', flexDirection: 'column', borderRight: '1px solid #1e3a8a', boxSizing: 'border-box' }}>
                                    <div style={{ height: headerRowHeight, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 900, color: baseColor, backgroundColor: baseBg, borderBottom: '1px solid rgba(0,0,0,0.1)', boxSizing: 'border-box' }}>
                                        {c.label}
                                    </div>
                                    <div style={{ display: 'flex', height: headerRowHeight }}>
                                        {c.subCols.map((sc, i) => (
                                            <div key={sc.id} style={{ width: sc.width || 60, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9.5, fontWeight: 800, borderRight: i === c.subCols.length - 1 ? 'none' : '1px solid rgba(0,0,0,0.1)', boxSizing: 'border-box', ...sc.headerStyle }}>
                                                {sc.label}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* 테이블 본체 영역 (Virtual Scroll) */}
            <div ref={bodyScrollRef} onScroll={handleBodyScroll} style={{ flex: 1, overflowY: 'auto', overflowX: 'auto', backgroundColor: '#f8fafc', position: 'relative' }}>
                <div style={{ height: totalHeight, width: totalGridWidth, position: 'relative' }}>
                    {visibleData.map(({ index, item }) => {
                        const isSelected = selectedRowKey === item[keyField];
                        const isHovered = hoveredRowKey === item[keyField];
                        const baseStyle = getRowStyle ? getRowStyle(item, isSelected, isHovered) : {};

                        return (
                            <div key={item[keyField]}
                                onClick={() => onRowSelect && onRowSelect(item)}
                                onDoubleClick={() => onRowDoubleClick && onRowDoubleClick(item)}
                                onMouseEnter={() => setHoveredRowKey(item[keyField])}
                                onMouseLeave={() => setHoveredRowKey(null)}
                                style={{
                                    position: 'absolute',
                                    top: index * rowHeight,
                                    left: 0,
                                    width: totalGridWidth,
                                    height: rowHeight,
                                    display: 'flex',
                                    borderBottom: '1px solid #e2e8f0',
                                    boxSizing: 'border-box',
                                    ...baseStyle
                                }}
                            >
                                {/* Frozen Cell */}
                                <div style={{ width: frozenWidth, flexShrink: 0, position: 'sticky', left: 0, zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid #cbd5e1', boxSizing: 'border-box', ...baseStyle }}>
                                    {renderRowHeader ? renderRowHeader(item) : item[keyField]}
                                </div>

                                {/* Scrolling Cells */}
                                <div style={{ flex: 1, display: 'flex' }}>
                                    {columns.map(c => (
                                        <div key={c.id} style={{ display: 'flex', borderRight: '1px solid #e2e8f0', boxSizing: 'border-box' }}>
                                            {c.subCols.map((sc, i) => {
                                                const colFullId = `${c.id}_${sc.id}`;
                                                const isColHovered = hoveredColId === colFullId;
                                                return (
                                                    <div key={sc.id}
                                                        onMouseEnter={() => setHoveredColId(colFullId)}
                                                        onMouseLeave={() => setHoveredColId(null)}
                                                        style={{ width: sc.width || 60, flexShrink: 0, borderRight: i === c.subCols.length - 1 ? 'none' : '1px solid #e2e8f0', boxSizing: 'border-box', display: 'flex', alignItems: 'center', position: 'relative', background: (isHovered && isColHovered) ? 'rgba(59, 130, 246, 0.18)' : isColHovered ? 'rgba(59, 130, 246, 0.12)' : 'transparent' }}>
                                                        {renderCell && renderCell(item, c, sc, isColHovered)}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* 가운데 여유 공간 */}
            <div style={{ flex: 1 }} />

            {/* 하단 바 */}
            <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 16px', borderTop: '1px solid #e2e8f0', background: '#f8fafc', flexShrink: 0
            }}>
                <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600 }}>
                    총 {data.length}행
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                    {extraActions}
                    <button
                        onClick={onSave}
                        disabled={!hasPending || loading}
                        style={{
                            padding: '5px 14px', borderRadius: 6, border: 'none',
                            fontWeight: 800, fontSize: 11, cursor: hasPending ? 'pointer' : 'default',
                            background: hasPending ? '#1e293b' : '#e2e8f0',
                            color: hasPending ? '#fff' : '#94a3b8',
                            display: 'flex', alignItems: 'center', gap: 4
                        }}
                    >
                        <span className="material-icons" style={{ fontSize: 14 }}>{hasPending ? 'save_alt' : 'check'}</span>
                        {loading ? '저장 중...' : hasPending ? saveLabel : '변경사항 없음'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default DataGrid;
