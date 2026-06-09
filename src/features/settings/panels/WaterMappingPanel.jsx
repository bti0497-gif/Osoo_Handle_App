import React from 'react';
import ExcelCellMapper from '../widgets/ExcelCellMapper';
import MappingPreviewTable from '../widgets/MappingPreviewTable';

export default function WaterMappingPanel({
  locationItems,
  waterConfig,
  setWaterConfig,
  waterMapping,
  setWaterMapping,
  excelSheets,
  sampleRowData,
  alphabet,
  isMetadataLoading,
  isPreviewLoading,
  siteInfo,
  showAlert,
  showConfirm,
  handleSaveWaterMapping,
}) {
        const activeLocations = locationItems.filter(i => i.checked);
        const isMbr = String(siteInfo?.method || '').trim().toUpperCase() === 'MBR';
        const waterBaseParams = [
            { id: 'nh3_n', name: '암모니아성질소' },
            { id: 'no3_n', name: '질산성질소' },
            { id: 'po4_p', name: '인산염인' },
            { id: 'alkalinity', name: '알칼리도' }
        ];

        // PO4-P는 공법별 고정 3개 장소로 매핑한다.
        const po4pLocations = isMbr
            ? ['유량조정조', '포기조', '방류조']
            : ['유량조정조', '침전조', '방류조'];
        const getLocationModel = (name) => locationItems.find((loc) => loc.name === name) || { name };

        // Determine which mapping keys are required
        let requiredKeys = [];
        waterBaseParams.forEach(param => {
            const paramLocations = param.id === 'po4_p'
                ? po4pLocations.map(getLocationModel)
                : activeLocations;
            paramLocations.forEach(loc => {
                // For MBR, '침전조' is already filtered out of activeLocations in SettingsView if handled correctly, but we ensure it here too via basicSettings logic
                requiredKeys.push(`${param.name}_${loc.name}`);
            });
        });

        const isAllMapped = !!waterConfig.dateCol && requiredKeys.every(k => !!waterMapping[k]);

        return (
            <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                <ExcelCellMapper
                    config={waterConfig}
                    setConfig={setWaterConfig}
                    excelSheets={excelSheets}
                    isMetadataLoading={isMetadataLoading}
                    startLabel="시작 행"
                    endLabel="종료 행"
                />

                {!waterConfig.sheet ? (
                    <div style={{ padding: '3rem 0', textAlign: 'center', backgroundColor: '#fcfcfc', border: '1.5px dashed #e2e8f0', borderRadius: '12px' }}>
                        <span className="material-icons" style={{ fontSize: '32px', color: '#cbd5e1', marginBottom: '10px' }}>water_drop</span>
                        <p style={{ fontSize: '0.8125rem', color: '#94a3b8', fontWeight: 600 }}>수질 설정을 시작하려면 먼저 엑셀 시트를 선택해주세요.</p>
                    </div>
                ) : (
                    <MappingPreviewTable
                        gridTemplateColumns="120px 100px 140px 1fr"
                        headers={['수질 항목', { label: '분석 장소', align: 'center' }, '엑셀 칼럼 선택', '데이터 프리뷰']}
                        isPreviewLoading={isPreviewLoading}
                        loadingText="데이터 불러오는 중..."
                    >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
                            {/* 날짜 행 */}
                            <div style={{ display: 'grid', gridTemplateColumns: '120px 100px 140px 1fr', padding: '8px 12px', backgroundColor: '#f0f9ff', borderRadius: '8px', alignItems: 'center', border: '1px solid #bae6fd', marginBottom: '8px', columnGap: '8px' }}>
                                <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#334155' }}>날짜 (Date)</span>
                                <span></span>
                                <select value={waterConfig.dateCol || 'A'} onChange={(e) => setWaterConfig({ ...waterConfig, dateCol: e.target.value })}
                                    style={{ width: '120px', height: '34px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700 }}>
                                    <option value="">선택...</option>
                                    {alphabet.map(l => <option key={l} value={l}>{l}열</option>)}
                                </select>
                                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: waterConfig.dateCol ? '#059669' : '#94a3b8', backgroundColor: waterConfig.dateCol ? '#f0fdf4' : '#f1f5f9', padding: '6px 10px', borderRadius: '6px', width: 'fit-content', minWidth: '100px', textAlign: 'center' }}>
                                    {(waterConfig.dateCol && sampleRowData[waterConfig.dateCol]) || '-- No Data --'}
                                </span>
                            </div>

                            {/* Base Parameters (Location specific) */}
                            {waterBaseParams.map((param, pIdx) => {
                                const paramLocations = param.id === 'po4_p'
                                    ? po4pLocations.map(getLocationModel)
                                    : activeLocations;

                                return (
                                    <div key={param.id} style={{ display: 'grid', gridTemplateColumns: '120px 100px 140px 1fr', columnGap: '8px', borderBottom: pIdx < waterBaseParams.length - 1 ? '1px solid #e2e8f0' : 'none', paddingBottom: pIdx < waterBaseParams.length - 1 ? '6px' : 0, marginBottom: pIdx < waterBaseParams.length - 1 ? '6px' : 0, padding: '0 12px' }}>
                                        <div style={{ gridColumn: '1 / 2', gridRow: `1 / ${paramLocations.length + 1}`, display: 'flex', alignItems: 'center' }}>
                                            <span style={{ fontSize: '0.8125rem', fontWeight: 800, color: '#1e293b' }}>{param.name}</span>
                                        </div>
                                        {paramLocations.map((loc, lIdx) => {
                                            const mapKey = `${param.name}_${loc.name}`;
                                            const colKey = waterMapping[mapKey] || '';
                                            const hasCol = !!colKey;
                                            return (
                                                <React.Fragment key={mapKey}>
                                                    <div style={{ gridColumn: '2 / 3', gridRow: lIdx + 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '5px 0' }}>
                                                        <span style={{ fontSize: '0.625rem', fontWeight: 800, color: '#64748b', backgroundColor: '#f1f5f9', padding: '2px 8px', borderRadius: '4px', textAlign: 'center', border: '1px solid #e2e8f0' }}>{loc.name}</span>
                                                    </div>
                                                    <div style={{ gridColumn: '3 / 4', gridRow: lIdx + 1, display: 'flex', alignItems: 'center', padding: '5px 0' }}>
                                                        <select value={colKey} onChange={(e) => setWaterMapping({ ...waterMapping, [mapKey]: e.target.value })}
                                                            style={{ width: '120px', height: '34px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700 }}>
                                                            <option value="">선택...</option>
                                                            {alphabet.map(l => <option key={l} value={l}>{l}열</option>)}
                                                        </select>
                                                    </div>
                                                    <div style={{ gridColumn: '4 / 5', gridRow: lIdx + 1, display: 'flex', alignItems: 'center', padding: '5px 0' }}>
                                                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: hasCol ? '#059669' : '#94a3b8', backgroundColor: hasCol ? '#f0fdf4' : '#f1f5f9', padding: '6px 10px', borderRadius: '6px', minWidth: '100px', textAlign: 'center' }}>
                                                            {(hasCol && sampleRowData[colKey]) || '-- No Data --'}
                                                        </span>
                                                    </div>
                                                </React.Fragment>
                                            );
                                        })}
                                    </div>
                                );
                            })}
                        </div>
                    </MappingPreviewTable>
                )}

                {waterConfig.sheet && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
                        <button
                            onClick={async () => {
                                if (!isAllMapped) {
                                    await showAlert("모든 항목의 콤보박스 선택이 완료되어야 저장할 수 있습니다.");
                                    return;
                                }
                                const confirmed = await showConfirm("수질 분석 데이터를 저장하시겠습니까?");
                                if (confirmed) handleSaveWaterMapping();
                            }}
                            disabled={!isAllMapped}
                            style={{
                                width: '240px', height: '50px',
                                backgroundColor: isAllMapped ? '#1e293b' : '#cbd5e1',
                                color: 'white', border: 'none', borderRadius: '12px', fontSize: '0.9375rem', fontWeight: 900,
                                cursor: isAllMapped ? 'pointer' : 'not-allowed',
                                transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
                            }}
                        >
                            <span className="material-icons">water_drop</span>
                            수질 데이터 저장하기
                        </button>
                    </div>
                )}
            </div>
        );
    
}
