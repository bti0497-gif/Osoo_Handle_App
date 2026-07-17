import React from 'react';

function toDisplay(value) {
    if (value === null || value === undefined || value === '') return '-';
    return String(value);
}

export default function WaterQualityWidget({ rows, summary }) {
    return (
        <section style={{ border: '1px solid #e2e8f0', borderRadius: '12px', backgroundColor: '#ffffff', padding: '0.85rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 900, color: '#0f172a' }}>수질 데이터 위젯</h3>
                <span style={{ fontSize: '0.78rem', color: '#475569', fontWeight: 800 }}>
                    최근 7일 평균 / 최신 측정 목록
                </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '0.65rem', marginBottom: '0.75rem' }}>
                <div style={{ border: '1px solid #dbeafe', backgroundColor: '#eff6ff', borderRadius: 10, padding: '0.55rem' }}>
                    <div style={{ fontSize: '0.74rem', color: '#1d4ed8', fontWeight: 800 }}>NH3-N</div>
                    <div style={{ fontSize: '1.1rem', color: '#0f172a', fontWeight: 900 }}>{summary.nh3_n}</div>
                </div>
                <div style={{ border: '1px solid #cffafe', backgroundColor: '#ecfeff', borderRadius: 10, padding: '0.55rem' }}>
                    <div style={{ fontSize: '0.74rem', color: '#0e7490', fontWeight: 800 }}>NO3-N</div>
                    <div style={{ fontSize: '1.1rem', color: '#0f172a', fontWeight: 900 }}>{summary.no3_n}</div>
                </div>
                <div style={{ border: '1px solid #fee2e2', backgroundColor: '#fef2f2', borderRadius: 10, padding: '0.55rem' }}>
                    <div style={{ fontSize: '0.74rem', color: '#b91c1c', fontWeight: 800 }}>PO4-P</div>
                    <div style={{ fontSize: '1.1rem', color: '#0f172a', fontWeight: 900 }}>{summary.po4_p}</div>
                </div>
                <div style={{ border: '1px solid #ede9fe', backgroundColor: '#f5f3ff', borderRadius: 10, padding: '0.55rem' }}>
                    <div style={{ fontSize: '0.74rem', color: '#6d28d9', fontWeight: 800 }}>알칼리도</div>
                    <div style={{ fontSize: '1.1rem', color: '#0f172a', fontWeight: 900 }}>{summary.alkalinity}</div>
                </div>
            </div>

            <div style={{ maxHeight: 230, overflow: 'auto', border: '1px solid #e2e8f0', borderRadius: 10 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                    <thead style={{ position: 'sticky', top: 0, backgroundColor: '#f8fafc', zIndex: 1 }}>
                        <tr>
                            <th style={{ textAlign: 'left', padding: '0.45rem', borderBottom: '1px solid #e2e8f0' }}>날짜</th>
                            <th style={{ textAlign: 'left', padding: '0.45rem', borderBottom: '1px solid #e2e8f0' }}>위치</th>
                            <th style={{ textAlign: 'right', padding: '0.45rem', borderBottom: '1px solid #e2e8f0' }}>NH3-N</th>
                            <th style={{ textAlign: 'right', padding: '0.45rem', borderBottom: '1px solid #e2e8f0' }}>NO3-N</th>
                            <th style={{ textAlign: 'right', padding: '0.45rem', borderBottom: '1px solid #e2e8f0' }}>PO4-P</th>
                            <th style={{ textAlign: 'right', padding: '0.45rem', borderBottom: '1px solid #e2e8f0' }}>알칼리도</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length === 0 ? (
                            <tr>
                                <td colSpan={6} style={{ textAlign: 'center', padding: '1rem', color: '#94a3b8', fontWeight: 700 }}>
                                    수질 데이터가 없습니다.
                                </td>
                            </tr>
                        ) : rows.map((row, idx) => (
                            <tr key={`${row.date}-${row.location}-${idx}`}>
                                <td style={{ padding: '0.4rem 0.45rem', borderBottom: '1px solid #f1f5f9', color: '#334155' }}>{row.date}</td>
                                <td style={{ padding: '0.4rem 0.45rem', borderBottom: '1px solid #f1f5f9', color: '#334155' }}>{toDisplay(row.location)}</td>
                                <td style={{ textAlign: 'right', padding: '0.4rem 0.45rem', borderBottom: '1px solid #f1f5f9' }}>{toDisplay(row.nh3_n)}</td>
                                <td style={{ textAlign: 'right', padding: '0.4rem 0.45rem', borderBottom: '1px solid #f1f5f9' }}>{toDisplay(row.no3_n)}</td>
                                <td style={{ textAlign: 'right', padding: '0.4rem 0.45rem', borderBottom: '1px solid #f1f5f9' }}>{toDisplay(row.po4_p)}</td>
                                <td style={{ textAlign: 'right', padding: '0.4rem 0.45rem', borderBottom: '1px solid #f1f5f9' }}>{toDisplay(row.alkalinity)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
