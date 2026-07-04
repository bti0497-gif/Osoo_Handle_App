import React from 'react';
import ExcelCellMapper from '../widgets/ExcelCellMapper';
import MappingPreviewTable from '../widgets/MappingPreviewTable';

export default function FlowMappingPanel({
  flowConfig, setFlowConfig,
  medicineConfig, setMedicineConfig,
  kitConfig, setKitConfig,
  waterConfig, setWaterConfig,
  flowMapping, setFlowMapping,
  excelSheets, sampleRowData, alphabet,
  isMetadataLoading, isPreviewLoading,
  importedData, setShowDataModal,
  showAlert, showConfirm,
  handleSaveFlowMapping,
  getFlowRowsForExcelMapping,
}) {
        const isSludgeFlow = (name) => String(name || '').includes('슬러지');
        const isRequiredMappingComplete = () => (
            Boolean(flowConfig.dateCol)
            && activeFlows.every((flow) => (
                Boolean(flowMapping[`${flow.name}_raw`])
                && (isSludgeFlow(flow.name) || Boolean(flowMapping[`${flow.name}_flow`]))
            ))
        );
        const previewValue = (colKey) => {
            const value = sampleRowData[colKey];
            if (value === null || value === undefined || value === '') return '-- No Data --';
            if (typeof value === 'object') return '-- No Data --';
            return value;
        };
        // 1계열: 체크된 검침항목만. 2계열: 반송 1·2는 매핑 행을 항상 노출(적산·누계 각각)
        const activeFlows = getFlowRowsForExcelMapping();
        const syncRowRangeWhenSameSheet = (setter, nextRows) => {
            setter(prev => {
                if (prev.sheet && prev.sheet !== flowConfig.sheet) return prev;
                return { ...prev, ...nextRows };
            });
        };

        return (
            <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                <ExcelCellMapper
                    config={flowConfig}
                    setConfig={setFlowConfig}
                    excelSheets={excelSheets}
                    isMetadataLoading={isMetadataLoading}
                    emptySheetMessage="불러올 시트가 없습니다 (원본 파일을 먼저 업로드하세요)"
                    onStartRowChange={(start, end) => {
                        syncRowRangeWhenSameSheet(setMedicineConfig, { startRow: start, endRow: end });
                        syncRowRangeWhenSameSheet(setKitConfig, { startRow: start, endRow: end });
                        syncRowRangeWhenSameSheet(setWaterConfig, { startRow: start, endRow: end });
                    }}
                    onEndRowChange={(end) => {
                        syncRowRangeWhenSameSheet(setMedicineConfig, { endRow: end });
                        syncRowRangeWhenSameSheet(setKitConfig, { endRow: end });
                        syncRowRangeWhenSameSheet(setWaterConfig, { endRow: end });
                    }}
                />

                {/* 매칭 리스트 헤더 - 시트가 선택되었을 때만 표시 */}
                {!flowConfig.sheet ? (
                    <div style={{ padding: '3rem 0', textAlign: 'center', backgroundColor: '#fcfcfc', border: '1.5px dashed #e2e8f0', borderRadius: '12px' }}>
                        <span className="material-icons" style={{ fontSize: '32px', color: '#cbd5e1', marginBottom: '10px' }}>table_view</span>
                        <p style={{ fontSize: '0.8125rem', color: '#94a3b8', fontWeight: 600 }}>매칭을 시작하려면 먼저 엑셀 시트를 선택해주세요.</p>
                    </div>
                ) : (
                    <MappingPreviewTable
                        gridTemplateColumns="120px 50px 140px 1fr"
                        headers={['검침항목 이름', '', '엑셀 칼럼 선택', '시작행 데이터 프리뷰']}
                        isPreviewLoading={isPreviewLoading}
                    >

                        {/* 매칭 리스트 본문 */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
                            {/* 날짜 행 */}
                            <div style={{ display: 'grid', gridTemplateColumns: '120px 50px 140px 1fr', padding: '8px 12px', backgroundColor: '#f0f9ff', borderRadius: '8px', alignItems: 'center', border: '1px solid #bae6fd', marginBottom: '8px', columnGap: '8px' }}>
                                <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#334155', textAlign: 'center' }}>날짜 (Date)</span>
                                <span></span>
                                <select
                                    value={flowConfig.dateCol || 'A'}
                                    onChange={(e) => setFlowConfig({ ...flowConfig, dateCol: e.target.value })}
                                    style={{ width: '120px', height: '34px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700 }}
                                >
                                    <option value="">선택...</option>
                                    {alphabet.map(l => <option key={l} value={l}>{l}열</option>)}
                                </select>
                                <span style={{
                                    fontSize: '0.75rem', fontWeight: 700,
                                    color: flowConfig.dateCol ? '#059669' : '#94a3b8',
                                    backgroundColor: flowConfig.dateCol ? '#f0fdf4' : '#f1f5f9',
                                    padding: '6px 10px', borderRadius: '6px', width: 'fit-content', minWidth: '100px', textAlign: 'center'
                                }}>
                                    {flowConfig.dateCol ? previewValue(flowConfig.dateCol) : '-- No Data --'}
                                </span>
                            </div>

                            {/* 유량 그룹 */}
                            {activeFlows.map((flow, flowIdx) => {
                                const isSludge = isSludgeFlow(flow.name);
                                const groupRows = [
                                    { key: `${flow.name}_raw`, suffix: isSludge ? '반출량' : '적산', suffixColor: '#3b82f6' },
                                    { key: `${flow.name}_flow`, suffix: isSludge ? '누계(선택)' : '누계', suffixColor: '#f59e0b', optional: isSludge }
                                ];
                                return (
                                    <div key={flow.name} style={{ display: 'grid', gridTemplateColumns: '120px 50px 140px 1fr', columnGap: '8px', borderBottom: flowIdx < activeFlows.length - 1 ? '1px solid #e2e8f0' : 'none', paddingBottom: flowIdx < activeFlows.length - 1 ? '6px' : 0, marginBottom: flowIdx < activeFlows.length - 1 ? '6px' : 0, padding: '0 12px' }}>
                                        <div style={{ gridColumn: '1 / 2', gridRow: `1 / ${groupRows.length + 1}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <span style={{ fontSize: '0.8125rem', fontWeight: 800, color: '#1e293b' }}>{flow.name}</span>
                                        </div>
                                        {groupRows.map((row, rIdx) => {
                                            const colKey = flowMapping[row.key] || '';
                                            const hasCol = !!colKey;
                                            return (
                                                <React.Fragment key={row.key}>
                                                    <div style={{ gridColumn: '2 / 3', gridRow: rIdx + 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '5px 0' }}>
                                                        <span style={{ fontSize: '0.625rem', fontWeight: 800, color: 'white', backgroundColor: row.suffixColor, padding: '2px 8px', borderRadius: '4px', textAlign: 'center' }}>{row.suffix}</span>
                                                    </div>
                                                    <div style={{ gridColumn: '3 / 4', gridRow: rIdx + 1, display: 'flex', alignItems: 'center', padding: '5px 0' }}>
                                                        <select value={colKey} onChange={(e) => {
                                                            const selectedCol = e.target.value;
                                                            const newMapping = { ...flowMapping, [row.key]: selectedCol };

                                                            // 적산 선택 시 누계가 비어있거나 이미 값이 있어도 편의를 위해 덮어씌움.
                                                            // 단, 슬러지는 누계가 선택 항목이므로 원본에 없는 누계열을 임의로 잡지 않는다.
                                                            if (!isSludge && row.key.endsWith('_raw') && selectedCol) {
                                                                const flowKey = row.key.replace('_raw', '_flow');
                                                                const nextColIdx = alphabet.indexOf(selectedCol);
                                                                if (nextColIdx !== -1 && nextColIdx < alphabet.length - 1) {
                                                                    newMapping[flowKey] = alphabet[nextColIdx + 1];
                                                                }
                                                            }
                                                            setFlowMapping(newMapping);
                                                        }}
                                                            style={{ width: '120px', height: '34px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700 }}>
                                                            <option value="">선택...</option>
                                                            {alphabet.map(l => <option key={l} value={l}>{l}열</option>)}
                                                        </select>
                                                    </div>
                                                    <div style={{ gridColumn: '4 / 5', gridRow: rIdx + 1, display: 'flex', alignItems: 'center', padding: '5px 0' }}>
                                                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: hasCol ? '#059669' : '#94a3b8', backgroundColor: hasCol ? '#f0fdf4' : '#f1f5f9', padding: '6px 10px', borderRadius: '6px', minWidth: '100px', textAlign: 'center' }}>
                                                            {hasCol ? previewValue(colKey) : (row.optional ? '선택사항' : '-- No Data --')}
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

                {/* 저장 버튼 영역 */}
                {flowConfig.sheet && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem', gap: '0.75rem' }}>
                        <button
                            onClick={() => setShowDataModal(true)}
                            disabled={!importedData}
                            style={{
                                width: '160px', height: '50px',
                                backgroundColor: importedData ? '#f1f5f9' : '#f8fafc',
                                color: importedData ? '#1e293b' : '#cbd5e1',
                                border: '1.5px solid #cbd5e1', borderRadius: '12px',
                                fontSize: '0.9375rem', fontWeight: 900,
                                cursor: importedData ? 'pointer' : 'not-allowed',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
                            }}
                        >
                            <span className="material-icons">visibility</span>
                            저장된 데이타보기
                        </button>
                        <button
                            onClick={async () => {
                                const isAllMapped = isRequiredMappingComplete();
                                if (!isAllMapped) {
                                    await showAlert("날짜와 필수 검침항목의 콤보박스 선택이 완료되어야 저장할 수 있습니다.\n슬러지 누계는 원본에 없으면 비워두어도 됩니다.");
                                    return;
                                }
                                const confirmed = await showConfirm("기존 유량데이터를 데이터베이스에 저장하시겠습니까?\n(저장 시 기존 데이터가 덮어씌워 보완될 수 있습니다.)");
                                if (confirmed) {
                                    handleSaveFlowMapping();
                                }
                            }}
                            disabled={!isRequiredMappingComplete()}
                            style={{
                                width: '240px',
                                height: '50px',
                                backgroundColor: isRequiredMappingComplete() ? '#1e293b' : '#cbd5e1',
                                color: 'white',
                                border: 'none',
                                borderRadius: '12px',
                                fontSize: '0.9375rem',
                                fontWeight: 900,
                                cursor: isRequiredMappingComplete() ? 'pointer' : 'not-allowed',
                                transition: 'all 0.2s',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '8px'
                            }}
                        >
                            <span className="material-icons">storage</span>
                            기존 유량데이터 저장하기
                        </button>
                    </div>
                )}
            </div>
        );
}
