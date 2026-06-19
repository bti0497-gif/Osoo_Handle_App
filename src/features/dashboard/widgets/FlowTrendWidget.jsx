import React, { useMemo } from 'react';
import LineChartPanel from './LineChartPanel';

const SERIES_META = [
    { key: 'inflow', label: '유입유량', color: '#2563eb', axis: 'left' },
    { key: 'outflow', label: '방류유량', color: '#0ea5e9', axis: 'left' },
    { key: 'internalReturn', label: '내부반송', color: '#ef4444', axis: 'right' },
    { key: 'externalReturn', label: '외부반송', color: '#f97316', axis: 'right' },
    { key: 'power', label: '전력량', color: '#7c3aed', axis: 'left' },
];

function domainOf(rows, keys) {
    let max = -Infinity;
    rows.forEach((row) => {
        keys.forEach((key) => {
            if (row[key] === null || row[key] === undefined || row[key] === '') return;
            const value = Number(row[key]);
            if (Number.isFinite(value)) {
                max = Math.max(max, value);
            }
        });
    });
    if (!Number.isFinite(max)) {
        return { min: 0, max: 1 };
    }

    return {
        min: 0,
        max: Math.max(1, max * 1.7),
    };
}

export default function FlowTrendWidget({
    rows,
    visibleSeries,
    onToggleSeries,
    rangeText,
    canGoPast,
    canGoFuture,
    onGoPast,
    onGoFuture,
}) {
    const lines = useMemo(() => SERIES_META.map((meta) => ({
        ...meta,
        visible: !!visibleSeries[meta.key],
    })), [visibleSeries]);

    const leftKeys = useMemo(
        () => lines.filter((line) => line.visible && line.axis === 'left').map((line) => line.key),
        [lines]
    );
    const rightKeys = useMemo(
        () => lines.filter((line) => line.visible && line.axis === 'right').map((line) => line.key),
        [lines]
    );
    const leftDomain = useMemo(() => domainOf(rows, leftKeys), [rows, leftKeys]);
    const rightDomain = useMemo(() => domainOf(rows, rightKeys), [rows, rightKeys]);

    return (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', minHeight: 280 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 900, color: '#0f172a' }}>유량/전력 변화(최근 1개월)</h3>
                    {SERIES_META.map((meta) => (
                        <label key={meta.key} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', color: '#334155', fontWeight: 700 }}>
                            <input
                                type="checkbox"
                                checked={!!visibleSeries[meta.key]}
                                onChange={() => onToggleSeries(meta.key)}
                            />
                            <span style={{ color: meta.color }}>{meta.label}</span>
                        </label>
                    ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <button
                        onClick={onGoPast}
                        disabled={!canGoPast}
                        style={{
                            height: 30,
                            minWidth: 74,
                            borderRadius: 8,
                            border: '1px solid #2563eb',
                            backgroundColor: canGoPast ? '#2563eb' : '#dbeafe',
                            color: canGoPast ? '#ffffff' : '#64748b',
                            fontWeight: 800,
                            padding: '0 0.65rem',
                            cursor: canGoPast ? 'pointer' : 'not-allowed'
                        }}
                    >
                        이전 1주
                    </button>
                    <button
                        onClick={onGoFuture}
                        disabled={!canGoFuture}
                        style={{
                            height: 30,
                            minWidth: 74,
                            borderRadius: 8,
                            border: '1px solid #0ea5e9',
                            backgroundColor: canGoFuture ? '#0ea5e9' : '#e0f2fe',
                            color: canGoFuture ? '#ffffff' : '#64748b',
                            fontWeight: 800,
                            padding: '0 0.65rem',
                            cursor: canGoFuture ? 'pointer' : 'not-allowed'
                        }}
                    >
                        다음 1주
                    </button>
                    <span
                        style={{
                            fontSize: '0.78rem',
                            color: '#0f172a',
                            fontWeight: 800,
                            backgroundColor: '#f8fafc',
                            border: '1px solid #cbd5e1',
                            borderRadius: 8,
                            padding: '0.3rem 0.55rem'
                        }}
                    >
                        {rangeText}
                    </span>
                </div>
            </div>
            <div style={{ flex: 1 }}>
                <LineChartPanel rows={rows} lines={lines} leftDomain={leftDomain} rightDomain={rightDomain} />
            </div>
        </section>
    );
}

