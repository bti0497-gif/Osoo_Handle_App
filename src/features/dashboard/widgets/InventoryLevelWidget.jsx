import React from 'react';

function normalizeLatestInventory(historyRows, nameKey) {
    const byName = new Map();
    historyRows.forEach((row) => {
        const name = String(row?.[nameKey] || '').trim();
        if (!name) return;
        const date = String(row?.date || '');
        const inv = Number(row?.current_inventory);
        const item = {
            name,
            date,
            inventory: Number.isFinite(inv) ? inv : 0,
        };
        const prev = byName.get(name);
        if (!prev || date >= prev.date) {
            byName.set(name, item);
        }
    });
    return Array.from(byName.values()).sort((a, b) => b.inventory - a.inventory);
}

function levelColor(percent) {
    if (percent <= 25) return '#ef4444';
    if (percent <= 50) return '#f59e0b';
    return '#22c55e';
}

function InventoryBottle({ item, max }) {
    const percent = Math.max(0, Math.min(100, (item.inventory / Math.max(1, max)) * 100));
    const fillColor = levelColor(percent);
    const lowStock = percent <= 25;

    return (
        <div
            style={{
                border: `1px solid ${lowStock ? '#fecaca' : '#e2e8f0'}`,
                backgroundColor: lowStock ? '#fff1f2' : '#ffffff',
                borderRadius: 10,
                padding: '0.55rem',
                display: 'grid',
                gridTemplateColumns: '46px 1fr',
                gap: '0.55rem',
                alignItems: 'center',
            }}
        >
            <div style={{ display: 'flex', justifyContent: 'center' }}>
                <div style={{ position: 'relative', width: 26, height: 62 }}>
                    <div style={{ position: 'absolute', top: 0, left: 7, width: 12, height: 8, borderRadius: '3px 3px 1px 1px', backgroundColor: '#94a3b8' }} />
                    <div style={{ position: 'absolute', top: 8, left: 2, width: 22, height: 52, borderRadius: '6px 6px 10px 10px', border: '2px solid #94a3b8', backgroundColor: '#f8fafc', overflow: 'hidden' }}>
                        <div
                            style={{
                                position: 'absolute',
                                bottom: 0,
                                left: 0,
                                width: '100%',
                                height: `${percent}%`,
                                background: `linear-gradient(180deg, ${fillColor}cc 0%, ${fillColor} 100%)`,
                                transition: 'height 0.6s ease, background 0.3s ease',
                            }}
                        />
                        <div
                            style={{
                                position: 'absolute',
                                top: 0,
                                left: '-30%',
                                width: '160%',
                                height: '100%',
                                background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.35) 50%, transparent 100%)',
                                animation: 'inventoryShine 2.2s linear infinite',
                                pointerEvents: 'none',
                            }}
                        />
                    </div>
                </div>
            </div>

            <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '0.78rem', color: '#0f172a', fontWeight: 900, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                    {item.name}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: 2 }}>
                    <span style={{ fontSize: '0.76rem', color: '#334155', fontWeight: 800 }}>
                        {Math.round(item.inventory * 10) / 10}
                    </span>
                    <span style={{ fontSize: '0.72rem', color: lowStock ? '#b91c1c' : '#64748b', fontWeight: 800 }}>
                        {Math.round(percent)}%
                    </span>
                    {lowStock && (
                        <span style={{ fontSize: '0.68rem', color: '#b91c1c', backgroundColor: '#fee2e2', border: '1px solid #fecaca', borderRadius: 999, padding: '0 0.35rem', fontWeight: 900 }}>
                            발주 필요
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}

function InventoryColumn({ title, items }) {
    const max = Math.max(1, ...items.map((i) => i.inventory));
    return (
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '0.65rem', backgroundColor: '#fff' }}>
            <h4 style={{ margin: '0 0 0.55rem', fontSize: '0.9rem', color: '#0f172a', fontWeight: 900 }}>{title}</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.45rem' }}>
                {items.length === 0 && (
                    <div style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 700, padding: '0.35rem 0.25rem', gridColumn: '1 / -1' }}>데이터 없음</div>
                )}
                {items.map((item) => {
                    return <InventoryBottle key={`${title}-${item.name}`} item={item} max={max} />;
                })}
            </div>
        </div>
    );
}

export default function InventoryLevelWidget({ medicineRows, kitRows }) {
    const latestMedicines = normalizeLatestInventory(medicineRows || [], 'medicine_name').slice(0, 8);
    const latestKits = normalizeLatestInventory(kitRows || [], 'kit_name').slice(0, 8);

    return (
        <section style={{ border: '1px solid #e2e8f0', borderRadius: '12px', backgroundColor: '#ffffff', padding: '0.85rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 900, color: '#0f172a' }}>약품/키트 재고 위젯</h3>
                <span style={{ fontSize: '0.78rem', color: '#475569', fontWeight: 800 }}>최신 재고 기준</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <InventoryColumn title="약품 재고" items={latestMedicines} />
                <InventoryColumn title="분석키트 재고" items={latestKits} />
            </div>
            <style>{`
                @keyframes inventoryShine {
                    0% { transform: translateX(-70%); }
                    100% { transform: translateX(70%); }
                }
            `}</style>
        </section>
    );
}

