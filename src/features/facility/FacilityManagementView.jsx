import React, { useState, useEffect, useRef } from 'react';
import { useFacilityViewModel } from './useFacilityViewModel';
import { useDialog } from '../../components/common/DialogContext';

/**
 * FacilityManagementView — 고장·수리 이력 관리
 *
 * [향후 연계 계획: 장비이력카드]
 * - facility_logs 테이블에 facility_id 컬럼 추가 예정
 *
 * - EquipmentCardView (src/features/facility/EquipmentCardView.jsx) 에서
 *   장비 목록(장비명, 사양, 사진, 설치일 등)을 관리
 * - 이 뷰에서 행 클릭 시 해당 장비카드로 이동하거나 팝업으로 연결하는 UX 구현 예정
 * - 장비 선택 드롭다운 컬럼 추가로 입력 표준화 계획
 */

const TODAY = () => new Date().toISOString().split('T')[0];
const BORDER = '#9ca3af';
const HDR_BG = '#374151';
const HDR_TEXT = '#f8fafc';
const ROW_H = 28;

const COLS = [
    { id: 'date',          label: '날짜',     w: 102, type: 'date' },
    { id: 'location',      label: '장소',     w: 110 },
    { id: 'facility_name', label: '기기명',   w: 130 },
    { id: 'content',       label: '작업내용', flex: true },
    { id: 'notes',         label: '비고',     w: 120 },
];

const FacilityManagementView = ({ currentUser }) => {
    const { showConfirm } = useDialog();
    const vm = useFacilityViewModel(currentUser);

    const [selectedId, setSelectedId] = useState(null);
    const [editingId, setEditingId] = useState(null); // null | 'new' | row.id
    const [editVals, setEditVals] = useState({});
    const [searchInput, setSearchInput] = useState('');

    const locationRef = useRef(null);

    useEffect(() => {
        if (editingId === 'new' && locationRef.current) {
            locationRef.current.focus();
        }
    }, [editingId]);

    const startNew = () => {
        setEditingId('new');
        setEditVals({ date: TODAY(), location: '', facility_name: '', content: '', notes: '' });
        setSelectedId(null);
    };

    const startEdit = (row) => {
        setEditingId(row.id);
        setEditVals({
            date: row.date || '',
            location: row.location || '',
            facility_name: row.facility_name || '',
            content: row.content || '',
            notes: row.notes || '',
        });
        setSelectedId(row.id);
    };

    const commitEdit = async (id, vals) => {
        if (!id) return;
        const isEmpty = !vals.facility_name && !vals.location && !vals.content;
        if (id === 'new' && isEmpty) return;
        if (id === 'new') {
            await vm.createLog(vals);
        } else {
            await vm.updateLog(id, vals);
        }
    };

    const handleBlur = (e, id, vals) => {
        if (e.currentTarget.contains(e.relatedTarget)) return;
        const snapId = id;
        const snapVals = { ...vals };
        setEditingId(null);
        setEditVals({});
        commitEdit(snapId, snapVals);
    };

    const handleDelete = (id) => {
        showConfirm('삭제 확인', '선택한 항목을 삭제하시겠습니까?', () => {
            vm.deleteLog(id);
            setSelectedId(null);
        });
    };

    const updateVal = (key, val) => setEditVals(p => ({ ...p, [key]: val }));

    const renderEditRow = (id, isNew) => (
        <div
            key={id}
            onBlur={e => handleBlur(e, id, editVals)}
            style={{
                display: 'flex', height: ROW_H,
                background: '#fefce8',
                borderBottom: `1px solid ${BORDER}`,
            }}
        >
            {COLS.map(col => (
                <div key={col.id} style={{
                    width: col.flex ? undefined : col.w,
                    flex: col.flex ? 1 : undefined,
                    borderRight: `1px solid ${BORDER}`,
                    boxSizing: 'border-box',
                    display: 'flex', alignItems: 'center',
                }}>
                    <input
                        ref={col.id === 'location' && isNew ? locationRef : undefined}
                        type={col.type || 'text'}
                        value={editVals[col.id] ?? ''}
                        onChange={e => updateVal(col.id, e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter') e.target.blur();
                            if (e.key === 'Escape') { setEditingId(null); setEditVals({}); }
                        }}
                        style={{
                            flex: 1, width: 0, height: '100%',
                            border: 'none', background: 'transparent', outline: 'none',
                            padding: '0 7px', fontSize: 12,
                            fontFamily: "'Inter', sans-serif",
                        }}
                    />
                </div>
            ))}
            <div style={{ width: 28, flexShrink: 0 }} />
        </div>
    );

    return (
        <div style={{
            width: '100%', height: '100%', background: '#fff',
            padding: '1.25rem', boxSizing: 'border-box',
            display: 'flex', flexDirection: 'column', gap: '0.5rem',
        }}>

            {/* 테이블 */}
            <div style={{
                flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column',
                border: `1px solid ${BORDER}`, borderRadius: 5,
            }}>
                {/* 헤더 */}
                <div style={{ display: 'flex', background: HDR_BG, flexShrink: 0, borderBottom: `2px solid #6b7280` }}>
                    {COLS.map(col => (
                        <div key={col.id} style={{
                            width: col.flex ? undefined : col.w,
                            flex: col.flex ? 1 : undefined,
                            padding: '5px 8px', textAlign: 'center',
                            fontSize: 12, fontWeight: 700, color: HDR_TEXT,
                            borderRight: '1px solid #6b7280',
                            boxSizing: 'border-box', letterSpacing: '0.02em',
                        }}>{col.label}</div>
                    ))}
                    <div style={{ width: 28, flexShrink: 0 }} />
                </div>

                {/* 바디 */}
                <div style={{ flex: 1, overflowY: 'auto' }}>
                    {editingId === 'new' && renderEditRow('new', true)}

                    {vm.loading ? (
                        <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>불러오는 중...</div>
                    ) : vm.logs.length === 0 && editingId !== 'new' ? (
                        <div style={{ padding: '2rem', textAlign: 'center', color: '#cbd5e1', fontSize: 12 }}>등록된 내역이 없습니다.</div>
                    ) : vm.logs.map((row, idx) => {
                        if (editingId === row.id) return renderEditRow(row.id, false);
                        const isSel = selectedId === row.id;
                        return (
                            <div key={row.id}
                                onClick={() => setSelectedId(isSel ? null : row.id)}
                                onDoubleClick={() => startEdit(row)}
                                style={{
                                    display: 'flex', alignItems: 'center',
                                    height: ROW_H,
                                    background: isSel ? '#dbeafe' : (idx % 2 === 0 ? '#fff' : '#f8fafc'),
                                    borderBottom: `1px solid ${BORDER}`,
                                    cursor: 'pointer', userSelect: 'none',
                                }}
                            >
                                {COLS.map(col => (
                                    <div key={col.id} style={{
                                        width: col.flex ? undefined : col.w,
                                        flex: col.flex ? 1 : undefined,
                                        height: '100%', padding: '0 7px',
                                        fontSize: 12, color: '#1e293b',
                                        boxSizing: 'border-box',
                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                        borderRight: `1px solid ${BORDER}`,
                                        display: 'flex', alignItems: 'center',
                                    }} title={row[col.id] || ''}>
                                        {row[col.id] || ''}
                                    </div>
                                ))}
                                <div style={{ width: 28, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    {isSel && (
                                        <button
                                            onClick={e => { e.stopPropagation(); handleDelete(row.id); }}
                                            style={{
                                                background: 'none', border: 'none', cursor: 'pointer',
                                                color: '#ef4444', padding: 2, display: 'flex', lineHeight: 1,
                                            }}
                                        >
                                            <span className="material-icons" style={{ fontSize: 15 }}>delete</span>
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* 푸터 */}
                <div style={{
                    borderTop: `1px solid ${BORDER}`,
                    padding: '3px 10px', fontSize: 11, color: '#64748b',
                    flexShrink: 0, background: '#f1f5f9',
                }}>
                    총 {vm.logs.length}건
                </div>
            </div>

            {/* 하단 툴바 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <input
                    style={{
                        width: 180, height: 28, border: `1px solid ${BORDER}`,
                        borderRadius: 4, padding: '0 8px',
                        fontSize: 12, outline: 'none', boxSizing: 'border-box', background: '#fff',
                    }}
                    placeholder="검색어 입력"
                    value={searchInput}
                    onChange={e => setSearchInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') vm.handleSearch(searchInput); }}
                />
                <button
                    onClick={() => vm.handleSearch(searchInput)}
                    style={{
                        height: 28, padding: '0 12px', borderRadius: 4,
                        border: `1px solid ${BORDER}`, background: '#f1f5f9',
                        fontSize: 12, cursor: 'pointer', flexShrink: 0,
                        display: 'flex', alignItems: 'center', gap: 3, color: '#374151', fontWeight: 600,
                    }}
                >
                    <span className="material-icons" style={{ fontSize: 14 }}>search</span>
                    검색
                </button>
                <button
                    onClick={startNew}
                    style={{
                        height: 28, padding: '0 14px', borderRadius: 4, border: 'none',
                        background: '#1e293b', color: '#fff',
                        fontSize: 12, fontWeight: 700, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
                    }}
                >
                    <span className="material-icons" style={{ fontSize: 14 }}>add</span>
                    추가
                </button>
            </div>
        </div>
    );
};

export default FacilityManagementView;
