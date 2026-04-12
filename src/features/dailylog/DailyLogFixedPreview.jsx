import React, { useState } from 'react';

const SECTION_CONFIG = [
    { key: 'nh3_n', photoKey: 'ammonia', label: 'NH₃-N(질산화)', note: '기준치 20ppm' },
    { key: 'no3_n', photoKey: 'nitrate', label: 'NO₃-N(탈질)', note: '기준치 20ppm' },
    { key: 'po4_p', photoKey: 'phosphorus', label: 'PO₄³⁻-P(인)', note: '기준치 2ppm' },
    { key: 'alkalinity', photoKey: 'alkalinity', label: 'Alkalinity\n(알칼리도)', note: '' },
];

function buildValueSlots(rows = [], fieldKey) {
    const values = rows.slice(0, 5).map((row) => row?.[fieldKey] ?? '');
    while (values.length < 5) {
        values.push('');
    }
    return values;
}

const pageStyle = {
    width: 'min(100%, 920px)',
    aspectRatio: '210 / 297',
    background: '#fff',
    border: '1px solid #cbd5e1',
    boxShadow: '0 18px 40px -24px rgba(15, 23, 42, 0.45)',
    margin: '24px auto',
    padding: '52px 44px 34px',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
};

const photoCellStyle = {
    position: 'relative',
    padding: '8px 0 6px',
    minHeight: 0,
    background: '#fff',
};

const photoFrameStyle = {
    position: 'absolute',
    inset: '8px 0 6px',
    overflow: 'hidden',
    background: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
};

const photoImageStyle = {
    width: '60%',
    height: '100%',
    objectFit: 'fill',
    display: 'block',
};

function DailyLogFixedPreview({ page, title }) {
    const [photoLoadFailureState, setPhotoLoadFailureState] = useState({ pageKey: null, failures: {} });

    if (!page) {
        return null;
    }

    const locationHeader = (page.locationLabels || []).slice(0, 5).join(' / ');

    return (
        <div
            aria-label={`${title} Preview`}
            style={{
                flex: 1,
                width: '100%',
                minHeight: 0,
                overflow: 'auto',
                backgroundColor: '#ffffff',
                padding: '0 24px 24px',
                boxSizing: 'border-box',
            }}
        >
            <div style={pageStyle}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px', marginBottom: '26px' }}>
                    <div style={{ textAlign: 'center', fontSize: '1.95rem', fontWeight: 700, letterSpacing: '0.12em', color: '#0f172a' }}>
                        수질분석 일지
                    </div>
                    <div style={{ textAlign: 'center', fontSize: '0.96rem', fontWeight: 600, color: '#64748b' }}>
                        {page.date}
                    </div>
                </div>

                <div style={{ border: '1px solid #334155', display: 'grid', gridTemplateColumns: '126px 1fr 138px' }}>
                    <div style={{ borderRight: '1px solid #334155', padding: '7px 8px', textAlign: 'center', fontSize: '0.78rem', fontWeight: 600 }}>구 분</div>
                    <div style={{ borderRight: '1px solid #334155', padding: '7px 8px', textAlign: 'center', fontSize: '0.78rem', fontWeight: 600 }}>{locationHeader}</div>
                    <div style={{ padding: '7px 8px', textAlign: 'center', fontSize: '0.78rem', fontWeight: 600 }}>비 고</div>
                </div>

                <div style={{ borderLeft: '1px solid #334155', borderRight: '1px solid #334155', borderBottom: '1px solid #334155', display: 'flex', flexDirection: 'column', flex: 1 }}>
                    {SECTION_CONFIG.map((section, index) => {
                        const values = buildValueSlots(page.rows, section.key);
                        const photoUrl = page.photoUrls?.[section.photoKey] || '';
                        const activeFailures = photoLoadFailureState.pageKey === page.pageKey ? photoLoadFailureState.failures : {};
                        const hasPhotoLoadFailure = Boolean(activeFailures[section.photoKey]);

                        return (
                            <div
                                key={section.key}
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns: '126px 1fr 138px',
                                    minHeight: 0,
                                    flex: 1,
                                    borderTop: index === 0 ? 'none' : '1px solid #334155',
                                }}
                            >
                                <div style={{ borderRight: '1px solid #334155', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px', fontSize: '0.85rem', color: '#1e293b', textAlign: 'center', whiteSpace: 'pre-line' }}>
                                    {section.label}
                                </div>

                                <div style={{ borderRight: '1px solid #334155', display: 'grid', gridTemplateRows: '1fr 34px', minHeight: 0 }}>
                                    <div style={photoCellStyle}>
                                        <div style={photoFrameStyle}>
                                            {photoUrl && !hasPhotoLoadFailure ? (
                                                <img
                                                    src={photoUrl}
                                                    alt={section.label}
                                                    style={photoImageStyle}
                                                    onError={() => {
                                                        setPhotoLoadFailureState((prev) => ({
                                                            pageKey: page.pageKey,
                                                            failures: {
                                                                ...(prev.pageKey === page.pageKey ? prev.failures : {}),
                                                                [section.photoKey]: true,
                                                            },
                                                        }));
                                                    }}
                                                />
                                            ) : null}
                                            {photoUrl && hasPhotoLoadFailure ? (
                                                <div
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        width: '100%',
                                                        height: '100%',
                                                        padding: '12px',
                                                        textAlign: 'center',
                                                        fontSize: '0.72rem',
                                                        fontWeight: 700,
                                                        lineHeight: 1.5,
                                                        color: '#b91c1c',
                                                        wordBreak: 'keep-all',
                                                    }}
                                                >
                                                    사진 불러오기에 실패했습니다.
                                                </div>
                                            ) : null}
                                        </div>
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', borderTop: '1px solid #334155' }}>
                                        {values.map((value, valueIndex) => (
                                            <div
                                                key={`${section.key}-${valueIndex}`}
                                                style={{
                                                    borderLeft: valueIndex === 0 ? 'none' : '1px solid #334155',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    fontSize: '0.8rem',
                                                    color: '#111827',
                                                    fontWeight: 500,
                                                }}
                                            >
                                                {value}
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px', fontSize: '0.75rem', color: '#1f2937' }}>
                                    {section.note}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

export default DailyLogFixedPreview;