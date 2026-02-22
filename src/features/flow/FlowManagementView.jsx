import React, { useState, useEffect, useRef } from 'react';
import { useFlowViewModel } from './useFlowViewModel';
import { useDialog } from '../../components/common/DialogProvider';

const FlowManagementView = ({ currentUser }) => {
    const { showAlert } = useDialog();
    const {
        history, loading, flowTypes, correctData,
        updateReading, updateManualReading, submitBatch, refresh, pendingChanges
    } = useFlowViewModel(currentUser, { showAlert });

    const [selectedDate, setSelectedDate] = useState(null);
    const [isManualEditMode, setIsManualEditMode] = useState(false);

    const scrollRef = useRef(null);
    const todayStr = new Date().toISOString().split('T')[0];

    useEffect(() => {
        if (history.length > 0 && scrollRef.current) {
            const el = scrollRef.current.querySelector(`[data-date="${todayStr}"]`);
            if (el) {
                const h = scrollRef.current.clientHeight;
                scrollRef.current.scrollTop = el.offsetTop - h / 2 + el.clientHeight / 2;
            }
        }
    }, [history, todayStr]);

    const fmt = (v) => {
        if (v === undefined || v === null || v === '' || isNaN(v)) return '';
        return Number(v).toLocaleString();
    };

    const cols = [
        { id: '유입유량계', label: '유입량' },
        { id: '방류유량계', label: '방류량' },
        { id: '내부반송유량계', label: '내부반송' },
        { id: '외부반송유량계', label: '외부반송' },
        { id: '슬러지', label: '슬러지' },
        { id: '전력량계', label: '전력' }
    ];

    const hasPending = Object.keys(pendingChanges).length > 0;

    return (
        <div className="panel-container justify-center">
            <div className="dynamic-panel shadow-2xl border-slate-200" style={{ width: 820, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

                {/* 헤더 */}
                <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h1 style={{ fontSize: '18px', fontWeight: 900, color: '#1e293b', margin: 0 }}>유량 검침값 등록</h1>
                        <button onClick={refresh} style={{ display: 'flex', alignItems: 'center', gap: 3, background: 'none', border: '1px solid #e2e8f0', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: '#64748b' }}>
                            <span className="material-icons" style={{ fontSize: 13 }}>refresh</span>새로고침
                        </button>
                    </div>
                    <p style={{ fontSize: 10, color: '#94a3b8', margin: '4px 0 0', fontWeight: 500 }}>노란색 셀에 검침(적산) 수치를 입력하면 누계가 자동 계산됩니다.</p>
                </div>

                {/* 그리드 */}
                <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', overflowX: 'auto' }}>
                    <table style={{ borderCollapse: 'collapse', fontSize: 11, minWidth: 76 + cols.length * 120 }}>
                        <colgroup>
                            <col style={{ width: 76, minWidth: 76 }} />
                            {cols.map((c) => (
                                <React.Fragment key={c.id}>
                                    <col style={{ width: 68, minWidth: 68 }} />
                                    <col style={{ width: 52, minWidth: 52 }} />
                                </React.Fragment>
                            ))}
                        </colgroup>
                        <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                            <tr>
                                <th rowSpan={2} style={{ ...th1, background: '#1e3a8a', borderRight: '1px solid #2563eb', position: 'sticky', left: 0, zIndex: 12 }}>날짜</th>
                                {cols.map(c => (
                                    <th key={c.id} colSpan={2} style={{ ...th1, borderRight: '1px solid #2563eb' }}>{c.label}</th>
                                ))}
                            </tr>
                            <tr>
                                {cols.map(c => (
                                    <React.Fragment key={`s-${c.id}`}>
                                        <th style={{ ...th2, background: '#fef08a', color: '#92400e' }}>{c.id === '슬러지' ? '반출량' : '적산'}</th>
                                        <th style={{ ...th2, background: '#dbeafe', color: '#1e40af' }}>누계</th>
                                    </React.Fragment>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {history.map(row => {
                                const isToday = row.date === todayStr;
                                const isFuture = row.isFuture;
                                const isSelected = row.date === selectedDate;
                                return (
                                    <tr key={row.date} data-date={row.date}
                                        onClick={() => {
                                            if (!isManualEditMode) setSelectedDate(isSelected ? null : row.date);
                                        }}
                                        style={{
                                            background: isSelected ? '#fef3c7' : (isToday ? '#eff6ff' : isFuture ? '#fafafa' : '#fff'),
                                            cursor: isManualEditMode ? 'default' : 'pointer',
                                            ...(isSelected ? { outline: '2px solid #f59e0b', outlineOffset: -2, position: 'relative', zIndex: 6 } : isToday ? { outline: '2px solid #3b82f6', outlineOffset: -2, position: 'relative', zIndex: 5 } : {})
                                        }}>
                                        <td style={{
                                            padding: '0 4px', height: 26, textAlign: 'center',
                                            fontWeight: isToday ? 900 : 600, fontSize: 10.5,
                                            color: isToday ? '#1d4ed8' : isFuture ? '#a0aec0' : '#475569',
                                            background: isSelected ? '#fef3c7' : isToday ? '#dbeafe' : '#f8fafc',
                                            borderRight: '1px solid #cbd5e1', borderBottom: '1px solid #e2e8f0',
                                            whiteSpace: 'nowrap',
                                            position: 'sticky', left: 0, zIndex: 3
                                        }}>{row.date}</td>

                                        {cols.map(c => {
                                            const d = row[c.id]?.isUserInput
                                                ? { reading: row[c.id].raw, flow: row[c.id].diff, error: row[c.id].error }
                                                : correctData(row[c.id]);
                                            const changed = pendingChanges[row.date]?.[c.id];
                                            const isManual = isSelected && isManualEditMode;
                                            return (
                                                <React.Fragment key={`${row.date}-${c.id}`}>
                                                    <td style={{
                                                        padding: 0, borderRight: '1px solid #e5e7eb', borderBottom: '1px solid #e2e8f0',
                                                        background: d.error ? '#fee2e2' : (isManual ? '#fef08a' : (isFuture ? '#f5f5f5' : '#FFFF00')),
                                                        position: 'relative'
                                                    }} title={d.error || ''}>
                                                        <input
                                                            type="text"
                                                            style={{
                                                                width: '100%', height: 26, outline: 'none',
                                                                textAlign: 'right', padding: '0 4px',
                                                                fontWeight: 700, fontSize: 11,
                                                                color: d.error ? '#dc2626' : (changed ? '#1d4ed8' : '#1e293b'),
                                                                background: 'transparent',
                                                                cursor: (isFuture && !isManual) ? 'not-allowed' : 'text',
                                                                border: d.error ? '2px solid #ef4444' : 'none',
                                                                boxSizing: 'border-box'
                                                            }}
                                                            value={d.reading != null ? Number(d.reading).toLocaleString() : ''}
                                                            placeholder="-"
                                                            onChange={e => {
                                                                if (isManual) updateManualReading(row.date, c.id, 'raw', e.target.value.replace(/,/g, ''));
                                                                else updateReading(row.date, c.id, e.target.value.replace(/,/g, ''));
                                                            }}
                                                            disabled={isFuture && !isManual}
                                                        />
                                                    </td>
                                                    <td style={{
                                                        padding: isManual ? 0 : '0 3px', textAlign: 'right', fontWeight: 600, fontSize: 10.5,
                                                        borderRight: '1px solid #e5e7eb', borderBottom: '1px solid #e2e8f0',
                                                        color: d.flow != null ? '#475569' : '#d1d5db',
                                                        background: isManual ? '#fef08a' : (isFuture ? '#fafafa' : '#fff')
                                                    }}>
                                                        {isManual ? (
                                                            <input
                                                                type="text"
                                                                style={{
                                                                    width: '100%', height: 26, outline: 'none', border: 'none',
                                                                    textAlign: 'right', padding: '0 4px',
                                                                    fontWeight: 700, fontSize: 10.5,
                                                                    color: changed ? '#1d4ed8' : '#1e293b',
                                                                    background: 'transparent',
                                                                    boxSizing: 'border-box'
                                                                }}
                                                                value={d.flow != null ? Number(d.flow).toLocaleString() : ''}
                                                                placeholder="-"
                                                                onChange={e => updateManualReading(row.date, c.id, 'diff', e.target.value.replace(/,/g, ''))}
                                                            />
                                                        ) : (fmt(d.flow) || '-')}
                                                    </td>
                                                </React.Fragment>
                                            );
                                        })}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* 하단 바 */}
                <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '8px 16px', borderTop: '1px solid #e2e8f0', background: '#f8fafc', flexShrink: 0
                }}>
                    <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600 }}>
                        총 {history.length}행 · 오늘: {todayStr}
                    </span>
                    <div style={{ display: 'flex', gap: 8 }}>
                        {selectedDate && !isManualEditMode && (
                            <button
                                onClick={() => setIsManualEditMode(true)}
                                style={{
                                    padding: '5px 14px', borderRadius: 6, border: '1px solid #cbd5e1',
                                    fontWeight: 800, fontSize: 11, cursor: 'pointer',
                                    background: '#fff', color: '#475569',
                                    display: 'flex', alignItems: 'center', gap: 4
                                }}
                            >
                                <span className="material-icons" style={{ fontSize: 14 }}>edit</span>
                                수동으로 수정
                            </button>
                        )}
                        {isManualEditMode && (
                            <button
                                onClick={async () => {
                                    await submitBatch();
                                    setIsManualEditMode(false);
                                    setSelectedDate(null);
                                }}
                                disabled={loading}
                                style={{
                                    padding: '5px 14px', borderRadius: 6, border: 'none',
                                    fontWeight: 800, fontSize: 11, cursor: 'pointer',
                                    background: '#f59e0b', color: '#fff',
                                    display: 'flex', alignItems: 'center', gap: 4
                                }}
                            >
                                <span className="material-icons" style={{ fontSize: 14 }}>save</span>
                                {loading ? '저장 중...' : '수정사항 저장'}
                            </button>
                        )}
                        {!isManualEditMode && (
                            <button
                                onClick={submitBatch}
                                disabled={!hasPending || loading}
                                style={{
                                    padding: '5px 14px', borderRadius: 6, border: 'none',
                                    fontWeight: 800, fontSize: 11, cursor: hasPending ? 'pointer' : 'default',
                                    background: hasPending ? '#1e293b' : '#e2e8f0',
                                    color: hasPending ? '#fff' : '#94a3b8',
                                    display: 'flex', alignItems: 'center', gap: 4
                                }}
                            >
                                <span className="material-icons" style={{ fontSize: 14 }}>save_alt</span>
                                {loading ? '저장 중...' : hasPending ? '변경사항 저장' : '변경사항 없음'}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

const th1 = { padding: '6px 2px', fontSize: 11, fontWeight: 800, textAlign: 'center', color: '#fff', background: '#1e40af', borderBottom: '1px solid #2563eb' };
const th2 = { padding: '3px 2px', fontSize: 9, fontWeight: 800, textAlign: 'center', borderBottom: '2px solid #94a3b8', borderRight: '1px solid #e5e7eb' };

export default FlowManagementView;
