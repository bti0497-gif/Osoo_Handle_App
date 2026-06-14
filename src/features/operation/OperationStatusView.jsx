import React from 'react';
import { useDialog } from '../../components/common/DialogContext';
import { getTodayKST } from '../../core/constants';
import { useOperationStatusViewModel } from './useOperationStatusViewModel';

const inputStyle = {
    width: 120,
    height: 40,
    border: '1px solid #cbd5e1',
    borderRadius: 6,
    padding: '0 10px',
    fontSize: 15,
    fontWeight: 800,
    color: '#0f172a',
    textAlign: 'right',
    background: '#fff',
};

const labelStyle = {
    fontSize: 13,
    fontWeight: 900,
    color: '#475569',
};

const valueLabel = {
    fontSize: 12,
    fontWeight: 800,
    color: '#94a3b8',
};

function formatValue(value) {
    if (value === null || value === undefined || value === '') return '-';
    return String(value);
}

const OperationStatusView = ({ currentUser }) => {
    const { showToast } = useDialog();
    const {
        history = [],
        form,
        selectedDate,
        selectedRecord,
        loading,
        saving,
        selectDate,
        updateField,
        save,
        refresh,
    } = useOperationStatusViewModel(currentUser, { showToast });

    return (
        <div style={{
            width: '100%',
            height: '100%',
            minWidth: 0,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            padding: 18,
            background: '#f8fafc',
            overflow: 'hidden',
        }}>
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexShrink: 0,
            }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900, color: '#0f172a' }}>운전상태</h1>
                    <p style={{ margin: '6px 0 0', fontSize: 13, fontWeight: 700, color: '#64748b' }}>
                        일일업무일지에 바인딩할 PH, DO, SVI 값을 저장합니다.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={refresh}
                    disabled={loading}
                    style={{
                        height: 42,
                        padding: '0 16px',
                        borderRadius: 6,
                        border: '1px solid #cbd5e1',
                        background: '#fff',
                        color: '#1e293b',
                        fontSize: 14,
                        fontWeight: 900,
                        cursor: loading ? 'not-allowed' : 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 8,
                    }}
                >
                    <span className="material-icons" style={{ fontSize: 18 }}>refresh</span>
                    Refresh
                </button>
            </div>

            <div style={{
                flex: 1,
                minHeight: 0,
                display: 'grid',
                gridTemplateColumns: '360px minmax(0, 1fr)',
                gap: 14,
            }}>
                <section style={{
                    minHeight: 0,
                    border: '1px solid #e2e8f0',
                    borderRadius: 8,
                    background: '#fff',
                    padding: 18,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 16,
                }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <label style={labelStyle} htmlFor="operation-date">날짜</label>
                        <input
                            id="operation-date"
                            type="date"
                            value={form.date}
                            max={getTodayKST()}
                            onChange={(event) => selectDate(event.target.value)}
                            style={{ ...inputStyle, width: 180, textAlign: 'left' }}
                        />
                    </div>

                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr auto',
                        gap: '14px 12px',
                        alignItems: 'center',
                        borderTop: '1px solid #e2e8f0',
                        paddingTop: 16,
                    }}>
                        <div>
                            <div style={labelStyle}>PH</div>
                            <div style={valueLabel}>수소이온농도</div>
                        </div>
                        <input
                            type="number"
                            step="0.01"
                            value={form.ph}
                            onChange={(event) => updateField('ph', event.target.value)}
                            style={inputStyle}
                        />

                        <div>
                            <div style={labelStyle}>DO</div>
                            <div style={valueLabel}>용존산소</div>
                        </div>
                        <input
                            type="number"
                            step="0.01"
                            value={form.do_value}
                            onChange={(event) => updateField('do_value', event.target.value)}
                            style={inputStyle}
                        />

                        <div>
                            <div style={labelStyle}>SVI</div>
                            <div style={valueLabel}>슬러지 용적 지표</div>
                        </div>
                        <input
                            type="number"
                            step="0.01"
                            value={form.svi}
                            onChange={(event) => updateField('svi', event.target.value)}
                            style={inputStyle}
                        />
                    </div>

                    <div style={{
                        marginTop: 'auto',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 10,
                        borderTop: '1px solid #e2e8f0',
                        paddingTop: 16,
                    }}>
                        <div style={{ fontSize: 12, fontWeight: 800, color: '#94a3b8' }}>
                            {selectedRecord ? '선택일 데이터 수정' : '선택일 새 데이터'}
                        </div>
                        <button
                            type="button"
                            onClick={save}
                            disabled={saving}
                            style={{
                                height: 44,
                                minWidth: 108,
                                borderRadius: 6,
                                border: '1px solid #1e293b',
                                background: '#1e293b',
                                color: '#fff',
                                fontSize: 15,
                                fontWeight: 900,
                                cursor: saving ? 'not-allowed' : 'pointer',
                            }}
                        >
                            저장하기
                        </button>
                    </div>
                </section>

                <section style={{
                    minWidth: 0,
                    minHeight: 0,
                    border: '1px solid #e2e8f0',
                    borderRadius: 8,
                    background: '#fff',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                }}>
                    <div style={{
                        flexShrink: 0,
                        display: 'grid',
                        gridTemplateColumns: '140px repeat(3, 100px) minmax(180px, 1fr)',
                        background: '#f8fafc',
                        borderBottom: '1px solid #e2e8f0',
                        color: '#475569',
                        fontSize: 12,
                        fontWeight: 900,
                    }}>
                        {['날짜', 'PH', 'DO', 'SVI', '수정 시각'].map((header) => (
                            <div key={header} style={{ padding: '12px 14px' }}>{header}</div>
                        ))}
                    </div>
                    <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                        {history.length === 0 ? (
                            <div style={{
                                height: '100%',
                                minHeight: 220,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: '#94a3b8',
                                fontWeight: 800,
                            }}>
                                저장된 운전상태 데이터가 없습니다.
                            </div>
                        ) : history.map((row) => {
                            const selected = row.date === selectedDate;
                            return (
                                <button
                                    key={`${row.date}-${row.id || 'new'}`}
                                    type="button"
                                    onClick={() => selectDate(row.date)}
                                    style={{
                                        width: '100%',
                                        display: 'grid',
                                        gridTemplateColumns: '140px repeat(3, 100px) minmax(180px, 1fr)',
                                        border: 0,
                                        borderBottom: '1px solid #e2e8f0',
                                        background: selected ? '#fef3c7' : '#fff',
                                        color: '#1e293b',
                                        textAlign: 'left',
                                        cursor: 'pointer',
                                        fontSize: 13,
                                        fontWeight: selected ? 900 : 800,
                                    }}
                                >
                                    <div style={{ padding: '12px 14px' }}>{row.date}</div>
                                    <div style={{ padding: '12px 14px', textAlign: 'right' }}>{formatValue(row.ph)}</div>
                                    <div style={{ padding: '12px 14px', textAlign: 'right' }}>{formatValue(row.do_value)}</div>
                                    <div style={{ padding: '12px 14px', textAlign: 'right' }}>{formatValue(row.svi)}</div>
                                    <div style={{ padding: '12px 14px', color: '#64748b' }}>{row.last_modified || '-'}</div>
                                </button>
                            );
                        })}
                    </div>
                </section>
            </div>
        </div>
    );
};

export default OperationStatusView;
