import React from 'react';

export default function ExcelCellMapper({
    config,
    setConfig,
    excelSheets,
    isMetadataLoading,
    startLabel = '데이터 시작 행',
    endLabel = '데이터 종료 행',
    emptySheetMessage = '불러올 시트가 없습니다',
    onStartRowChange,
    onEndRowChange,
}) {
    const updateStartRow = (value) => {
        const start = parseInt(value, 10) || 1;
        const end = start + 30;
        setConfig({ ...config, startRow: start, endRow: end });
        onStartRowChange?.(start, end);
    };

    const updateEndRow = (value) => {
        const end = parseInt(value, 10) || 31;
        setConfig({ ...config, endRow: end });
        onEndRowChange?.(end);
    };

    return (
        <div style={{
            display: 'grid',
            gridTemplateColumns: '1.5fr 1fr 1fr',
            gap: '1.5rem',
            backgroundColor: '#f8fafc',
            padding: '1.5rem',
            borderRadius: '12px',
            border: '1px solid #e2e8f0'
        }}>
            <div>
                <label style={{ display: 'block', fontSize: '0.625rem', fontWeight: 900, color: '#64748b', marginBottom: '6px' }}>대상 시트 선택</label>
                <select
                    value={config.sheet}
                    onChange={(e) => setConfig({ ...config, sheet: e.target.value })}
                    disabled={isMetadataLoading}
                    style={{ width: '100%', height: '40px', border: '1.5px solid #cbd5e1', borderRadius: '8px', padding: '0 12px', fontSize: '0.8125rem', fontWeight: 700, opacity: isMetadataLoading ? 0.5 : 1 }}
                >
                    <option value="">{isMetadataLoading ? '시트 목록 불러오는 중...' : '시트를 선택하세요...'}</option>
                    {excelSheets.length > 0 ? (
                        excelSheets.map((sheet) => <option key={sheet} value={sheet}>{sheet}</option>)
                    ) : (
                        !isMetadataLoading && <option disabled>{emptySheetMessage}</option>
                    )}
                </select>
            </div>
            <div>
                <label style={{ display: 'block', fontSize: '0.625rem', fontWeight: 900, color: '#64748b', marginBottom: '6px' }}>{startLabel}</label>
                <input
                    type="number"
                    value={config.startRow}
                    onChange={(e) => updateStartRow(e.target.value)}
                    style={{ width: '100%', height: '40px', border: '1.5px solid #cbd5e1', borderRadius: '8px', padding: '0 12px', fontSize: '0.8125rem', fontWeight: 700 }}
                />
            </div>
            <div>
                <label style={{ display: 'block', fontSize: '0.625rem', fontWeight: 900, color: '#64748b', marginBottom: '6px' }}>{endLabel}</label>
                <input
                    type="number"
                    value={config.endRow}
                    onChange={(e) => updateEndRow(e.target.value)}
                    style={{ width: '100%', height: '40px', border: '1.5px solid #cbd5e1', borderRadius: '8px', padding: '0 12px', fontSize: '0.8125rem', fontWeight: 700 }}
                />
            </div>
        </div>
    );
}
