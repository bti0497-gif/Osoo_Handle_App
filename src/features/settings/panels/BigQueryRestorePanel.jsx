export default function BigQueryRestorePanel({ state }) {
    const {
        tables, startDate, setStartDate, endDate, setEndDate,
        selectedTables, toggleTable, preview, totalCount,
        isInspecting, isRestoring, inspect, restore,
    } = state;

    return (
        <div style={{ width: '100%', minWidth: 0, padding: 24 }}>
            <div style={{ maxWidth: 920, margin: '0 auto', display: 'grid', gap: 18 }}>
                <section style={{ padding: 24, border: '1px solid #dbeafe', borderRadius: 18, background: '#f8fbff' }}>
                    <h2 style={{ margin: 0, fontSize: 22, color: '#0f172a' }}>BigQuery 로컬 자료 복원</h2>
                    <p style={{ margin: '10px 0 0', color: '#475569', lineHeight: 1.6 }}>
                        현재 현장의 BigQuery 자료를 지정 기간만큼 로컬 DB로 복원합니다.
                        실행 직전에 DB 전체를 자동 백업하며 로컬 미동기화 자료는 보존합니다.
                    </p>
                </section>

                <section style={{ padding: 24, border: '1px solid #e2e8f0', borderRadius: 18, background: '#fff' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 }}>
                        <label style={{ display: 'grid', gap: 7, fontWeight: 800, color: '#334155' }}>
                            시작일
                            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)}
                                style={{ height: 42, border: '1px solid #cbd5e1', borderRadius: 10, padding: '0 12px' }} />
                        </label>
                        <label style={{ display: 'grid', gap: 7, fontWeight: 800, color: '#334155' }}>
                            종료일
                            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)}
                                style={{ height: 42, border: '1px solid #cbd5e1', borderRadius: 10, padding: '0 12px' }} />
                        </label>
                    </div>

                    <div style={{ marginTop: 20, display: 'grid', gap: 10 }}>
                        {tables.map((table) => (
                            <label key={table.id} style={{
                                display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
                                border: '1px solid #e2e8f0', borderRadius: 12, cursor: 'pointer',
                            }}>
                                <input type="checkbox" checked={selectedTables.includes(table.id)}
                                    onChange={() => toggleTable(table.id)} />
                                <span style={{ fontWeight: 800, color: '#1e293b' }}>{table.label}</span>
                            </label>
                        ))}
                    </div>

                    <button type="button" onClick={inspect}
                        disabled={isInspecting || isRestoring || !selectedTables.length}
                        style={{
                            width: '100%', height: 48, marginTop: 20, border: 0, borderRadius: 12,
                            background: '#2563eb', color: '#fff', fontWeight: 900,
                            cursor: isInspecting ? 'wait' : 'pointer',
                            opacity: !selectedTables.length ? 0.5 : 1,
                        }}>
                        {isInspecting ? 'BigQuery 조회 중...' : '복원 자료 조회'}
                    </button>
                </section>

                {preview && (
                    <section style={{ padding: 24, border: '1px solid #bbf7d0', borderRadius: 18, background: '#f0fdf4' }}>
                        <h3 style={{ margin: 0, color: '#166534' }}>
                            {preview.siteName} · 총 {totalCount.toLocaleString()}건
                        </h3>
                        <div style={{ marginTop: 14, display: 'grid', gap: 8 }}>
                            {tables.filter((table) => selectedTables.includes(table.id)).map((table) => {
                                const item = preview.result?.[table.id];
                                return (
                                    <div key={table.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 20 }}>
                                        <span>{table.label}</span>
                                        <strong style={{ color: item?.success === false ? '#dc2626' : '#166534' }}>
                                            {item?.success === false
                                                ? item.error
                                                : `${Number(item?.count || 0).toLocaleString()}건`}
                                        </strong>
                                    </div>
                                );
                            })}
                        </div>
                        <button type="button" onClick={restore} disabled={isRestoring || totalCount === 0}
                            style={{
                                width: '100%', height: 50, marginTop: 20, border: 0, borderRadius: 12,
                                background: '#16a34a', color: '#fff', fontWeight: 900,
                                cursor: isRestoring ? 'wait' : 'pointer',
                                opacity: totalCount === 0 ? 0.5 : 1,
                            }}>
                            {isRestoring ? '로컬 DB 복원 중...' : '조회한 자료를 로컬 DB에 복원'}
                        </button>
                    </section>
                )}
            </div>
        </div>
    );
}
