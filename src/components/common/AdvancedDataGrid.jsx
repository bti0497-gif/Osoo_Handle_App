import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';

// ============================================================================
// AdvancedDataGrid v2 — Excel-Grade Professional Component
// ============================================================================
// Swiss Clean Design System + Full Excel UX Parity
// - Tab/Shift+Tab, Delete, Ctrl+C/V, Enter moves down
// - Column resize (drag), context menu (right-click)
// - Column/Row/Group selection on header click
// - Range selection (Shift+Click)
// - Status bar (SUM, AVG, COUNT)
// - Frozen columns, sortable headers
// - Full code-controllable props API
// ============================================================================

const AdvancedDataGrid = ({
    // ---- Meta & Data Props ----
    title = '',
    description = '',
    columns = [],
    data = [],
    keyField = 'id',

    // ---- Dimension Props ----
    width = '100%',
    height = 600,
    rowHeight = 30,
    headerRowHeight = 32,
    defaultColumnWidth = 100,
    rowHeaderWidth = 50,
    rowHeaderLabel = '#',
    fontSize = 13,
    headerFontSize = 13,

    // ---- Visibility Props ----
    showHeader = true,
    showRowHeader = true,
    showHorizontalLines = true,
    showVerticalLines = true,
    showBottomBar = true,
    showStatusBar = true,

    // ---- Styling & Color Props (커스터마이즈 가능: 헤더색, 그리드색) ----
    headerBgColor = '#FAFAFA',
    headerTextColor = '#0D0D0D',
    gridLineColor = '#E8E8E8',
    gridLineWidth = 1,
    rowBgColor = '#FFFFFF',
    altRowBgColor = '#FAFAFA',
    cellAlign = 'left', // 'left' | 'center' | 'right'

    // ---- Selection & Editing Props ----
    selectionMode = 'cell', // 'cell' or 'row'
    enableEditing = true,
    editableRowKey = null,
    isCellEditable,
    tabNavigation = true,
    enableClipboard = true,
    rangeSelection = false,

    // ---- Column Features ----
    resizableColumns = true,
    sortable = false,
    frozenColumns = 0,

    // ---- Context Menu ----
    contextMenu = true,

    // ---- Actions & Event Handlers ----
    onCellChange,
    onRowSelect,
    onColumnSelect,
    onSort,
    onSave,
    onRefresh,
    onCellDoubleClick,
    saveLabel = 'Save',
    hasPending = false,
    loading = false,
    extraActions = null,

    // ---- Overrides ----
    renderRowHeader,
    renderCell,
    getRowStyle,

    // ---- Navigation ----
    scrollToKey = null,

    // ---- Theme ----
    theme = 'swiss', // 'swiss' | 'excel' | 'notion'
}) => {
    // ========================================================================
    // 🔒 Excel UX 고정 상수 — 외부에서 변경 불가
    // 셀 선택 테두리, 하이라이트, 호버, 읽기전용 배경 등 Excel 사용자 경험의
    // 핵심 설정값입니다. 다른 메뉴에서 이 컴포넌트를 사용할 때도 동일하게 적용됩니다.
    // ========================================================================
    const selectedCellBorderColor = '#3b82f6';
    const selectedCellBorderWidth = 1;
    const hoverRowBgColor = '#e2e8f0';
    const readOnlyCellBgColor = '#FAFAFA';
    const columnHighlightBgColor = 'rgba(59, 130, 246, 0.12)';
    const activeHeaderBgColor = '#E8E8E8';
    const activeHeaderTextColor = '#0D0D0D';

    // ---- State ----
    const [scrollTop, setScrollTop] = useState(0);
    const [scrollLeft, setScrollLeft] = useState(0);
    const [selectedCell, setSelectedCell] = useState(null);
    const [editingCell, setEditingCell] = useState(null);
    const [hoveredRowKey, setHoveredRowKey] = useState(null);
    const [columnWidths, setColumnWidths] = useState({});
    const [sortState, setSortState] = useState({ colId: null, direction: null });
    const [ctxMenu, setCtxMenu] = useState(null);
    const [rangeEnd, setRangeEnd] = useState(null); // For shift-click range

    // Refs
    const bodyScrollRef = useRef(null);
    const headerScrollRef = useRef(null);
    const editInputRef = useRef(null);
    const gridContainerRef = useRef(null);
    const resizeRef = useRef(null);

    // ---- Scrolling Sync ----
    const handleBodyScroll = useCallback((e) => {
        setScrollTop(e.target.scrollTop);
        setScrollLeft(e.target.scrollLeft);
        if (headerScrollRef.current) {
            headerScrollRef.current.scrollLeft = e.target.scrollLeft;
        }
    }, []);

    // ---- Flatten columns to leaf columns & handle frozen ----
    const leafColumns = useMemo(() => {
        const leaves = [];
        let currentLeft = showRowHeader ? rowHeaderWidth : 0;
        const safeColumns = Array.isArray(columns) ? columns : [];

        safeColumns.forEach(c => {
            const isGroupFrozen = c.frozen || false;
            if (c.subCols && c.subCols.length > 0) {
                c.subCols.forEach((sc, idx) => {
                    const scWidth = columnWidths[sc.id] || sc.width || defaultColumnWidth;
                    leaves.push({
                        ...sc,
                        parentId: c.id,
                        frozen: isGroupFrozen || sc.frozen,
                        stickyLeft: (isGroupFrozen || sc.frozen) ? currentLeft : null,
                        inheritedBorderLeft: sc.borderLeft || (idx === 0 ? c.borderLeft : null),
                        inheritedBorderRight: sc.borderRight || (idx === c.subCols.length - 1 ? c.borderRight : null)
                    });
                    if (isGroupFrozen || sc.frozen) currentLeft += scWidth;
                });
            } else {
                const cWidth = columnWidths[c.id] || c.width || defaultColumnWidth;
                leaves.push({
                    ...c,
                    frozen: isGroupFrozen,
                    stickyLeft: isGroupFrozen ? currentLeft : null,
                    inheritedBorderLeft: c.borderLeft,
                    inheritedBorderRight: c.borderRight
                });
                if (isGroupFrozen) currentLeft += cWidth;
            }
        });
        return leaves;
    }, [columns, showRowHeader, rowHeaderWidth, columnWidths, defaultColumnWidth]);

    const safeData = useMemo(() => {
        let d = Array.isArray(data) ? data : [];
        // Sort if active
        if (sortable && sortState.colId && sortState.direction) {
            d = [...d].sort((a, b) => {
                const valA = a[sortState.colId] ?? '';
                const valB = b[sortState.colId] ?? '';
                const numA = parseFloat(valA);
                const numB = parseFloat(valB);
                if (!isNaN(numA) && !isNaN(numB)) {
                    return sortState.direction === 'asc' ? numA - numB : numB - numA;
                }
                return sortState.direction === 'asc'
                    ? String(valA).localeCompare(String(valB))
                    : String(valB).localeCompare(String(valA));
            });
        }
        return d;
    }, [data, sortable, sortState]);

    // ---- Column width resolver ----
    const getColWidth = useCallback((col) => {
        return columnWidths[col.id] || col.width || defaultColumnWidth;
    }, [columnWidths, defaultColumnWidth]);

    const totalColumnsWidth = useMemo(() => {
        return leafColumns.reduce((sum, col) => sum + getColWidth(col), 0);
    }, [leafColumns, getColWidth]);

    const totalGridWidth = (showRowHeader ? rowHeaderWidth : 0) + totalColumnsWidth;
    const totalDataHeight = safeData.length * rowHeight;

    // ---- Virtualization ----
    const viewportHeight = typeof height === 'number' ? height : 600;
    const overscan = 10;
    const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const endIndex = Math.min(safeData.length - 1, Math.floor((scrollTop + viewportHeight) / rowHeight) + overscan);

    const visibleData = useMemo(() => {
        const sliced = [];
        for (let i = startIndex; i <= endIndex; i++) {
            if (safeData[i]) sliced.push({ index: i, item: safeData[i] });
        }
        return sliced;
    }, [safeData, startIndex, endIndex]);

    // ---- Scroll to key on mount ----
    useEffect(() => {
        if (scrollToKey && bodyScrollRef.current && safeData.length > 0) {
            const index = safeData.findIndex(d => d[keyField] === scrollToKey);
            if (index >= 0) {
                const scrollPos = Math.max(0, index * rowHeight - viewportHeight / 2 + rowHeight);
                bodyScrollRef.current.scrollTop = scrollPos;
            }
        }
    }, [scrollToKey, safeData.length]);

    // ---- Click outside commit ----
    const editingCellRef = useRef(editingCell);
    editingCellRef.current = editingCell;
    const ctxMenuRef = useRef(ctxMenu);
    ctxMenuRef.current = ctxMenu;

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (editingCellRef.current && editInputRef.current && !editInputRef.current.contains(e.target)) {
                commitEdit();
            }
            if (ctxMenuRef.current && gridContainerRef.current && !gridContainerRef.current.contains(e.target)) {
                setCtxMenu(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Close context menu on scroll (use ref to avoid re-render loop)
    const prevScrollRef = useRef({ top: 0, left: 0 });
    useEffect(() => {
        const prev = prevScrollRef.current;
        if ((prev.top !== scrollTop || prev.left !== scrollLeft) && ctxMenuRef.current) {
            setCtxMenu(null);
        }
        prevScrollRef.current = { top: scrollTop, left: scrollLeft };
    }, [scrollTop, scrollLeft]);

    // ---- Keyboard Navigation (Full Excel) ----
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (!selectedCell) return;

            // 커스텀 input/textarea에 포커스가 있으면 그리드 키보드 핸들링 건너뛰기
            const tag = document.activeElement?.tagName?.toLowerCase();
            if (tag === 'input' || tag === 'textarea') return;

            // If editing, only handle edit keys
            if (editingCell) {
                return;
            }

            // Get current position
            const currentObjIndex = safeData.findIndex(d => d[keyField] === selectedCell.rowKey);
            const currentColIndex = leafColumns.findIndex(c => c.id === selectedCell.colId);

            if (selectedCell.type === 'cell' || !selectedCell.type) {
                if (currentObjIndex === -1 || currentColIndex === -1) return;

                let nextRowIndex = currentObjIndex;
                let nextColIndex = currentColIndex;

                switch (e.key) {
                    case 'ArrowUp':
                        nextRowIndex = Math.max(0, currentObjIndex - 1);
                        e.preventDefault();
                        break;
                    case 'ArrowDown':
                        nextRowIndex = Math.min(safeData.length - 1, currentObjIndex + 1);
                        e.preventDefault();
                        break;
                    case 'ArrowLeft':
                        nextColIndex = Math.max(0, currentColIndex - 1);
                        e.preventDefault();
                        break;
                    case 'ArrowRight':
                        nextColIndex = Math.min(leafColumns.length - 1, currentColIndex + 1);
                        e.preventDefault();
                        break;
                    case 'Tab':
                        if (!tabNavigation) return;
                        e.preventDefault();
                        if (e.shiftKey) {
                            nextColIndex = currentColIndex - 1;
                            if (nextColIndex < 0) {
                                nextColIndex = leafColumns.length - 1;
                                nextRowIndex = Math.max(0, currentObjIndex - 1);
                            }
                        } else {
                            nextColIndex = currentColIndex + 1;
                            if (nextColIndex >= leafColumns.length) {
                                nextColIndex = 0;
                                nextRowIndex = Math.min(safeData.length - 1, currentObjIndex + 1);
                            }
                        }
                        break;
                    case 'Enter':
                        const rowInfo = safeData[currentObjIndex];
                        const colInfo = leafColumns[currentColIndex];
                        if (canEditCell(rowInfo, colInfo)) {
                            const val = getCellValue(rowInfo, colInfo);
                            startEditing(selectedCell.rowKey, selectedCell.colId, val, false);
                        }
                        e.preventDefault();
                        return;
                    case 'Delete':
                    case 'Backspace':
                        if (e.key === 'Delete' || (e.key === 'Backspace' && !editingCell)) {
                            const dRow = safeData[currentObjIndex];
                            const dCol = leafColumns[currentColIndex];
                            if (canEditCell(dRow, dCol) && onCellChange) {
                                onCellChange(dRow, selectedCell.colId, '');
                            }
                            e.preventDefault();
                        }
                        return;
                    case 'Escape':
                        setSelectedCell(null);
                        setRangeEnd(null);
                        e.preventDefault();
                        return;
                    case 'c':
                        if ((e.ctrlKey || e.metaKey) && enableClipboard) {
                            const cRow = safeData[currentObjIndex];
                            const cCol = leafColumns[currentColIndex];
                            const cellVal = getCellValue(cRow, cCol);
                            navigator.clipboard.writeText(String(cellVal)).catch(() => { });
                            e.preventDefault();
                        }
                        return;
                    case 'v':
                        if ((e.ctrlKey || e.metaKey) && enableClipboard) {
                            const pRow = safeData[currentObjIndex];
                            const pCol = leafColumns[currentColIndex];
                            if (canEditCell(pRow, pCol)) {
                                navigator.clipboard.readText().then(text => {
                                    if (onCellChange) onCellChange(pRow, selectedCell.colId, text.trim());
                                }).catch(() => { });
                            }
                            e.preventDefault();
                        }
                        return;
                    default:
                        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                            const rInfo = safeData[currentObjIndex];
                            const cInfo = leafColumns[currentColIndex];
                            if (canEditCell(rInfo, cInfo)) {
                                startEditing(selectedCell.rowKey, selectedCell.colId, e.key, true);
                                e.preventDefault();
                            }
                        }
                        return;
                }

                if (nextRowIndex !== currentObjIndex || nextColIndex !== currentColIndex) {
                    const nextRow = safeData[nextRowIndex];
                    const nextCol = leafColumns[nextColIndex];
                    if (e.shiftKey && rangeSelection && e.key.startsWith('Arrow')) {
                        setRangeEnd({ rowKey: nextRow[keyField], colId: nextCol.id });
                    } else {
                        setRangeEnd(null);
                        handleCellClick(nextRow, nextCol.id);
                    }
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedCell, editingCell, safeData, leafColumns, enableEditing, keyField, tabNavigation, enableClipboard, rangeSelection]);

    // ---- Cell Helpers ----
    const canEditCell = (row, col) => {
        if (!enableEditing) return false;
        if (editableRowKey !== null && row[keyField] !== editableRowKey) return false;
        if (isCellEditable && !isCellEditable(row, col)) return false;
        return true;
    };

    const getCellValue = (row, col) => {
        if (!col || !row) return '';
        return row[col.id] != null ? row[col.id] : '';
    };

    // ---- Cell Click / Selection ----
    const handleCellClick = (row, colId, e) => {
        if (editingCell && (editingCell.rowKey !== row[keyField] || editingCell.colId !== colId)) {
            commitEdit();
        }

        if (e && e.shiftKey && rangeSelection && selectedCell && selectedCell.type === 'cell') {
            setRangeEnd({ rowKey: row[keyField], colId });
        } else {
            setSelectedCell({ type: 'cell', rowKey: row[keyField], colId });
            setRangeEnd(null);
        }

        if (selectionMode === 'row' && onRowSelect) {
            onRowSelect(row);
        }
    };

    const handleColumnHeaderClick = (colId, isGroup = false) => {
        if (editingCell) commitEdit();
        setSelectedCell({ type: isGroup ? 'group_col' : 'col', colId });
        setRangeEnd(null);
        if (onColumnSelect) onColumnSelect(colId);
    };

    const handleRowHeaderClick = (rowKey, row) => {
        if (editingCell) commitEdit();
        setSelectedCell({ type: 'row', rowKey });
        setRangeEnd(null);
        if (onRowSelect && row) onRowSelect(row);
    };

    const handleSortClick = (colId) => {
        if (!sortable) return;
        setSortState(prev => {
            if (prev.colId === colId) {
                if (prev.direction === 'asc') return { colId, direction: 'desc' };
                if (prev.direction === 'desc') return { colId: null, direction: null };
            }
            return { colId, direction: 'asc' };
        });
        if (onSort) {
            const dir = sortState.colId === colId
                ? (sortState.direction === 'asc' ? 'desc' : null)
                : 'asc';
            onSort(colId, dir);
        }
    };

    // ---- Editing ----
    const handleCellDoubleClick = (row, col) => {
        if (onCellDoubleClick) onCellDoubleClick(row, col);
        if (!canEditCell(row, col)) return;
        const value = getCellValue(row, col);
        startEditing(row[keyField], col.id, value, false);
    };

    const startEditing = (rowKey, colId, initialValue, isOverwrite) => {
        setEditingCell({ rowKey, colId, tempValue: initialValue || '' });
    };

    const commitEdit = () => {
        if (editingCell && onCellChange) {
            const row = safeData.find(d => d[keyField] === editingCell.rowKey);
            if (row) {
                const currentVal = getCellValue(row, leafColumns.find(c => c.id === editingCell.colId));
                if (String(currentVal) !== String(editingCell.tempValue)) {
                    onCellChange(row, editingCell.colId, editingCell.tempValue);
                }
            }
        }
        setEditingCell(null);
    };

    const handleEditKeyDown = (e) => {
        if (e.key === 'Enter') {
            commitEdit();
            // Move down like Excel
            if (selectedCell && selectedCell.type === 'cell') {
                const idx = safeData.findIndex(d => d[keyField] === selectedCell.rowKey);
                if (idx < safeData.length - 1) {
                    const nextRow = safeData[idx + 1];
                    setSelectedCell({ type: 'cell', rowKey: nextRow[keyField], colId: selectedCell.colId });
                }
            }
            e.stopPropagation();
        } else if (e.key === 'Escape') {
            setEditingCell(null);
            e.stopPropagation();
        } else if (e.key === 'Tab' && tabNavigation) {
            commitEdit();
            e.preventDefault();
            e.stopPropagation();
            // Tab to next cell
            if (selectedCell) {
                const colIdx = leafColumns.findIndex(c => c.id === selectedCell.colId);
                const rowIdx = safeData.findIndex(d => d[keyField] === selectedCell.rowKey);
                let nextCol = colIdx + (e.shiftKey ? -1 : 1);
                let nextRowIdx = rowIdx;
                if (nextCol >= leafColumns.length) { nextCol = 0; nextRowIdx = Math.min(safeData.length - 1, rowIdx + 1); }
                if (nextCol < 0) { nextCol = leafColumns.length - 1; nextRowIdx = Math.max(0, rowIdx - 1); }
                setSelectedCell({ type: 'cell', rowKey: safeData[nextRowIdx][keyField], colId: leafColumns[nextCol].id });
            }
        }
    };

    // ---- Column Resize ----
    const handleResizeMouseDown = (e, colId) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const currentWidth = columnWidths[colId] || leafColumns.find(c => c.id === colId)?.width || defaultColumnWidth;

        const handleMouseMove = (moveEvt) => {
            const delta = moveEvt.clientX - startX;
            const newWidth = Math.max(40, currentWidth + delta);
            setColumnWidths(prev => ({ ...prev, [colId]: newWidth }));
        };

        const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };

    // ---- Context Menu ----
    const handleContextMenu = (e, row, col) => {
        if (!contextMenu) return;
        e.preventDefault();
        const rect = gridContainerRef.current.getBoundingClientRect();
        setCtxMenu({
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
            row, col
        });
    };

    const executeContextAction = (action) => {
        if (!ctxMenu) return;
        const { row, col } = ctxMenu;
        switch (action) {
            case 'copy':
                if (row && col) {
                    const val = getCellValue(row, col);
                    navigator.clipboard.writeText(String(val)).catch(() => { });
                }
                break;
            case 'paste':
                if (row && col && canEditCell(row, col)) {
                    navigator.clipboard.readText().then(text => {
                        if (onCellChange) onCellChange(row, col.id, text.trim());
                    }).catch(() => { });
                }
                break;
            case 'clear':
                if (row && col && canEditCell(row, col) && onCellChange) {
                    onCellChange(row, col.id, '');
                }
                break;
            case 'sort_asc':
                if (col) handleSortClick(col.id);
                break;
        }
        setCtxMenu(null);
    };

    // ---- Status Bar Computation ----
    const statusBarValues = useMemo(() => {
        if (!showStatusBar || !selectedCell) return null;

        let values = [];

        if (selectedCell.type === 'cell' && !rangeEnd) {
            const row = safeData.find(d => d[keyField] === selectedCell.rowKey);
            const col = leafColumns.find(c => c.id === selectedCell.colId);
            if (row && col) {
                const v = parseFloat(getCellValue(row, col));
                if (!isNaN(v)) values = [v];
            }
        } else if (selectedCell.type === 'col' || selectedCell.type === 'group_col') {
            const targetIds = selectedCell.type === 'group_col'
                ? leafColumns.filter(c => c.parentId === selectedCell.colId || c.id === selectedCell.colId).map(c => c.id)
                : [selectedCell.colId];
            safeData.forEach(row => {
                targetIds.forEach(id => {
                    const v = parseFloat(row[id]);
                    if (!isNaN(v)) values.push(v);
                });
            });
        } else if (selectedCell.type === 'row') {
            const row = safeData.find(d => d[keyField] === selectedCell.rowKey);
            if (row) {
                leafColumns.forEach(col => {
                    const v = parseFloat(row[col.id]);
                    if (!isNaN(v)) values.push(v);
                });
            }
        }

        if (values.length === 0) return null;

        const sum = values.reduce((a, b) => a + b, 0);
        return {
            sum: sum.toFixed(2),
            avg: (sum / values.length).toFixed(2),
            count: values.length
        };
    }, [selectedCell, rangeEnd, safeData, leafColumns, keyField, showStatusBar]);

    // ---- Selection state helpers ----
    const isCellInSelection = (rowKey, colId) => {
        if (!selectedCell) return { targeted: false, highlighted: false };

        let targeted = false;
        let highlighted = false;

        if (selectedCell.type === 'cell' || !selectedCell.type) {
            targeted = selectedCell.rowKey === rowKey && selectedCell.colId === colId;
            highlighted = selectedCell.rowKey === rowKey || selectedCell.colId === colId;
        } else if (selectedCell.type === 'col') {
            highlighted = selectedCell.colId === colId;
        } else if (selectedCell.type === 'group_col') {
            const col = leafColumns.find(c => c.id === colId);
            highlighted = col && (col.parentId === selectedCell.colId || col.id === selectedCell.colId);
        } else if (selectedCell.type === 'row') {
            highlighted = selectedCell.rowKey === rowKey;
        }

        return { targeted, highlighted };
    };

    const isHeaderActive = (colDef) => {
        if (!selectedCell) return false;
        if (selectedCell.type === 'group_col' && colDef.id === selectedCell.colId) return true;
        if (selectedCell.type === 'col' && colDef.subCols && colDef.subCols.some(sc => sc.id === selectedCell.colId)) return true;
        if ((selectedCell.type === 'cell' || !selectedCell.type) && (colDef.id === selectedCell.colId || (colDef.subCols && colDef.subCols.some(sc => sc.id === selectedCell.colId)))) return true;
        return false;
    };

    const isSubHeaderActive = (scId, parentId) => {
        if (!selectedCell) return false;
        if (selectedCell.type === 'col' && scId === selectedCell.colId) return true;
        if ((selectedCell.type === 'cell' || !selectedCell.type) && scId === selectedCell.colId) return true;
        if (selectedCell.type === 'group_col' && parentId === selectedCell.colId) return true;
        return false;
    };

    // ============================================================================
    // RENDER
    // ============================================================================
    const renderHeaders = () => {
        if (!showHeader) return null;
        const hasSubCols = columns.some(c => c.subCols && c.subCols.length > 0);
        const subHeaderHeight = hasSubCols ? headerRowHeight : 0;

        return (
            <div ref={headerScrollRef} style={{ overflow: 'hidden', backgroundColor: headerBgColor, borderBottom: `2px solid ${gridLineColor}`, flexShrink: 0 }}>
                <div style={{ width: totalGridWidth, position: 'relative', display: 'flex' }}>
                    {/* Corner */}
                    {showRowHeader && (
                        <div style={{ width: rowHeaderWidth, flexShrink: 0, position: 'sticky', left: 0, zIndex: 12, backgroundColor: headerBgColor, borderRight: `${gridLineWidth}px solid ${gridLineColor}`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' }}>
                            <span style={{ color: '#B0B0B0', fontSize: 12, fontFamily: 'Inter, sans-serif' }}>{rowHeaderLabel}</span>
                        </div>
                    )}

                    {/* Column headers */}
                    <div style={{ flex: 1, display: 'flex' }}>
                        {Array.isArray(columns) && columns.map((c, idx) => {
                            const isLastGroup = idx === columns.length - 1;
                            const colHasSubCols = c.subCols && c.subCols.length > 0;
                            const groupWidth = colHasSubCols
                                ? c.subCols.reduce((sum, sc) => sum + getColWidth(sc), 0)
                                : getColWidth(c);
                            const active = isHeaderActive(c);
                            const bg = active ? activeHeaderBgColor : (c.headerStyle?.background || c.headerStyle?.backgroundColor || c.headerBgColor || headerBgColor);
                            const textC = active ? activeHeaderTextColor : (c.headerStyle?.color || c.headerTextColor || headerTextColor);
                            const topH = (hasSubCols && !colHasSubCols) ? headerRowHeight * 2 : (hasSubCols ? headerRowHeight : headerRowHeight * 2);

                            // Sticky support for main header
                            const firstLeaf = colHasSubCols ? c.subCols[0] : c;
                            const leafInLeaves = leafColumns.find(l => l.id === (colHasSubCols ? c.subCols[0].id : c.id));
                            const isSticky = leafInLeaves?.frozen;
                            const stickyStyle = isSticky ? { position: 'sticky', left: leafInLeaves.stickyLeft, zIndex: 11 } : {};

                            return (
                                <div key={c.id} style={{ display: 'flex', flexDirection: 'column', width: groupWidth, borderRight: c.borderRight ? c.borderRight : (!isLastGroup && showVerticalLines ? `${gridLineWidth}px solid ${gridLineColor}` : 'none'), borderLeft: c.borderLeft || 'none', boxSizing: 'border-box', ...stickyStyle }}>
                                    {/* Top Header */}
                                    <div
                                        onClick={() => handleColumnHeaderClick(c.id, true)}
                                        style={{ height: topH, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, fontSize: headerFontSize, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif", color: textC, backgroundColor: bg, borderBottom: colHasSubCols ? `${gridLineWidth}px solid ${gridLineColor}` : 'none', boxSizing: 'border-box', transition: 'background-color 0.15s ease', cursor: 'pointer', userSelect: 'none', position: 'relative' }}
                                    >
                                        {c.label}
                                        {/* Sort indicator */}
                                        {sortable && sortState.colId === c.id && (
                                            <span style={{ fontSize: 10, color: '#E42313' }}>
                                                {sortState.direction === 'asc' ? '▲' : '▼'}
                                            </span>
                                        )}
                                    </div>

                                    {/* Sub Headers */}
                                    {colHasSubCols && (
                                        <div style={{ display: 'flex', height: subHeaderHeight }}>
                                            {c.subCols.map((sc, i) => {
                                                const isLastSub = i === c.subCols.length - 1;
                                                const subActive = isSubHeaderActive(sc.id, c.id);
                                                const subBg = subActive ? activeHeaderBgColor : (sc.headerStyle?.background || sc.headerStyle?.backgroundColor || sc.headerBgColor || c.headerStyle?.background || c.headerStyle?.backgroundColor || c.headerBgColor || headerBgColor);
                                                const subTextC = subActive ? activeHeaderTextColor : (sc.headerStyle?.color || sc.headerTextColor || c.headerStyle?.color || c.headerTextColor || headerTextColor);
                                                const scWidth = getColWidth(sc);

                                                // Sticky support for sub-headers
                                                const subLeaf = leafColumns.find(l => l.id === sc.id);
                                                const subStickyStyle = subLeaf?.frozen ? { position: 'sticky', left: subLeaf.stickyLeft, zIndex: 11 } : {};

                                                return (
                                                    <div key={sc.id}
                                                        onClick={() => { handleColumnHeaderClick(sc.id, false); if (sortable) handleSortClick(sc.id); }}
                                                        style={{ width: scWidth, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, fontSize: Math.max(10, headerFontSize - 1), fontWeight: 500, fontFamily: "'Inter', sans-serif", color: subTextC, backgroundColor: subBg, borderRight: sc.borderRight || (isLastSub && c.borderRight ? c.borderRight : (!isLastSub && showVerticalLines ? `${gridLineWidth}px solid ${gridLineColor}` : 'none')), borderLeft: sc.borderLeft || (i === 0 && c.borderLeft ? c.borderLeft : 'none'), boxSizing: 'border-box', transition: 'background-color 0.15s ease', cursor: 'pointer', userSelect: 'none', position: 'relative', ...subStickyStyle }}
                                                    >
                                                        {sc.label}
                                                        {sortable && sortState.colId === sc.id && (
                                                            <span style={{ fontSize: 9, color: '#E42313' }}>
                                                                {sortState.direction === 'asc' ? '▲' : '▼'}
                                                            </span>
                                                        )}
                                                        {/* Resize handle */}
                                                        {resizableColumns && (
                                                            <div
                                                                onMouseDown={(e) => handleResizeMouseDown(e, sc.id)}
                                                                style={{ position: 'absolute', right: -2, top: 0, bottom: 0, width: 5, cursor: 'col-resize', zIndex: 5 }}
                                                            />
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                    {/* Resize handle for non-grouped columns */}
                                    {!colHasSubCols && resizableColumns && (
                                        <div
                                            onMouseDown={(e) => handleResizeMouseDown(e, c.id)}
                                            style={{ position: 'absolute', right: -2, top: 0, bottom: 0, width: 5, cursor: 'col-resize', zIndex: 5 }}
                                        />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div ref={gridContainerRef} style={{ width, height, flexShrink: 0, flexGrow: 0, display: 'flex', flexDirection: 'column', backgroundColor: '#FFFFFF', border: `1px solid ${gridLineColor}`, overflow: 'hidden', fontFamily: "'Inter', sans-serif", position: 'relative' }}>

            {/* ---- Toolbar ---- */}
            {(title || description || onRefresh) && (
                <div style={{ padding: '14px 20px', borderBottom: `1px solid ${gridLineColor}`, flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                        {title && <h2 style={{ fontSize: 18, fontWeight: 600, color: '#0D0D0D', margin: 0, fontFamily: "'Space Grotesk', sans-serif", letterSpacing: '-0.3px', whiteSpace: 'nowrap', flexShrink: 0 }}>{title}</h2>}
                        {description && <span style={{ fontSize: 12, color: '#7A7A7A', fontFamily: "'Inter', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{description}</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        {onRefresh && (
                            <button onClick={onRefresh} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#fff', border: `1px solid ${gridLineColor}`, padding: '7px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 500, fontFamily: "'Space Grotesk', sans-serif", color: '#0D0D0D', transition: 'all 0.15s ease' }} onMouseOver={e => e.currentTarget.style.background = '#FAFAFA'} onMouseOut={e => e.currentTarget.style.background = '#fff'}>
                                <span className="material-icons" style={{ fontSize: 15, color: '#7A7A7A' }}>refresh</span> Refresh
                            </button>
                        )}
                    </div>
                </div>
            )}

            {renderHeaders()}

            {/* ---- Grid Body ---- */}
            <div ref={bodyScrollRef} onScroll={handleBodyScroll} style={{ flex: 1, overflowY: 'auto', overflowX: 'auto', position: 'relative' }}>
                <div style={{ height: totalDataHeight, width: totalGridWidth, position: 'relative' }}>
                    {visibleData.map(({ index, item }) => {
                        const rowKey = item[keyField];
                        const isRowSelected = (selectionMode === 'row' && selectedCell?.rowKey === rowKey) || (selectedCell?.type === 'row' && selectedCell.rowKey === rowKey);
                        const isAltRow = index % 2 !== 0;
                        const defaultRowBg = isAltRow ? altRowBgColor : rowBgColor;
                        const isHovered = hoveredRowKey === rowKey;
                        const defaultHoverRowBg = isRowSelected ? columnHighlightBgColor : (isHovered ? hoverRowBgColor : defaultRowBg);
                        const isRowHighlight = selectedCell && (selectedCell.type === 'row' ? selectedCell.rowKey === rowKey : selectedCell.rowKey === rowKey);

                        const customRowStyle = getRowStyle ? getRowStyle(item, isRowSelected, isHovered) : {};
                        const rowBg = customRowStyle.background || defaultHoverRowBg;

                        return (
                            <div key={rowKey}
                                onMouseEnter={() => setHoveredRowKey(rowKey)}
                                onMouseLeave={() => setHoveredRowKey(null)}
                                style={{
                                    position: 'absolute', top: index * rowHeight, left: 0,
                                    width: totalGridWidth, height: rowHeight,
                                    display: 'flex', boxSizing: 'border-box', backgroundColor: rowBg,
                                    ...customRowStyle
                                }}
                            >
                                {/* Row Header */}
                                {showRowHeader && (
                                    <div
                                        onClick={() => handleRowHeaderClick(rowKey, item)}
                                        style={{ width: rowHeaderWidth, flexShrink: 0, position: 'sticky', left: 0, zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: isRowHighlight ? activeHeaderBgColor : (isAltRow ? altRowBgColor : '#FAFAFA'), borderRight: `${gridLineWidth}px solid ${gridLineColor}`, borderBottom: showHorizontalLines ? `${gridLineWidth}px solid ${gridLineColor}` : 'none', boxSizing: 'border-box', transition: 'background-color 0.15s ease', cursor: 'pointer' }}
                                    >
                                        {renderRowHeader ? renderRowHeader(item, index) : <span style={{ fontSize: Math.max(10, fontSize - 1), fontWeight: isRowHighlight ? 700 : 400, fontFamily: "'Inter', sans-serif", color: isRowHighlight ? activeHeaderTextColor : '#7A7A7A' }}>{index + 1}</span>}
                                    </div>
                                )}

                                {/* Cells */}
                                <div style={{ flex: 1, display: 'flex' }}>
                                    {leafColumns.map((col, cIdx) => {
                                        const isLastCol = cIdx === leafColumns.length - 1;
                                        const colWidth = getColWidth(col);
                                        const cellEditable = canEditCell(item, col);
                                        const { targeted: isCellTargeted, highlighted: isHighlightBg } = isCellInSelection(rowKey, col.id);
                                        const isEditMode = editingCell?.rowKey === rowKey && editingCell?.colId === col.id;

                                        // 정확히 선택된 셀만 미세한 테두리, 하이라이트 셀은 배경색만
                                        const focusRingStyle = isCellTargeted ? {
                                            boxShadow: `inset 0 0 0 ${selectedCellBorderWidth}px ${selectedCellBorderColor}`,
                                            zIndex: 2,
                                        } : {};

                                        const baseBg = isHighlightBg
                                            ? columnHighlightBgColor
                                            : ((!cellEditable && !isRowSelected && !isCellTargeted) ? readOnlyCellBgColor : 'transparent');

                                        const val = getCellValue(item, col);

                                        return (
                                            <div key={col.id}
                                                onClick={(e) => handleCellClick(item, col.id, e)}
                                                onDoubleClick={() => handleCellDoubleClick(item, col)}
                                                onContextMenu={(e) => handleContextMenu(e, item, col)}
                                                style={{
                                                    width: colWidth, flexShrink: 0,
                                                    display: 'flex', alignItems: 'center', padding: renderCell ? 0 : '0 12px',
                                                    justifyContent: (col.align || cellAlign) === 'center' ? 'center' : (col.align || cellAlign) === 'right' ? 'flex-end' : 'flex-start',
                                                    position: 'relative', boxSizing: 'border-box',
                                                    cursor: cellEditable ? 'cell' : 'default',
                                                    backgroundColor: baseBg,
                                                    borderBottom: showHorizontalLines ? `${gridLineWidth}px solid ${gridLineColor}` : 'none',
                                                    borderRight: col.inheritedBorderRight || (showVerticalLines && !isLastCol ? `${gridLineWidth}px solid ${gridLineColor}` : 'none'),
                                                    borderLeft: col.inheritedBorderLeft || 'none',
                                                    ...focusRingStyle,
                                                    transition: 'background-color 0.1s ease',
                                                    ...(col.frozen ? { position: 'sticky', left: col.stickyLeft, zIndex: 3, backgroundColor: isHighlightBg ? columnHighlightBgColor : (baseBg === 'transparent' ? rowBg : baseBg) } : {})
                                                }}
                                            >
                                                {isEditMode ? (
                                                    <input
                                                        ref={editInputRef}
                                                        autoFocus
                                                        value={editingCell.tempValue}
                                                        onChange={(e) => setEditingCell({ ...editingCell, tempValue: e.target.value })}
                                                        onKeyDown={handleEditKeyDown}
                                                        style={{
                                                            width: '100%', height: '100%', border: 'none', background: 'transparent',
                                                            outline: 'none', fontSize, fontFamily: "'Inter', sans-serif", color: '#0D0D0D',
                                                            padding: 0, margin: 0,
                                                            textAlign: col.align || cellAlign || 'left'
                                                        }}
                                                    />
                                                ) : (
                                                    <div style={{ width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize, fontFamily: "'Inter', sans-serif", color: '#0D0D0D', fontWeight: 400, textAlign: col.align || cellAlign || 'left' }}>
                                                        {renderCell ? renderCell(item, col, val, isCellTargeted) : val}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* ---- Context Menu ---- */}
            {ctxMenu && (
                <div style={{ position: 'absolute', left: ctxMenu.x, top: ctxMenu.y, backgroundColor: '#fff', border: `1px solid ${gridLineColor}`, boxShadow: '0 4px 12px rgba(0,0,0,0.08)', zIndex: 100, minWidth: 160, padding: '4px 0' }}>
                    {[
                        { key: 'copy', label: '복사 (Ctrl+C)', icon: 'content_copy' },
                        { key: 'paste', label: '붙여넣기 (Ctrl+V)', icon: 'content_paste' },
                        { key: 'clear', label: '지우기 (Delete)', icon: 'backspace' },
                        ...(sortable ? [{ key: 'sort_asc', label: '정렬', icon: 'sort' }] : []),
                    ].map(item => (
                        <div key={item.key}
                            onClick={() => executeContextAction(item.key)}
                            style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, fontFamily: "'Inter', sans-serif", color: '#0D0D0D', transition: 'background 0.1s' }}
                            onMouseOver={e => e.currentTarget.style.background = '#FAFAFA'}
                            onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                        >
                            <span className="material-icons" style={{ fontSize: 16, color: '#7A7A7A' }}>{item.icon}</span>
                            {item.label}
                        </div>
                    ))}
                </div>
            )}

            {/* ---- Bottom Status / Action Bar ---- */}
            {showBottomBar && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 20px', borderTop: `1px solid ${gridLineColor}`, background: '#FFFFFF', flexShrink: 0 }}>
                    <span style={{ fontSize: 12, fontFamily: "'Inter', sans-serif", color: '#7A7A7A', fontWeight: 500 }}>
                        {safeData.length} records
                    </span>

                    {/* Status bar values */}
                    {showStatusBar && statusBarValues && (
                        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                <span style={{ fontSize: 11, fontFamily: "'Inter', sans-serif", color: '#B0B0B0', fontWeight: 500 }}>SUM:</span>
                                <span style={{ fontSize: 12, fontFamily: "'Space Grotesk', sans-serif", color: '#0D0D0D', fontWeight: 600 }}>{statusBarValues.sum}</span>
                            </div>
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                <span style={{ fontSize: 11, fontFamily: "'Inter', sans-serif", color: '#B0B0B0', fontWeight: 500 }}>AVG:</span>
                                <span style={{ fontSize: 12, fontFamily: "'Space Grotesk', sans-serif", color: '#0D0D0D', fontWeight: 600 }}>{statusBarValues.avg}</span>
                            </div>
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                <span style={{ fontSize: 11, fontFamily: "'Inter', sans-serif", color: '#B0B0B0', fontWeight: 500 }}>COUNT:</span>
                                <span style={{ fontSize: 12, fontFamily: "'Space Grotesk', sans-serif", color: '#0D0D0D', fontWeight: 600 }}>{statusBarValues.count}</span>
                            </div>
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: 8 }}>
                        {extraActions}
                        {onSave && (
                            <button
                                onClick={onSave}
                                disabled={!hasPending || loading}
                                style={{
                                    padding: '8px 16px', border: 'none',
                                    fontWeight: 500, fontSize: 13, fontFamily: "'Space Grotesk', sans-serif",
                                    cursor: hasPending ? 'pointer' : 'not-allowed',
                                    background: hasPending ? '#0D0D0D' : '#E8E8E8',
                                    color: hasPending ? '#FFFFFF' : '#B0B0B0',
                                    display: 'flex', alignItems: 'center', gap: 6,
                                    transition: 'all 0.15s ease'
                                }}
                            >
                                <span className="material-icons" style={{ fontSize: 15 }}>{hasPending ? 'save' : 'check'}</span>
                                {loading ? 'Saving...' : hasPending ? saveLabel : 'Saved'}
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdvancedDataGrid;
