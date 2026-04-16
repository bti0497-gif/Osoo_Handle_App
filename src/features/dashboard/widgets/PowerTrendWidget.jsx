import React, { useMemo } from 'react';
import LineChartPanel from './LineChartPanel';

function maxOf(rows, key) {
    let max = 0;
    rows.forEach((row) => {
        const value = Number(row[key]);
        if (Number.isFinite(value)) {
            max = Math.max(max, value);
        }
    });
    return max;
}

export default function PowerTrendWidget({ rows }) {
    const lines = useMemo(() => ([
        { key: 'power', label: '전력량', color: '#7c3aed', axis: 'left', visible: true },
    ]), []);
    const leftMax = useMemo(() => Math.max(1, maxOf(rows, 'power')), [rows]);

    return (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', minHeight: 280 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 900, color: '#0f172a' }}>전력량 변화</h3>
                <span style={{ fontSize: '0.74rem', color: '#7c3aed', fontWeight: 800 }}>최근 1개월</span>
            </div>
            <div style={{ flex: 1 }}>
                <LineChartPanel rows={rows} lines={lines} leftMax={leftMax} rightMax={leftMax} />
            </div>
        </section>
    );
}

