import React, { useMemo } from 'react';

function makePath(points) {
    if (!points.length) return '';
    return points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
}

function formatNumber(value) {
    if (!Number.isFinite(value)) return '-';
    return Intl.NumberFormat('ko-KR').format(Math.round(value * 10) / 10);
}

const WIDTH = 1000;
const HEIGHT = 240;
const PADDING = { top: 20, right: 36, bottom: 38, left: 42 };

export default function LineChartPanel({ rows, lines, leftMax, rightMax }) {
    const chart = useMemo(() => {
        const innerWidth = WIDTH - PADDING.left - PADDING.right;
        const innerHeight = HEIGHT - PADDING.top - PADDING.bottom;
        const safeRows = Array.isArray(rows) ? rows : [];
        const xDenom = Math.max(1, safeRows.length - 1);

        const scaleX = (index) => PADDING.left + (innerWidth * index) / xDenom;
        const scaleY = (value, axis) => {
            const max = axis === 'right' ? rightMax : leftMax;
            if (!Number.isFinite(value) || max <= 0) return PADDING.top + innerHeight;
            const ratio = Math.max(0, Math.min(1, value / max));
            return PADDING.top + innerHeight * (1 - ratio);
        };

        const linePaths = lines
            .filter((line) => line.visible)
            .map((line) => {
                const points = safeRows
                    .map((row, idx) => {
                        const value = row[line.key];
                        if (!Number.isFinite(value)) return null;
                        return { x: scaleX(idx), y: scaleY(value, line.axis), value };
                    })
                    .filter(Boolean);
                return { ...line, path: makePath(points), latest: points[points.length - 1]?.value ?? null };
            });

        const xTicks = safeRows.map((row, idx) => ({
            x: scaleX(idx),
            label: String(row.date || '').slice(5),
            show: idx === 0 || idx === safeRows.length - 1 || idx % 7 === 0,
        }));

        return { linePaths, xTicks, innerHeight, innerWidth };
    }, [rows, lines, leftMax, rightMax]);

    return (
        <div style={{ width: '100%', height: '100%', border: '1px solid #e2e8f0', borderRadius: '12px', backgroundColor: '#ffffff', padding: '0.5rem' }}>
            <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ width: '100%', height: '100%' }}>
                <line x1={PADDING.left} y1={HEIGHT - PADDING.bottom} x2={WIDTH - PADDING.right} y2={HEIGHT - PADDING.bottom} stroke="#cbd5e1" />
                <line x1={PADDING.left} y1={PADDING.top} x2={PADDING.left} y2={HEIGHT - PADDING.bottom} stroke="#cbd5e1" />
                <line x1={WIDTH - PADDING.right} y1={PADDING.top} x2={WIDTH - PADDING.right} y2={HEIGHT - PADDING.bottom} stroke="#e2e8f0" />

                {chart.xTicks.map((tick) => tick.show && (
                    <text key={`x-${tick.x}`} x={tick.x} y={HEIGHT - 12} fontSize="11" textAnchor="middle" fill="#64748b">
                        {tick.label}
                    </text>
                ))}

                {chart.linePaths.map((line) => (
                    <path key={line.key} d={line.path} fill="none" stroke={line.color} strokeWidth="2.5" strokeLinecap="round" />
                ))}

                <text x={PADDING.left} y={14} fontSize="11" fill="#334155">좌축 최대 {formatNumber(leftMax)}</text>
                <text x={WIDTH - PADDING.right} y={14} fontSize="11" fill="#334155" textAnchor="end">우축 최대 {formatNumber(rightMax)}</text>
            </svg>
        </div>
    );
}

