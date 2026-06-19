import React, { useMemo } from 'react';

function makePath(points) {
    if (!points.length) return '';
    return points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
}

function formatNumber(value) {
    if (!Number.isFinite(value)) return '-';
    return Intl.NumberFormat('ko-KR').format(Math.round(value * 10) / 10);
}

function toFiniteNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

const WIDTH = 1000;
const HEIGHT = 240;
const PADDING = { top: 20, right: 36, bottom: 38, left: 42 };

function normalizeDomain(domain, fallbackMax) {
    const min = Number(domain?.min);
    const max = Number(domain?.max);
    if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
        return { min, max };
    }
    const numericFallbackMax = Number(fallbackMax);
    const safeMax = Number.isFinite(numericFallbackMax) && numericFallbackMax > 0 ? numericFallbackMax : 1;
    return { min: 0, max: safeMax };
}

export default function LineChartPanel({ rows, lines, leftMax, rightMax, leftDomain, rightDomain }) {
    const leftScale = useMemo(() => normalizeDomain(leftDomain, leftMax), [leftDomain, leftMax]);
    const rightScale = useMemo(() => normalizeDomain(rightDomain, rightMax), [rightDomain, rightMax]);

    const chart = useMemo(() => {
        const innerWidth = WIDTH - PADDING.left - PADDING.right;
        const innerHeight = HEIGHT - PADDING.top - PADDING.bottom;
        const safeRows = Array.isArray(rows) ? rows : [];
        const xDenom = Math.max(1, safeRows.length - 1);

        const scaleX = (index) => PADDING.left + (innerWidth * index) / xDenom;
        const scaleY = (value, axis) => {
            const domain = axis === 'right' ? rightScale : leftScale;
            if (!Number.isFinite(value) || domain.max <= domain.min) return PADDING.top + innerHeight;
            const ratio = Math.max(0, Math.min(1, (value - domain.min) / (domain.max - domain.min)));
            return PADDING.top + innerHeight * (1 - ratio);
        };

        const linePaths = lines
            .filter((line) => line.visible)
            .map((line) => {
                const points = safeRows
                    .map((row, idx) => {
                        const value = toFiniteNumber(row[line.key]);
                        if (value === null) return null;
                        const x = scaleX(idx);
                        const y = scaleY(value, line.axis);
                        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
                        return { x, y, value };
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
    }, [rows, lines, leftScale, rightScale]);

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

                <text x={PADDING.left} y={14} fontSize="11" fill="#334155">
                    좌축 {formatNumber(leftScale.min)}~{formatNumber(leftScale.max)}
                </text>
                <text x={WIDTH - PADDING.right} y={14} fontSize="11" fill="#334155" textAnchor="end">
                    우축 {formatNumber(rightScale.min)}~{formatNumber(rightScale.max)}
                </text>
            </svg>
        </div>
    );
}

