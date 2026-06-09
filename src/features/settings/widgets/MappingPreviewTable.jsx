import React from 'react';

export default function MappingPreviewTable({
    gridTemplateColumns,
    headers,
    isPreviewLoading,
    loadingText = '시작행 데이터 불러오는 중...',
    children,
}) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0', position: 'relative' }}>
            {isPreviewLoading && (
                <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(248,250,252,0.85)', borderRadius: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 5, gap: '10px' }}>
                    <div style={{ width: '28px', height: '28px', border: '3px solid #e2e8f0', borderTopColor: '#1e293b', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b' }}>{loadingText}</span>
                </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns, padding: '0 12px', borderBottom: '2px solid #1e293b', paddingBottom: '8px', marginBottom: '4px', columnGap: '8px' }}>
                {headers.map((header, index) => (
                    <span
                        key={`${header || 'empty'}-${index}`}
                        style={{
                            fontSize: '0.75rem',
                            fontWeight: 900,
                            color: '#1e293b',
                            textAlign: header?.align || 'left'
                        }}
                    >
                        {header?.label ?? header}
                    </span>
                ))}
            </div>
            {children}
        </div>
    );
}
