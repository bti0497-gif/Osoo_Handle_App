import React from 'react';
import { useSettingsViewModel } from './useSettingsViewModel';
import { useDialog } from '../../components/common/DialogProvider';

const SettingsView = ({ currentUser }) => {
    const { showAlert, showConfirm } = useDialog();
    const vm = useSettingsViewModel(currentUser, { showAlert, showConfirm });
    const {
        activeTab, setActiveTab, isLoading,
        siteInfo, setSiteInfo, handleSeriesChange,
        flowItems, medicineItems, waterItems, kitItems, locationItems,
        newFlowItem, setNewFlowItem, newMedicineItem, setNewMedicineItem, newLocationItem, setNewLocationItem,
        addItem, toggleItem,
        excelFileName, templateFileNames,
        handleExcelFileUpload, handleTemplateFileChange,
        flowConfig, setFlowConfig, flowMapping, setFlowMapping,
        medicineConfig, setMedicineConfig, medicineMapping, setMedicineMapping,
        kitConfig, setKitConfig, kitMapping, setKitMapping,
        waterConfig, setWaterConfig, waterMapping, setWaterMapping,
        webAppCredentials, qntechImportSettings, passwordVisibility, urlEditability,
        excelSheets, sampleRowData,
        excelStatus, isMetadataLoading, isPreviewLoading, isUploading,
        importProgress, setImportProgress, importedData, showDataModal, setShowDataModal,
        handleSaveFlowMapping, handleSaveMedicineMapping, handleSaveKitMapping, handleSaveWaterMapping,
        updateWebAppCredentialField, togglePasswordVisibility, toggleUrlEditability, handleSaveWebAppCredentials,
        updateQntechImportSettingField, updateQntechSampleMapping, addQntechSampleMapping, removeQntechSampleMapping, handleSaveQntechImportSettings,
        handleApply,
        alphabet,
        // Log Mapping
        LOG_TYPES, selectedLogType, setSelectedLogType,
        logMappings, dbColumns, isLogMappingLoading,
        addLogMapping, removeLogMapping, updateLogMapping, toggleMappingType, handleSaveLogMappings,
        // Gemini API
        geminiApiKey, setGeminiApiKey, geminiKeyVisible, setGeminiKeyVisible, handleSaveGeminiApiKey,
        // Flow Option
        flowOption, setFlowOption, handleSaveFlowOption,
        // Sludge Export Ledger Settings
        sludgeExportSettings, setSludgeExportSettings,
        isSavingSludgeExportSettings, handleSaveSludgeExportSettings,
        // 약품 기본 입고량 모달
        showDefaultAmountModal, setShowDefaultAmountModal,
        defaultAmountItems, setDefaultAmountItems,
        isSavingDefaultAmounts,
        handleOpenDefaultAmountModal, handleSaveDefaultAmounts,
        // 키트 기본 입고량 모달
        showKitDefaultModal, setShowKitDefaultModal,
        kitDefaultItems, setKitDefaultItems,
        isSavingKitDefaults,
        handleOpenKitDefaultModal, handleSaveKitDefaults,
    } = vm;

    const renderFlowSettings = () => {
        // 활성화된 유량 항목들 (기본설정에서 체크된 항목들만)
        const activeFlows = flowItems.filter(i => i.checked);
        const rows = [
            { name: '날짜 (Date)', isDate: true, defaultCol: 'A' },
            ...activeFlows.map(f => ({ name: f.name, isDate: false, defaultCol: '' }))
        ];

        return (
            <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                {/* 상단: 시트 및 행 범위 설정 */}
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
                            value={flowConfig.sheet}
                            onChange={(e) => setFlowConfig({ ...flowConfig, sheet: e.target.value })}
                            disabled={isMetadataLoading}
                            style={{ width: '100%', height: '40px', border: '1.5px solid #cbd5e1', borderRadius: '8px', padding: '0 12px', fontSize: '0.8125rem', fontWeight: 700, opacity: isMetadataLoading ? 0.5 : 1 }}
                        >
                            <option value="">{isMetadataLoading ? '시트 목록 불러오는 중...' : '시트를 선택하세요...'}</option>
                            {excelSheets.length > 0 ? (
                                excelSheets.map(s => <option key={s} value={s}>{s}</option>)
                            ) : (
                                !isMetadataLoading && <option disabled>불러올 시트가 없습니다 (원본 파일을 먼저 업로드하세요)</option>
                            )}
                        </select>
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.625rem', fontWeight: 900, color: '#64748b', marginBottom: '6px' }}>데이터 시작 행</label>
                        <input
                            type="number"
                            value={flowConfig.startRow}
                            onChange={(e) => {
                                const start = parseInt(e.target.value) || 1;
                                const end = start + 30;
                                setFlowConfig({ ...flowConfig, startRow: start, endRow: end });
                                setMedicineConfig(prev => ({ ...prev, startRow: start, endRow: end }));
                                setKitConfig(prev => ({ ...prev, startRow: start, endRow: end }));
                                setWaterConfig(prev => ({ ...prev, startRow: start, endRow: end }));
                            }}
                            style={{ width: '100%', height: '40px', border: '1.5px solid #cbd5e1', borderRadius: '8px', padding: '0 12px', fontSize: '0.8125rem', fontWeight: 700 }}
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.625rem', fontWeight: 900, color: '#64748b', marginBottom: '6px' }}>데이터 종료 행</label>
                        <input
                            type="number"
                            value={flowConfig.endRow}
                            onChange={(e) => {
                                const end = parseInt(e.target.value) || 31;
                                setFlowConfig({ ...flowConfig, endRow: end });
                                setMedicineConfig(prev => ({ ...prev, endRow: end }));
                                setKitConfig(prev => ({ ...prev, endRow: end }));
                                setWaterConfig(prev => ({ ...prev, endRow: end }));
                            }}
                            style={{ width: '100%', height: '40px', border: '1.5px solid #cbd5e1', borderRadius: '8px', padding: '0 12px', fontSize: '0.8125rem', fontWeight: 700 }}
                        />
                    </div>
                </div>

                {/* 매칭 리스트 헤더 - 시트가 선택되었을 때만 표시 */}
                {!flowConfig.sheet ? (
                    <div style={{ padding: '3rem 0', textAlign: 'center', backgroundColor: '#fcfcfc', border: '1.5px dashed #e2e8f0', borderRadius: '12px' }}>
                        <span className="material-icons" style={{ fontSize: '32px', color: '#cbd5e1', marginBottom: '10px' }}>table_view</span>
                        <p style={{ fontSize: '0.8125rem', color: '#94a3b8', fontWeight: 600 }}>매칭을 시작하려면 먼저 엑셀 시트를 선택해주세요.</p>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0', position: 'relative' }}>
                        {/* 프리뷰 로딩 오버레이 */}
                        {isPreviewLoading && (
                            <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(248,250,252,0.85)', borderRadius: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 5, gap: '10px' }}>
                                <div style={{ width: '28px', height: '28px', border: '3px solid #e2e8f0', borderTopColor: '#1e293b', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b' }}>시작행 데이터 불러오는 중...</span>
                            </div>
                        )}
                        <div style={{ display: 'grid', gridTemplateColumns: '120px 50px 140px 1fr', padding: '0 12px', borderBottom: '2px solid #1e293b', paddingBottom: '8px', marginBottom: '4px', columnGap: '8px' }}>
                            <span style={{ fontSize: '0.75rem', fontWeight: 900, color: '#1e293b' }}>검침항목 이름</span>
                            <span></span>
                            <span style={{ fontSize: '0.75rem', fontWeight: 900, color: '#1e293b' }}>엑셀 칼럼 선택</span>
                            <span style={{ fontSize: '0.75rem', fontWeight: 900, color: '#1e293b' }}>시작행 데이터 프리뷰</span>
                        </div>

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
                                    {(flowConfig.dateCol && sampleRowData[flowConfig.dateCol]) || '-- No Data --'}
                                </span>
                            </div>

                            {/* 유량 그룹 */}
                            {activeFlows.map((flow, flowIdx) => {
                                const groupRows = [
                                    { key: `${flow.name}_raw`, suffix: '적산', suffixColor: '#3b82f6' },
                                    { key: `${flow.name}_flow`, suffix: '누계', suffixColor: '#f59e0b' }
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

                                                            // 적산 선택 시 누계가 비어있거나 이미 값이 있어도 편의를 위해 덮어씌움 (사용자 요청: 자동으로 다음 열 매핑)
                                                            if (row.key.endsWith('_raw') && selectedCol) {
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
                    </div>
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
                                const isAllMapped = activeFlows.every(f => flowMapping[`${f.name}_raw`] && flowMapping[`${f.name}_flow`]) && flowConfig.dateCol;
                                if (!isAllMapped) {
                                    await showAlert("모든 항목의 콤보박스 선택이 완료되어야 저장할 수 있습니다.");
                                    return;
                                }
                                const confirmed = await showConfirm("기존 유량데이터를 데이터베이스에 저장하시겠습니까?\n(저장 시 기존 데이터가 덮어씌워 보완될 수 있습니다.)");
                                if (confirmed) {
                                    handleSaveFlowMapping();
                                }
                            }}
                            disabled={!(activeFlows.every(f => flowMapping[`${f.name}_raw`] && flowMapping[`${f.name}_flow`]) && flowConfig.dateCol)}
                            style={{
                                width: '240px',
                                height: '50px',
                                backgroundColor: (activeFlows.every(f => flowMapping[`${f.name}_raw`] && flowMapping[`${f.name}_flow`]) && flowConfig.dateCol) ? '#1e293b' : '#cbd5e1',
                                color: 'white',
                                border: 'none',
                                borderRadius: '12px',
                                fontSize: '0.9375rem',
                                fontWeight: 900,
                                cursor: (activeFlows.every(f => flowMapping[`${f.name}_raw`] && flowMapping[`${f.name}_flow`]) && flowConfig.dateCol) ? 'pointer' : 'not-allowed',
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
    };

    // handleSaveFlowMapping, handleSaveKitMapping → moved to useSettingsViewModel

    const renderImportProgress = () => {
        if (!importProgress.isVisible) return null;
        const progressPercent = Math.min(100, Math.round((importProgress.current / importProgress.total) * 100)) || 0;

        return (
            <div style={{
                position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
            }}>
                <div style={{
                    backgroundColor: 'white', padding: '2rem', borderRadius: '16px', width: '300px',
                    boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', textAlign: 'center'
                }}>
                    <h3 style={{ fontSize: '1rem', fontWeight: 900, marginBottom: '1rem' }}>
                        {importProgress.status === 'completed' ? '저장 완료!' :
                            importProgress.status === 'error' ? '오류 발생' : '데이터 저장 중...'}
                    </h3>
                    <div style={{ width: '100%', height: '8px', backgroundColor: '#e2e8f0', borderRadius: '4px', overflow: 'hidden', marginBottom: '10px' }}>
                        <div style={{
                            width: `${progressPercent}%`, height: '100%', backgroundColor: '#1e293b',
                            transition: 'width 0.3s ease-out'
                        }} />
                    </div>
                    <p style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b' }}>
                        {importProgress.status === 'completed' ? `${importProgress.total}개의 행을 모두 저장했습니다.` :
                            importProgress.status === 'error' ? importProgress.result :
                                `총 ${importProgress.total}행 중 ${importProgress.current}행 처리 중 (${progressPercent}%)`}
                    </p>
                    {(importProgress.status === 'completed' || importProgress.status === 'error') && (
                        <button
                            onClick={() => setImportProgress(prev => ({ ...prev, isVisible: false }))}
                            style={{
                                marginTop: '1.5rem', width: '100%', height: '40px', backgroundColor: '#1e293b',
                                color: 'white', border: 'none', borderRadius: '8px', fontWeight: 900, cursor: 'pointer'
                            }}
                        >
                            닫기
                        </button>
                    )}
                </div>
            </div>
        );
    };

    const renderDataModal = () => {
        if (!showDataModal || !importedData) return null;

        return (
            <div style={{
                position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
            }}>
                <div style={{
                    backgroundColor: 'white', padding: '1.5rem', borderRadius: '16px', width: '600px', maxHeight: '80vh',
                    display: 'flex', flexDirection: 'column', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <h3 style={{ fontSize: '1rem', fontWeight: 900 }}>저장된 데이터 확인</h3>
                        <button onClick={() => setShowDataModal(false)} style={{ border: 'none', background: 'none', cursor: 'pointer' }}>
                            <span className="material-icons">close</span>
                        </button>
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                            <thead style={{ backgroundColor: '#f8fafc', position: 'sticky', top: 0 }}>
                                <tr>
                                    <th style={{ padding: '10px', borderBottom: '1px solid #e2e8f0', textAlign: 'left' }}>날짜</th>
                                    {Object.keys(importedData[0] || {}).filter(k => k !== 'date').map(key => (
                                        <th key={key} style={{ padding: '10px', borderBottom: '1px solid #e2e8f0', textAlign: 'right' }}>{key}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {importedData.map((row, idx) => (
                                    <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                        <td style={{ padding: '10px', fontWeight: 700 }}>{row.date}</td>
                                        {Object.entries(row).filter(([k]) => k !== 'date').map(([k, v]) => (
                                            <td key={k} style={{ padding: '10px', textAlign: 'right' }}>{v}</td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <button
                        onClick={() => setShowDataModal(false)}
                        style={{
                            marginTop: '1rem', width: '100%', height: '40px', backgroundColor: '#1e293b',
                            color: 'white', border: 'none', borderRadius: '8px', fontWeight: 900, cursor: 'pointer'
                        }}
                    >
                        확인 완료
                    </button>
                </div>
            </div>
        );
    };

    // handleSaveMedicineMapping → moved to useSettingsViewModel

    const renderMedicineSettings = () => {
        const activeMedicines = medicineItems.filter(i => i.checked);
        const SUFFIXES = ['purchase', 'usage', 'inventory'];
        const SUFFIX_LABELS = { purchase: '구매', usage: '사용', inventory: '재고' };
        const SUFFIX_COLORS = { purchase: '#3b82f6', usage: '#f59e0b', inventory: '#8b5cf6' };

        const rows = [
            { key: '__date__', label: '날짜 (Date)', isDate: true },
            ...activeMedicines.flatMap(m => SUFFIXES.map(s => ({
                key: `${m.name}_${s}`,
                label: `${m.name}`,
                suffix: SUFFIX_LABELS[s],
                suffixColor: SUFFIX_COLORS[s],
                medicineName: m.name,
                isDate: false,
                isFirstOfGroup: s === 'purchase'
            })))
        ];

        const allMapped = rows.every(r => {
            if (r.isDate) return !!medicineConfig.dateCol;
            return !!medicineMapping[r.key];
        });

        return (
            <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                <div style={{
                    display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr', gap: '1.5rem',
                    backgroundColor: '#f8fafc', padding: '1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0'
                }}>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.625rem', fontWeight: 900, color: '#64748b', marginBottom: '6px' }}>대상 시트 선택</label>
                        <select
                            value={medicineConfig.sheet}
                            onChange={(e) => setMedicineConfig({ ...medicineConfig, sheet: e.target.value })}
                            disabled={isMetadataLoading}
                            style={{ width: '100%', height: '40px', border: '1.5px solid #cbd5e1', borderRadius: '8px', padding: '0 12px', fontSize: '0.8125rem', fontWeight: 700, opacity: isMetadataLoading ? 0.5 : 1 }}
                        >
                            <option value="">{isMetadataLoading ? '시트 목록 불러오는 중...' : '시트를 선택하세요...'}</option>
                            {excelSheets.length > 0 ? (
                                excelSheets.map(s => <option key={s} value={s}>{s}</option>)
                            ) : (
                                !isMetadataLoading && <option disabled>불러올 시트가 없습니다</option>
                            )}
                        </select>
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.625rem', fontWeight: 900, color: '#64748b', marginBottom: '6px' }}>데이터 시작 행</label>
                        <input type="number" value={medicineConfig.startRow}
                            onChange={(e) => { const s = parseInt(e.target.value) || 1; setMedicineConfig({ ...medicineConfig, startRow: s, endRow: s + 30 }); }}
                            style={{ width: '100%', height: '40px', border: '1.5px solid #cbd5e1', borderRadius: '8px', padding: '0 12px', fontSize: '0.8125rem', fontWeight: 700 }}
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.625rem', fontWeight: 900, color: '#64748b', marginBottom: '6px' }}>데이터 종료 행</label>
                        <input type="number" value={medicineConfig.endRow}
                            onChange={(e) => setMedicineConfig({ ...medicineConfig, endRow: parseInt(e.target.value) || 31 })}
                            style={{ width: '100%', height: '40px', border: '1.5px solid #cbd5e1', borderRadius: '8px', padding: '0 12px', fontSize: '0.8125rem', fontWeight: 700 }}
                        />
                    </div>
                </div>

                {!medicineConfig.sheet ? (
                    <div style={{ padding: '3rem 0', textAlign: 'center', backgroundColor: '#fcfcfc', border: '1.5px dashed #e2e8f0', borderRadius: '12px' }}>
                        <span className="material-icons" style={{ fontSize: '32px', color: '#cbd5e1', marginBottom: '10px' }}>medication</span>
                        <p style={{ fontSize: '0.8125rem', color: '#94a3b8', fontWeight: 600 }}>약품 설정을 시작하려면 먼저 엑셀 시트를 선택해주세요.</p>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0', position: 'relative' }}>
                        {isPreviewLoading && (
                            <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(248,250,252,0.85)', borderRadius: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 5, gap: '10px' }}>
                                <div style={{ width: '28px', height: '28px', border: '3px solid #e2e8f0', borderTopColor: '#1e293b', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b' }}>시작행 데이터 불러오는 중...</span>
                            </div>
                        )}
                        <div style={{ display: 'grid', gridTemplateColumns: '120px 50px 140px 1fr', padding: '0 12px', borderBottom: '2px solid #1e293b', paddingBottom: '8px', marginBottom: '4px', columnGap: '8px' }}>
                            <span style={{ fontSize: '0.75rem', fontWeight: 900, color: '#1e293b' }}>약품 항목</span>
                            <span></span>
                            <span style={{ fontSize: '0.75rem', fontWeight: 900, color: '#1e293b' }}>엑셀칼럼 선택</span>
                            <span style={{ fontSize: '0.75rem', fontWeight: 900, color: '#1e293b' }}>프리뷰</span>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
                            {/* 날짜 행 */}
                            {(() => {
                                const dateCol = medicineConfig.dateCol;
                                return (
                                    <div style={{ display: 'grid', gridTemplateColumns: '120px 50px 140px 1fr', padding: '8px 12px', backgroundColor: '#f0f9ff', borderRadius: '8px', alignItems: 'center', border: '1px solid #bae6fd', marginBottom: '8px', columnGap: '8px' }}>
                                        <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#334155', textAlign: 'center' }}>날짜 (Date)</span>
                                        <span></span>
                                        <select value={dateCol || 'A'} onChange={(e) => setMedicineConfig({ ...medicineConfig, dateCol: e.target.value })}
                                            style={{ width: '120px', height: '34px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700 }}>
                                            <option value="">선택...</option>
                                            {alphabet.map(l => <option key={l} value={l}>{l}열</option>)}
                                        </select>
                                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: dateCol ? '#059669' : '#94a3b8', backgroundColor: dateCol ? '#f0fdf4' : '#f1f5f9', padding: '6px 10px', borderRadius: '6px', width: 'fit-content', minWidth: '100px', textAlign: 'center' }}>
                                            {(dateCol && sampleRowData[dateCol]) || '-- No Data --'}
                                        </span>
                                    </div>
                                );
                            })()}
                            {/* 약품 그룹 */}
                            {activeMedicines.map((med, medIdx) => {
                                const groupRows = rows.filter(r => !r.isDate && r.medicineName === med.name);
                                return (
                                    <div key={med.name} style={{ display: 'grid', gridTemplateColumns: '120px 50px 140px 1fr', columnGap: '8px', borderBottom: medIdx < activeMedicines.length - 1 ? '1px solid #e2e8f0' : 'none', paddingBottom: medIdx < activeMedicines.length - 1 ? '6px' : 0, marginBottom: medIdx < activeMedicines.length - 1 ? '6px' : 0, padding: '0 12px' }}>
                                        <div style={{ gridColumn: '1 / 2', gridRow: `1 / ${groupRows.length + 1}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <span style={{ fontSize: '0.8125rem', fontWeight: 800, color: '#1e293b' }}>{med.name}</span>
                                        </div>
                                        {groupRows.map((row, rIdx) => {
                                            const colKey = medicineMapping[row.key] || '';
                                            const hasCol = !!colKey;
                                            return (
                                                <React.Fragment key={row.key}>
                                                    <div style={{ gridColumn: '2 / 3', gridRow: rIdx + 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '5px 0' }}>
                                                        <span style={{ fontSize: '0.625rem', fontWeight: 800, color: 'white', backgroundColor: row.suffixColor, padding: '2px 8px', borderRadius: '4px', textAlign: 'center' }}>{row.suffix}</span>
                                                    </div>
                                                    <div style={{ gridColumn: '3 / 4', gridRow: rIdx + 1, display: 'flex', alignItems: 'center', padding: '5px 0' }}>
                                                        <select value={colKey} onChange={(e) => setMedicineMapping({ ...medicineMapping, [row.key]: e.target.value })}
                                                            style={{ width: '120px', height: '34px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700 }}>
                                                            <option value="">선택...</option>
                                                            {alphabet.map(l => <option key={l} value={l}>{l}열</option>)}
                                                        </select>
                                                    </div>
                                                    <div style={{ gridColumn: '4 / 5', gridRow: rIdx + 1, display: 'flex', alignItems: 'center', padding: '5px 0' }}>
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
                    </div>
                )}

                {medicineConfig.sheet && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem', gap: '0.75rem' }}>
                        <button onClick={() => setShowDataModal(true)} disabled={!importedData}
                            style={{
                                width: '160px', height: '50px', backgroundColor: importedData ? '#f1f5f9' : '#f8fafc', color: importedData ? '#1e293b' : '#cbd5e1',
                                border: '1.5px solid #cbd5e1', borderRadius: '12px', fontSize: '0.9375rem', fontWeight: 900,
                                cursor: importedData ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
                            }}>
                            <span className="material-icons">visibility</span>저장된 데이타보기
                        </button>
                        <button
                            onClick={async () => {
                                if (!allMapped) {
                                    await showAlert("모든 약품 항목의 칼럼 선택이 완료되어야 저장할 수 있습니다.");
                                    return;
                                }
                                const confirmed = await showConfirm("기존 약품 데이터를 데이터베이스에 저장하시겠습니까?");
                                if (confirmed) handleSaveMedicineMapping();
                            }}
                            disabled={!allMapped}
                            style={{
                                width: '240px', height: '50px', backgroundColor: allMapped ? '#1e293b' : '#cbd5e1', color: 'white',
                                border: 'none', borderRadius: '12px', fontSize: '0.9375rem', fontWeight: 900,
                                cursor: allMapped ? 'pointer' : 'not-allowed', transition: 'all 0.2s',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
                            }}>
                            <span className="material-icons">medication</span>약품 데이터 저장하기
                        </button>
                    </div>
                )}
            </div>
        );
    };

    const renderKitSettings = () => {
        const activeKits = kitItems.filter(i => i.checked);
        const SUFFIXES = ['purchase', 'usage', 'inventory'];
        const SUFFIX_LABELS = { purchase: '구매', usage: '사용', inventory: '재고' };
        const SUFFIX_COLORS = { purchase: '#3b82f6', usage: '#f59e0b', inventory: '#8b5cf6' };

        const rows = [
            { key: '__date__', label: '날짜 (Date)', isDate: true },
            ...activeKits.flatMap(k => SUFFIXES.map(s => ({
                key: `${k.name}_${s}`,
                label: `${k.name}`,
                suffix: SUFFIX_LABELS[s],
                suffixColor: SUFFIX_COLORS[s],
                kitName: k.name,
                isDate: false,
                isFirstOfGroup: s === 'purchase'
            })))
        ];

        const allMapped = rows.every(r => {
            if (r.isDate) return !!kitConfig.dateCol;
            return !!kitMapping[r.key];
        });

        return (
            <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                <div style={{
                    display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr', gap: '1.5rem',
                    backgroundColor: '#f8fafc', padding: '1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0'
                }}>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.625rem', fontWeight: 900, color: '#64748b', marginBottom: '6px' }}>대상 시트 선택</label>
                        <select
                            value={kitConfig.sheet}
                            onChange={(e) => setKitConfig({ ...kitConfig, sheet: e.target.value })}
                            disabled={isMetadataLoading}
                            style={{ width: '100%', height: '40px', border: '1.5px solid #cbd5e1', borderRadius: '8px', padding: '0 12px', fontSize: '0.8125rem', fontWeight: 700, opacity: isMetadataLoading ? 0.5 : 1 }}
                        >
                            <option value="">{isMetadataLoading ? '시트 목록 불러오는 중...' : '시트를 선택하세요...'}</option>
                            {excelSheets.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.625rem', fontWeight: 900, color: '#64748b', marginBottom: '6px' }}>데이터 시작 행</label>
                        <input type="number" value={kitConfig.startRow}
                            onChange={(e) => { const s = parseInt(e.target.value) || 1; setKitConfig({ ...kitConfig, startRow: s, endRow: s + 30 }); }}
                            style={{ width: '100%', height: '40px', border: '1.5px solid #cbd5e1', borderRadius: '8px', padding: '0 12px', fontSize: '0.8125rem', fontWeight: 700 }}
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.625rem', fontWeight: 900, color: '#64748b', marginBottom: '6px' }}>데이터 종료 행</label>
                        <input type="number" value={kitConfig.endRow}
                            onChange={(e) => setKitConfig({ ...kitConfig, endRow: parseInt(e.target.value) || 31 })}
                            style={{ width: '100%', height: '40px', border: '1.5px solid #cbd5e1', borderRadius: '8px', padding: '0 12px', fontSize: '0.8125rem', fontWeight: 700 }}
                        />
                    </div>
                </div>

                {!kitConfig.sheet ? (
                    <div style={{ padding: '3rem 0', textAlign: 'center', backgroundColor: '#fcfcfc', border: '1.5px dashed #e2e8f0', borderRadius: '12px' }}>
                        <span className="material-icons" style={{ fontSize: '32px', color: '#cbd5e1', marginBottom: '10px' }}>science</span>
                        <p style={{ fontSize: '0.8125rem', color: '#94a3b8', fontWeight: 600 }}>키트 설정을 시작하려면 먼저 엑셀 시트를 선택해주세요.</p>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0', position: 'relative' }}>
                        {isPreviewLoading && (
                            <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(248,250,252,0.85)', borderRadius: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 5, gap: '10px' }}>
                                <div style={{ width: '28px', height: '28px', border: '3px solid #e2e8f0', borderTopColor: '#1e293b', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b' }}>시작행 데이터 불러오는 중...</span>
                            </div>
                        )}
                        <div style={{ display: 'grid', gridTemplateColumns: '120px 50px 140px 1fr', padding: '0 12px', borderBottom: '2px solid #1e293b', paddingBottom: '8px', marginBottom: '4px', columnGap: '8px' }}>
                            <span style={{ fontSize: '0.75rem', fontWeight: 900, color: '#1e293b' }}>키트 항목</span>
                            <span></span>
                            <span style={{ fontSize: '0.75rem', fontWeight: 900, color: '#1e293b' }}>엑셀칼럼 선택</span>
                            <span style={{ fontSize: '0.75rem', fontWeight: 900, color: '#1e293b' }}>프리뷰</span>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
                            {/* 날짜 행 */}
                            {(() => {
                                const dateCol = kitConfig.dateCol;
                                return (
                                    <div style={{ display: 'grid', gridTemplateColumns: '120px 50px 140px 1fr', padding: '8px 12px', backgroundColor: '#f0f9ff', borderRadius: '8px', alignItems: 'center', border: '1px solid #bae6fd', marginBottom: '8px', columnGap: '8px' }}>
                                        <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#334155', textAlign: 'center' }}>날짜 (Date)</span>
                                        <span></span>
                                        <select value={dateCol || 'A'} onChange={(e) => setKitConfig({ ...kitConfig, dateCol: e.target.value })}
                                            style={{ width: '120px', height: '34px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700 }}>
                                            <option value="">선택...</option>
                                            {alphabet.map(l => <option key={l} value={l}>{l}열</option>)}
                                        </select>
                                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: dateCol ? '#059669' : '#94a3b8', backgroundColor: dateCol ? '#f0fdf4' : '#f1f5f9', padding: '6px 10px', borderRadius: '6px', width: 'fit-content', minWidth: '100px', textAlign: 'center' }}>
                                            {(dateCol && sampleRowData[dateCol]) || '-- No Data --'}
                                        </span>
                                    </div>
                                );
                            })()}
                            {/* 키트 그룹 */}
                            {activeKits.map((kit, kitIdx) => {
                                const groupRows = rows.filter(r => !r.isDate && r.kitName === kit.name);
                                return (
                                    <div key={kit.name} style={{ display: 'grid', gridTemplateColumns: '120px 50px 140px 1fr', columnGap: '8px', borderBottom: kitIdx < activeKits.length - 1 ? '1px solid #e2e8f0' : 'none', paddingBottom: kitIdx < activeKits.length - 1 ? '6px' : 0, marginBottom: kitIdx < activeKits.length - 1 ? '6px' : 0, padding: '0 12px' }}>
                                        <div style={{ gridColumn: '1 / 2', gridRow: `1 / ${groupRows.length + 1}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <span style={{ fontSize: '0.8125rem', fontWeight: 800, color: '#1e293b' }}>{kit.name}</span>
                                        </div>
                                        {groupRows.map((row, rIdx) => {
                                            const colKey = kitMapping[row.key] || '';
                                            const hasCol = !!colKey;
                                            return (
                                                <React.Fragment key={row.key}>
                                                    <div style={{ gridColumn: '2 / 3', gridRow: rIdx + 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '5px 0' }}>
                                                        <span style={{ fontSize: '0.625rem', fontWeight: 800, color: 'white', backgroundColor: row.suffixColor, padding: '2px 8px', borderRadius: '4px', textAlign: 'center' }}>{row.suffix}</span>
                                                    </div>
                                                    <div style={{ gridColumn: '3 / 4', gridRow: rIdx + 1, display: 'flex', alignItems: 'center', padding: '5px 0' }}>
                                                        <select value={colKey} onChange={(e) => setKitMapping({ ...kitMapping, [row.key]: e.target.value })}
                                                            style={{ width: '120px', height: '34px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700 }}>
                                                            <option value="">선택...</option>
                                                            {alphabet.map(l => <option key={l} value={l}>{l}열</option>)}
                                                        </select>
                                                    </div>
                                                    <div style={{ gridColumn: '4 / 5', gridRow: rIdx + 1, display: 'flex', alignItems: 'center', padding: '5px 0' }}>
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
                    </div>
                )}

                {kitConfig.sheet && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem', gap: '0.75rem' }}>
                        <button onClick={() => setShowDataModal(true)} disabled={!importedData}
                            style={{
                                width: '160px', height: '50px', backgroundColor: importedData ? '#f1f5f9' : '#f8fafc', color: importedData ? '#1e293b' : '#cbd5e1',
                                border: '1.5px solid #cbd5e1', borderRadius: '12px', fontSize: '0.9375rem', fontWeight: 900,
                                cursor: importedData ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
                            }}>
                            <span className="material-icons">visibility</span>저장된 데이타보기
                        </button>
                        <button
                            onClick={async () => {
                                if (!allMapped) {
                                    await showAlert("모든 키트 항목의 칼럼 선택이 완료되어야 저장할 수 있습니다.");
                                    return;
                                }
                                const confirmed = await showConfirm("기존 키트 데이터를 데이터베이스에 저장하시겠습니까?");
                                if (confirmed) handleSaveKitMapping();
                            }}
                            disabled={!allMapped}
                            style={{
                                width: '240px', height: '50px', backgroundColor: allMapped ? '#1e293b' : '#cbd5e1', color: 'white',
                                border: 'none', borderRadius: '12px', fontSize: '0.9375rem', fontWeight: 900,
                                cursor: allMapped ? 'pointer' : 'not-allowed', transition: 'all 0.2s',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
                            }}>
                            <span className="material-icons">science</span>키트 데이터 저장하기
                        </button>
                    </div>
                )}
            </div>
        );
    };

    const renderWaterSettings = () => {
        const activeLocations = locationItems.filter(i => i.checked);
        const waterBaseParams = [
            { id: 'nh3_n', name: '암모니아성질소' },
            { id: 'no3_n', name: '질산성질소' },
            { id: 'po4_p', name: '인산염인' },
            { id: 'alkalinity', name: '알칼리도' }
        ];

        // PO4-P special rule locations
        const po4pLocations = ['유량조정조', '포기조', '방류조'];

        // Determine which mapping keys are required
        let requiredKeys = [];
        waterBaseParams.forEach(param => {
            activeLocations.forEach(loc => {
                if (param.id === 'po4_p' && !po4pLocations.includes(loc.name)) return;
                // For MBR, '침전조' is already filtered out of activeLocations in SettingsView if handled correctly, but we ensure it here too via basicSettings logic
                requiredKeys.push(`${param.name}_${loc.name}`);
            });
        });

        const isAllMapped = !!waterConfig.dateCol && requiredKeys.every(k => !!waterMapping[k]);

        return (
            <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                <div style={{
                    display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr', gap: '1.5rem',
                    backgroundColor: '#f8fafc', padding: '1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0'
                }}>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.625rem', fontWeight: 900, color: '#64748b', marginBottom: '6px' }}>대상 시트 선택</label>
                        <select
                            value={waterConfig.sheet}
                            onChange={(e) => setWaterConfig({ ...waterConfig, sheet: e.target.value })}
                            disabled={isMetadataLoading}
                            style={{ width: '100%', height: '40px', border: '1.5px solid #cbd5e1', borderRadius: '8px', padding: '0 12px', fontSize: '0.8125rem', fontWeight: 700, opacity: isMetadataLoading ? 0.5 : 1 }}
                        >
                            <option value="">{isMetadataLoading ? '시트 목록 불러오는 중...' : '시트를 선택하세요...'}</option>
                            {excelSheets.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.625rem', fontWeight: 900, color: '#64748b', marginBottom: '6px' }}>시작 행</label>
                        <input
                            type="number"
                            value={waterConfig.startRow}
                            onChange={(e) => {
                                const start = parseInt(e.target.value) || 1;
                                setWaterConfig({ ...waterConfig, startRow: start, endRow: start + 30 });
                            }}
                            style={{ width: '100%', height: '40px', border: '1.5px solid #cbd5e1', borderRadius: '8px', padding: '0 12px', fontSize: '0.8125rem', fontWeight: 700 }}
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.625rem', fontWeight: 900, color: '#64748b', marginBottom: '6px' }}>종료 행</label>
                        <input
                            type="number"
                            value={waterConfig.endRow}
                            onChange={(e) => setWaterConfig({ ...waterConfig, endRow: parseInt(e.target.value) || 31 })}
                            style={{ width: '100%', height: '40px', border: '1.5px solid #cbd5e1', borderRadius: '8px', padding: '0 12px', fontSize: '0.8125rem', fontWeight: 700 }}
                        />
                    </div>
                </div>

                {!waterConfig.sheet ? (
                    <div style={{ padding: '3rem 0', textAlign: 'center', backgroundColor: '#fcfcfc', border: '1.5px dashed #e2e8f0', borderRadius: '12px' }}>
                        <span className="material-icons" style={{ fontSize: '32px', color: '#cbd5e1', marginBottom: '10px' }}>water_drop</span>
                        <p style={{ fontSize: '0.8125rem', color: '#94a3b8', fontWeight: 600 }}>수질 설정을 시작하려면 먼저 엑셀 시트를 선택해주세요.</p>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', position: 'relative' }}>
                        {isPreviewLoading && (
                            <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(248,250,252,0.85)', borderRadius: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 5, gap: '10px' }}>
                                <div style={{ width: '28px', height: '28px', border: '3px solid #e2e8f0', borderTopColor: '#1e293b', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b' }}>데이터 불러오는 중...</span>
                            </div>
                        )}
                        <div style={{ display: 'grid', gridTemplateColumns: '120px 100px 140px 1fr', padding: '0 12px', borderBottom: '2px solid #1e293b', paddingBottom: '8px' }}>
                            <span style={{ fontSize: '0.75rem', fontWeight: 900, color: '#1e293b' }}>수질 항목</span>
                            <span style={{ fontSize: '0.75rem', fontWeight: 900, color: '#1e293b', textAlign: 'center' }}>분석 장소</span>
                            <span style={{ fontSize: '0.75rem', fontWeight: 900, color: '#1e293b' }}>엑셀 칼럼 선택</span>
                            <span style={{ fontSize: '0.75rem', fontWeight: 900, color: '#1e293b' }}>데이터 프리뷰</span>
                        </div>
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
                                const paramLocations = activeLocations.filter(loc => {
                                    if (param.id === 'po4_p') return po4pLocations.includes(loc.name);
                                    return true;
                                });

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
                    </div>
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
    };


    // handleApply → moved to useSettingsViewModel

    const renderItemGrid = (items, type) => (
        <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '0.75rem 0.5rem',
            padding: '0.5rem 0'
        }}>
            {items.map((item, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }} onClick={() => type !== 'water' && toggleItem(type, idx)}>
                    <span
                        className="material-icons"
                        style={{
                            fontSize: '18px',
                            color: item.checked ? '#1e293b' : '#cbd5e1',
                            transition: 'color 0.2s'
                        }}
                    >
                        {item.checked ? 'check_box' : 'check_box_outline_blank'}
                    </span>
                    <span style={{
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        color: item.checked ? '#334155' : '#94a3b8',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                    }}>
                        {item.name}
                    </span>
                </div>
            ))}
        </div>
    );

    const renderCredentialSection = (sectionKey, title, description) => {
        const credential = webAppCredentials[sectionKey];
        const isPasswordVisible = passwordVisibility[sectionKey];
        const isUrlEditable = urlEditability[sectionKey];
        const showUrlField = sectionKey === 'roadWeb' || sectionKey === 'waterAnalysisApp';

        return (
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '1.25rem',
                backgroundColor: '#f8fafc',
                padding: '1.5rem',
                borderRadius: '14px',
                border: '1px solid #e2e8f0'
            }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 900, color: '#1e293b' }}>{title}</h3>
                    <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>{description}</span>
                </div>

                {showUrlField && (
                    <div>
                        <label style={{ display: 'block', fontSize: '0.625rem', fontWeight: 900, color: '#64748b', marginBottom: '6px' }}>URL</label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 42px', gap: '8px', alignItems: 'center' }}>
                            <input
                                type="text"
                                value={credential.serviceUrl || ''}
                                onChange={(e) => updateWebAppCredentialField(sectionKey, 'serviceUrl', e.target.value)}
                                placeholder="https://..."
                                readOnly={!isUrlEditable}
                                style={{
                                    width: '100%',
                                    height: '42px',
                                    border: `1.5px solid ${isUrlEditable ? '#94a3b8' : '#cbd5e1'}`,
                                    borderRadius: '8px',
                                    padding: '0 12px',
                                    fontSize: '0.8125rem',
                                    fontWeight: 700,
                                    color: '#1e293b',
                                    boxSizing: 'border-box',
                                    backgroundColor: isUrlEditable ? 'white' : '#f8fafc'
                                }}
                            />
                            <button
                                type="button"
                                onClick={() => toggleUrlEditability(sectionKey)}
                                style={{
                                    width: '42px',
                                    height: '42px',
                                    border: `1.5px solid ${isUrlEditable ? '#1e293b' : '#cbd5e1'}`,
                                    borderRadius: '8px',
                                    backgroundColor: isUrlEditable ? '#e2e8f0' : 'white',
                                    color: '#1e293b',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    cursor: 'pointer'
                                }}
                                aria-label={isUrlEditable ? 'URL 수정 잠금' : 'URL 수정 허용'}
                                title={isUrlEditable ? 'URL 수정 잠금' : 'URL 수정 허용'}
                            >
                                <span className="material-icons" style={{ fontSize: '18px' }}>edit</span>
                            </button>
                        </div>
                    </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.625rem', fontWeight: 900, color: '#64748b', marginBottom: '6px' }}>아이디</label>
                        <input
                            type="text"
                            value={credential.userId}
                            onChange={(e) => updateWebAppCredentialField(sectionKey, 'userId', e.target.value)}
                            style={{
                                width: '100%',
                                height: '42px',
                                border: '1.5px solid #cbd5e1',
                                borderRadius: '8px',
                                padding: '0 12px',
                                fontSize: '0.8125rem',
                                fontWeight: 700,
                                color: '#1e293b',
                                boxSizing: 'border-box',
                                backgroundColor: 'white'
                            }}
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.625rem', fontWeight: 900, color: '#64748b', marginBottom: '6px' }}>비밀번호</label>
                        <div style={{ position: 'relative' }}>
                            <input
                                type={isPasswordVisible ? 'text' : 'password'}
                                value={credential.password}
                                onChange={(e) => updateWebAppCredentialField(sectionKey, 'password', e.target.value)}
                                style={{
                                    width: '100%',
                                    height: '42px',
                                    border: '1.5px solid #cbd5e1',
                                    borderRadius: '8px',
                                    padding: '0 42px 0 12px',
                                    fontSize: '0.8125rem',
                                    fontWeight: 700,
                                    color: '#1e293b',
                                    boxSizing: 'border-box',
                                    backgroundColor: 'white'
                                }}
                            />
                            <button
                                type="button"
                                onClick={() => togglePasswordVisibility(sectionKey)}
                                style={{
                                    position: 'absolute',
                                    top: '50%',
                                    right: '10px',
                                    transform: 'translateY(-50%)',
                                    border: 'none',
                                    background: 'none',
                                    padding: 0,
                                    width: '24px',
                                    height: '24px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    cursor: 'pointer',
                                    color: '#64748b'
                                }}
                                aria-label={isPasswordVisible ? '비밀번호 숨기기' : '비밀번호 표시'}
                            >
                                <span className="material-icons" style={{ fontSize: '20px' }}>
                                    {isPasswordVisible ? 'visibility_off' : 'visibility'}
                                </span>
                            </button>
                        </div>
                    </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                        onClick={() => handleSaveWebAppCredentials(sectionKey)}
                        style={{
                            minWidth: '132px',
                            height: '42px',
                            border: 'none',
                            borderRadius: '10px',
                            backgroundColor: '#1e293b',
                            color: 'white',
                            fontSize: '0.8125rem',
                            fontWeight: 900,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '6px'
                        }}
                    >
                        <span className="material-icons" style={{ fontSize: '18px' }}>save</span>
                        저장하기
                    </button>
                </div>
            </div>
        );
    };

    // --- 일지 매핑용 DB 컬럼 옵션 구성 ---
    const dbColumnOptions = Object.entries(dbColumns).flatMap(([table, cols]) =>
        cols.map(c => `${table}.${c}`)
    );

    const renderLogMappingSettings = () => (
        <div style={{ display: 'flex', height: '100%', minHeight: '480px' }}>
            {/* 좌측: 일지 종류 리스트 */}
            <div style={{
                width: '200px',
                flexShrink: 0,
                borderRight: '1px solid #e2e8f0',
                backgroundColor: '#f8fafc',
                padding: '1rem 0',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px'
            }}>
                <div style={{
                    padding: '0.5rem 1.25rem',
                    fontSize: '0.7rem',
                    fontWeight: 900,
                    color: '#94a3b8',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                }}>
                    일지 양식 선택
                </div>
                {LOG_TYPES.map(logType => (
                    <button
                        key={logType.id}
                        onClick={() => setSelectedLogType(logType.id)}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            width: '100%',
                            padding: '0.625rem 1.25rem',
                            border: 'none',
                            background: selectedLogType === logType.id ? '#e2e8f0' : 'transparent',
                            color: selectedLogType === logType.id ? '#0f172a' : '#475569',
                            fontWeight: selectedLogType === logType.id ? 900 : 700,
                            fontSize: '0.8125rem',
                            cursor: 'pointer',
                            textAlign: 'left',
                            transition: 'all 0.15s',
                            borderLeft: selectedLogType === logType.id ? '3px solid #1e293b' : '3px solid transparent'
                        }}
                    >
                        <span className="material-icons" style={{ fontSize: '16px', color: selectedLogType === logType.id ? '#1e293b' : '#94a3b8' }}>
                            description
                        </span>
                        {logType.label}
                    </button>
                ))}
            </div>

            {/* 우측: 매핑 패널 */}
            <div style={{ flex: 1, padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', overflowY: 'auto' }}>
                {/* ── 유량매핑조건 (일일업무일지 선택 시에만 표시) ── */}
                {selectedLogType === 'daily_work_log' && (
                    <div style={{
                        backgroundColor: '#f0f9ff',
                        border: '1px solid #bae6fd',
                        borderRadius: '12px',
                        padding: '1.25rem 1.5rem',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span className="material-icons" style={{ fontSize: '20px', color: '#0284c7' }}>tune</span>
                            <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 900, color: '#0c4a6e' }}>
                                유량매핑조건
                            </h3>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155', whiteSpace: 'nowrap' }}>
                                내부/외부 반송 유량 옵션
                            </label>
                            <select
                                value={flowOption}
                                onChange={(e) => setFlowOption(e.target.value)}
                                style={{
                                    height: '36px',
                                    border: '1.5px solid #7dd3fc',
                                    borderRadius: '8px',
                                    padding: '0 12px',
                                    fontSize: '0.8125rem',
                                    fontWeight: 700,
                                    color: '#0c4a6e',
                                    backgroundColor: 'white',
                                    cursor: 'pointer',
                                    minWidth: '180px'
                                }}
                            >
                                <option value="single1">1계열값 매핑</option>
                                {siteInfo.series === '2계열' && (
                                    <>
                                        <option value="single2">2계열값 매핑</option>
                                        <option value="combined">1+2계열값 매핑</option>
                                    </>
                                )}
                            </select>
                            <button
                                onClick={() => handleSaveFlowOption(flowOption)}
                                style={{
                                    height: '36px',
                                    padding: '0 16px',
                                    border: 'none',
                                    borderRadius: '8px',
                                    backgroundColor: '#0284c7',
                                    color: 'white',
                                    fontSize: '0.75rem',
                                    fontWeight: 800,
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    transition: 'background-color 0.15s'
                                }}
                                onMouseEnter={e => e.target.style.backgroundColor = '#0369a1'}
                                onMouseLeave={e => e.target.style.backgroundColor = '#0284c7'}
                            >
                                <span className="material-icons" style={{ fontSize: '14px' }}>save</span>
                                저장
                            </button>
                        </div>
                        <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>
                            {siteInfo.series === '2계열'
                                ? '2계열 현장입니다. 내부/외부 반송 유량의 매핑 방식을 선택하세요.'
                                : '1계열 현장입니다. 기본값(1계열값 매핑)이 적용됩니다.'}
                        </span>
                    </div>
                )}

                {/* 슬러지반출관리대장 기본설정 */}
                {selectedLogType === 'sludge_export_ledger' && (
                    <div style={{
                        backgroundColor: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        borderRadius: '12px',
                        padding: '1.25rem 1.5rem',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '14px'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span className="material-icons" style={{ fontSize: '20px', color: '#0f172a' }}>article</span>
                            <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 900, color: '#0f172a' }}>
                                슬러지반출관리대장 기본설정
                            </h3>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px auto', gap: '10px', alignItems: 'end' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 800, color: '#64748b', marginBottom: '6px' }}>
                                    업체명
                                </label>
                                <input
                                    type="text"
                                    value={sludgeExportSettings.companyName}
                                    onChange={(e) => setSludgeExportSettings(prev => ({ ...prev, companyName: e.target.value }))}
                                    placeholder="예: 청주환경(주)"
                                    style={{
                                        width: '100%',
                                        height: '38px',
                                        border: '1.5px solid #cbd5e1',
                                        borderRadius: '8px',
                                        padding: '0 12px',
                                        fontSize: '0.8125rem',
                                        fontWeight: 700,
                                        color: '#1e293b'
                                    }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 800, color: '#64748b', marginBottom: '6px' }}>
                                    기본 반출량
                                </label>
                                <input
                                    type="number"
                                    min="0"
                                    step="0.1"
                                    value={sludgeExportSettings.defaultAmount}
                                    onChange={(e) => setSludgeExportSettings(prev => ({ ...prev, defaultAmount: e.target.value === '' ? '' : Number(e.target.value) }))}
                                    style={{
                                        width: '100%',
                                        height: '38px',
                                        border: '1.5px solid #cbd5e1',
                                        borderRadius: '8px',
                                        padding: '0 12px',
                                        fontSize: '0.8125rem',
                                        fontWeight: 700,
                                        color: '#1e293b',
                                        textAlign: 'right'
                                    }}
                                />
                            </div>
                            <button
                                onClick={handleSaveSludgeExportSettings}
                                disabled={isSavingSludgeExportSettings}
                                style={{
                                    height: '38px',
                                    minWidth: '94px',
                                    border: 'none',
                                    borderRadius: '8px',
                                    backgroundColor: isSavingSludgeExportSettings ? '#94a3b8' : '#1e293b',
                                    color: 'white',
                                    fontSize: '0.75rem',
                                    fontWeight: 800,
                                    cursor: isSavingSludgeExportSettings ? 'not-allowed' : 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '4px'
                                }}
                            >
                                <span className="material-icons" style={{ fontSize: '14px' }}>save</span>
                                {isSavingSludgeExportSettings ? '저장중' : '저장'}
                            </button>
                        </div>

                        <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>
                            설정한 업체명과 기본 반출량은 슬러지반출관리대장 출력 시 기본값으로 사용됩니다.
                        </span>
                    </div>
                )}

                {/* 다른 일지 양식은 아직 서비스 준비 중 */}
                {selectedLogType !== 'daily_work_log' && selectedLogType !== 'sludge_export_ledger' && (
                    <div style={{
                        padding: '4rem 2rem',
                        textAlign: 'center',
                        color: '#64748b',
                        fontWeight: 800,
                        fontSize: '1rem',
                        backgroundColor: '#f8fafc',
                        borderRadius: '12px',
                        border: '2px dashed #e2e8f0',
                        marginTop: '1rem'
                    }}>
                        <span className="material-icons" style={{ fontSize: '32px', color: '#cbd5e1', marginBottom: '12px', display: 'block' }}>
                            construction
                        </span>
                        현재 {LOG_TYPES.find(t => t.id === selectedLogType)?.label || ''} 매핑 기능은 서비스 준비 중입니다.
                    </div>
                )}
            </div>
        </div>
    );

    const renderWebAppSettings = () => (
        <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {renderCredentialSection('roadWeb', '도로공사 웹페이지 설정', '도로공사 웹페이지 로그인 계정을 저장합니다.')}
            {renderCredentialSection('waterAnalysisApp', '수질분석 앱 설정', '수질분석 앱 로그인 계정을 저장합니다.')}

            {/* Gemini API Key Section */}
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
                backgroundColor: '#f8fafc',
                padding: '1.5rem',
                borderRadius: '14px',
                border: '1px solid #e2e8f0'
            }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 900, color: '#1e293b' }}>Gemini API 설정</h3>
                    <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>AI 기능에 필요한 Gemini API 키를 등록합니다.</span>
                </div>
                <div>
                    <label style={{ display: 'block', fontSize: '0.625rem', fontWeight: 900, color: '#64748b', marginBottom: '6px' }}>API Key</label>
                    <div style={{ position: 'relative' }}>
                        <input
                            type={geminiKeyVisible ? 'text' : 'password'}
                            value={geminiApiKey}
                            onChange={(e) => setGeminiApiKey(e.target.value)}
                            placeholder="AIza..."
                            style={{
                                width: '100%',
                                height: '42px',
                                border: '1.5px solid #cbd5e1',
                                borderRadius: '8px',
                                padding: '0 42px 0 12px',
                                fontSize: '0.8125rem',
                                fontWeight: 700,
                                fontFamily: 'monospace',
                                color: '#1e293b',
                                boxSizing: 'border-box',
                                backgroundColor: 'white'
                            }}
                        />
                        <button
                            type="button"
                            onClick={() => setGeminiKeyVisible(prev => !prev)}
                            style={{
                                position: 'absolute',
                                top: '50%',
                                right: '10px',
                                transform: 'translateY(-50%)',
                                border: 'none',
                                background: 'none',
                                padding: 0,
                                width: '24px',
                                height: '24px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'pointer',
                                color: '#64748b'
                            }}
                            aria-label={geminiKeyVisible ? 'API 키 숨기기' : 'API 키 표시'}
                        >
                            <span className="material-icons" style={{ fontSize: '20px' }}>
                                {geminiKeyVisible ? 'visibility_off' : 'visibility'}
                            </span>
                        </button>
                    </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                        onClick={handleSaveGeminiApiKey}
                        style={{
                            minWidth: '132px',
                            height: '42px',
                            border: 'none',
                            borderRadius: '10px',
                            backgroundColor: '#1e293b',
                            color: 'white',
                            fontSize: '0.8125rem',
                            fontWeight: 900,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '6px'
                        }}
                    >
                        <span className="material-icons" style={{ fontSize: '18px' }}>save</span>
                        저장하기
                    </button>
                </div>
            </div>
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
                backgroundColor: '#f8fafc',
                padding: '1.5rem',
                borderRadius: '14px',
                border: '1px solid #e2e8f0'
            }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 900, color: '#1e293b' }}>QnTECH 불러오기 설정</h3>
                    <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>사진 저장 루트와 외부 샘플명 매핑을 지정합니다. 범위 불러오기에서도 같은 규칙을 사용합니다.</span>
                </div>

                <div>
                    <label style={{ display: 'block', fontSize: '0.625rem', fontWeight: 900, color: '#64748b', marginBottom: '6px' }}>사진 저장 루트</label>
                    <input
                        type="text"
                        value={qntechImportSettings.photoRoot || ''}
                        onChange={(e) => updateQntechImportSettingField('photoRoot', e.target.value)}
                        placeholder="사진관리/수질분석 또는 D:/Photos/QnTECH"
                        style={{
                            width: '100%',
                            height: '42px',
                            border: '1.5px solid #cbd5e1',
                            borderRadius: '8px',
                            padding: '0 12px',
                            fontSize: '0.8125rem',
                            fontWeight: 700,
                            color: '#1e293b',
                            boxSizing: 'border-box',
                            backgroundColor: 'white'
                        }}
                    />
                    <div style={{ marginTop: '6px', fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>
                        상대경로면 프로그램 폴더 기준, 절대경로면 해당 경로 그대로 사용합니다.
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontSize: '0.75rem', color: '#475569', fontWeight: 800 }}>QnTECH 샘플명 매핑</div>
                    <button
                        type="button"
                        onClick={addQntechSampleMapping}
                        style={{
                            border: '1px solid #cbd5e1',
                            background: 'white',
                            color: '#0f172a',
                            borderRadius: '8px',
                            height: '34px',
                            padding: '0 12px',
                            fontSize: '0.75rem',
                            fontWeight: 800,
                            cursor: 'pointer'
                        }}
                    >
                        매핑 추가
                    </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {qntechImportSettings.sampleMappings.length === 0 ? (
                        <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, padding: '8px 0' }}>
                            추가 매핑이 없으면 기본 이름 규칙과 순서 기반 매핑을 사용합니다.
                        </div>
                    ) : qntechImportSettings.sampleMappings.map((mapping, index) => (
                        <div key={`qntech-mapping-${index}`} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr auto', gap: '10px', alignItems: 'center' }}>
                            <input
                                type="text"
                                value={mapping.sourceName || ''}
                                onChange={(e) => updateQntechSampleMapping(index, 'sourceName', e.target.value)}
                                placeholder="예: 막여과수조"
                                style={{
                                    width: '100%',
                                    height: '40px',
                                    border: '1.5px solid #cbd5e1',
                                    borderRadius: '8px',
                                    padding: '0 12px',
                                    fontSize: '0.8125rem',
                                    fontWeight: 700,
                                    color: '#1e293b',
                                    boxSizing: 'border-box',
                                    backgroundColor: 'white'
                                }}
                            />
                            <select
                                value={mapping.targetLocation || ''}
                                onChange={(e) => updateQntechSampleMapping(index, 'targetLocation', e.target.value)}
                                style={{
                                    width: '100%',
                                    height: '40px',
                                    border: '1.5px solid #cbd5e1',
                                    borderRadius: '8px',
                                    padding: '0 12px',
                                    fontSize: '0.8125rem',
                                    fontWeight: 700,
                                    color: '#1e293b',
                                    boxSizing: 'border-box',
                                    backgroundColor: 'white'
                                }}
                            >
                                <option value="">대상 위치 선택</option>
                                {locationItems.filter((item) => item.checked).map((item) => (
                                    <option key={item.name} value={item.name}>{item.name}</option>
                                ))}
                            </select>
                            <button
                                type="button"
                                onClick={() => removeQntechSampleMapping(index)}
                                style={{
                                    border: '1px solid #fecaca',
                                    background: '#fff1f2',
                                    color: '#be123c',
                                    borderRadius: '8px',
                                    height: '40px',
                                    minWidth: '72px',
                                    fontSize: '0.75rem',
                                    fontWeight: 800,
                                    cursor: 'pointer'
                                }}
                            >
                                삭제
                            </button>
                        </div>
                    ))}
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                        onClick={handleSaveQntechImportSettings}
                        style={{
                            minWidth: '160px',
                            height: '42px',
                            border: 'none',
                            borderRadius: '10px',
                            backgroundColor: '#1e293b',
                            color: 'white',
                            fontSize: '0.8125rem',
                            fontWeight: 900,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '6px'
                        }}
                    >
                        <span className="material-icons" style={{ fontSize: '18px' }}>save</span>
                        불러오기 설정 저장
                    </button>
                </div>
            </div>
        </div>
    );

    const renderBasicSettings = () => (
        <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>
            {/* 상단 섹션: 2x2 Grid */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '1.25rem',
                backgroundColor: '#f8fafc',
                padding: '1.5rem',
                borderRadius: '12px',
                border: '1px solid #e2e8f0'
            }}>
                {[
                    { label: '현장명', key: 'siteName', type: 'text' },
                    { label: '관리자명', key: 'managerName', type: 'text' },
                    { label: '공법', key: 'method', type: 'select', options: ['A2O', 'MBR'] },
                    { label: '계열수', key: 'series', type: 'select', options: ['1계열', '2계열'] }
                ].map((item) => (
                    <div key={item.key}>
                        <label style={{ display: 'block', fontSize: '0.625rem', fontWeight: 900, color: '#64748b', marginBottom: '6px', textTransform: 'uppercase' }}>
                            {item.label}
                        </label>
                        {item.type === 'select' ? (
                            <select
                                value={siteInfo[item.key]}
                                onChange={(e) => {
                                    if (item.key === 'series') {
                                        handleSeriesChange(e.target.value);
                                    } else {
                                        setSiteInfo({ ...siteInfo, [item.key]: e.target.value });
                                    }
                                }}
                                style={{
                                    width: '100%',
                                    border: '1.5px solid #cbd5e1',
                                    height: '40px',
                                    padding: '0 12px',
                                    fontWeight: 700,
                                    color: '#1e293b',
                                    borderRadius: '8px',
                                    outline: 'none',
                                    boxSizing: 'border-box',
                                    backgroundColor: 'white',
                                    fontSize: '0.8125rem'
                                }}
                            >
                                {item.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                            </select>
                        ) : (
                            <input
                                type="text"
                                value={siteInfo[item.key]}
                                onChange={(e) => setSiteInfo({ ...siteInfo, [item.key]: e.target.value })}
                                style={{
                                    width: '100%',
                                    border: '1.5px solid #cbd5e1',
                                    height: '40px',
                                    padding: '0 12px',
                                    fontWeight: 700,
                                    color: '#1e293b',
                                    borderRadius: '8px',
                                    outline: 'none',
                                    boxSizing: 'border-box',
                                    transition: 'all 0.2s',
                                    fontSize: '0.8125rem'
                                }}
                            />
                        )}
                    </div>
                ))}
            </div>

            {/* 중간 섹션: 4 Columns */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '1.25rem' }}>
                {/* Column 1: 검침항목 */}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <h3 style={{ fontSize: '0.75rem', fontWeight: 900, color: '#1e293b', paddingBottom: '0.6rem', borderBottom: '2px solid #1e293b', marginBottom: '0.75rem' }}>검침항목</h3>
                    {renderItemGrid(flowItems, 'flow')}
                    <div style={{ display: 'flex', gap: '0.4rem', marginTop: '1rem' }}>
                        <input
                            placeholder="항목 추가..."
                            value={newFlowItem}
                            onChange={(e) => setNewFlowItem(e.target.value)}
                            style={{ flex: 1, border: '1px solid #cbd5e1', height: '34px', padding: '0 10px', borderRadius: '6px', fontSize: '0.75rem' }}
                        />
                        <button
                            onClick={() => addItem('flow')}
                            style={{ width: '34px', height: '34px', backgroundColor: '#1e293b', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >
                            <span className="material-icons" style={{ fontSize: '18px' }}>add</span>
                        </button>
                    </div>
                </div>

                {/* Column 2: 약품항목 */}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '0.6rem', borderBottom: '2px solid #1e293b', marginBottom: '0.75rem' }}>
                        <h3 style={{ fontSize: '0.75rem', fontWeight: 900, color: '#1e293b', margin: 0 }}>약품항목</h3>
                        <button
                            onClick={handleOpenDefaultAmountModal}
                            style={{ fontSize: '0.625rem', fontWeight: 700, color: '#475569', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '5px', padding: '3px 8px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                        >입고량지정</button>
                    </div>
                    {renderItemGrid(medicineItems, 'medicine')}
                    <div style={{ display: 'flex', gap: '0.4rem', marginTop: '1rem' }}>
                        <input
                            placeholder="항목 추가..."
                            value={newMedicineItem}
                            onChange={(e) => setNewMedicineItem(e.target.value)}
                            style={{ flex: 1, border: '1px solid #cbd5e1', height: '34px', padding: '0 10px', borderRadius: '6px', fontSize: '0.75rem' }}
                        />
                        <button
                            onClick={() => addItem('medicine')}
                            style={{ width: '34px', height: '34px', backgroundColor: '#1e293b', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >
                            <span className="material-icons" style={{ fontSize: '18px' }}>add</span>
                        </button>
                    </div>
                </div>

                {/* Column 3: 분석장소 */}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '0.6rem', borderBottom: '2px solid #1e293b', marginBottom: '0.75rem' }}>
                        <h3 style={{ fontSize: '0.75rem', fontWeight: 900, color: '#1e293b', margin: 0 }}>분석장소</h3>
                        <button
                            onClick={handleOpenKitDefaultModal}
                            style={{ fontSize: '0.625rem', fontWeight: 700, color: '#475569', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '5px', padding: '3px 8px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                        >키트량지정</button>
                    </div>
                    {renderItemGrid(locationItems.filter(item => !(siteInfo.method === 'MBR' && item.name === '침전조')), 'location')}
                    <div style={{ display: 'flex', gap: '0.4rem', marginTop: '1rem' }}>
                        <input
                            placeholder="장소 추가..."
                            value={newLocationItem}
                            onChange={(e) => setNewLocationItem(e.target.value)}
                            style={{ flex: 1, border: '1px solid #cbd5e1', height: '34px', padding: '0 10px', borderRadius: '6px', fontSize: '0.75rem' }}
                        />
                        <button
                            onClick={() => addItem('location')}
                            style={{ width: '34px', height: '34px', backgroundColor: '#1e293b', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >
                            <span className="material-icons" style={{ fontSize: '18px' }}>add</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* 하단 버튼 및 파일 관리 섹션 */}
            <div style={{
                marginTop: '0.5rem',
                paddingTop: '1.5rem',
                borderTop: '1px solid #f1f5f9',
                display: 'flex',
                alignItems: 'flex-end',
                gap: '1.25rem'
            }}>
                {/* 왼쪽: 파일 선택 그룹 */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

                    {/* 엑셀 원본 파일 불러오기 */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                            <div style={{ flex: 1, position: 'relative' }}>
                                <label style={{ display: 'block', fontSize: '0.625rem', fontWeight: 900, color: '#64748b', marginBottom: '4px', position: 'absolute', top: '-18px' }}>
                                    엑셀 원본 파일 불러오기
                                </label>
                                <input
                                    readOnly
                                    value={excelFileName}
                                    placeholder="엑셀 원본 파일을 선택해주세요..."
                                    style={{
                                        width: '100%',
                                        height: '50px',
                                        border: `1.5px dashed ${excelStatus.status === 'ready' ? '#86efac' : excelStatus.status === 'not-found' ? '#fca5a5' : '#cbd5e1'}`,
                                        borderRadius: '12px',
                                        padding: '0 12px',
                                        fontSize: '0.8125rem',
                                        fontWeight: 700,
                                        backgroundColor: excelStatus.status === 'ready' ? '#f0fdf4' : excelStatus.status === 'not-found' ? '#fef2f2' : '#fcfcfc',
                                        color: '#475569'
                                    }}
                                />
                            </div>
                            <label style={{
                                height: '50px',
                                padding: '0 20px',
                                backgroundColor: '#f1f5f9',
                                color: '#1e293b',
                                border: '1px solid #cbd5e1',
                                borderRadius: '12px',
                                fontSize: '0.8125rem',
                                fontWeight: 900,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '6px',
                                transition: 'all 0.1s'
                            }}
                                onMouseEnter={e => e.currentTarget.style.backgroundColor = '#e2e8f0'}
                                onMouseLeave={e => e.currentTarget.style.backgroundColor = '#f1f5f9'}
                            >
                                <span className="material-icons" style={{ fontSize: '18px' }}>file_open</span>
                                파일 선택
                                <input
                                    type="file"
                                    accept=".xlsx, .xls, .xlsm"
                                    style={{ display: 'none' }}
                                    onChange={(e) => handleExcelFileUpload(e.target.files[0])}
                                />
                            </label>
                        </div>
                        {/* 엑셀 로드 상태 배지 */}
                        {excelStatus.status !== 'idle' && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingLeft: '4px' }}>
                                {(excelStatus.status === 'loading' || excelStatus.status === 'uploading') && (
                                    <>
                                        <div style={{ width: '14px', height: '14px', border: '2px solid #e2e8f0', borderTopColor: '#64748b', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />
                                        <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#64748b' }}>
                                            {excelStatus.status === 'uploading' ? '엑셀 데이터 저장 중 (첫 3개 시트)...' : '상태 확인 중...'}
                                        </span>
                                    </>
                                )}
                                {excelStatus.status === 'ready' && (
                                    <>
                                        <span className="material-icons" style={{ fontSize: '16px', color: '#16a34a' }}>check_circle</span>
                                        <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#16a34a' }}>
                                            데이터 준비 완료 &mdash; {excelStatus.sheets.length}개 시트
                                            {excelStatus.sheets.length > 0 && ` (${excelStatus.sheets.join(', ')})`}
                                        </span>
                                    </>
                                )}
                                {excelStatus.status === 'not-found' && (
                                    <>
                                        <span className="material-icons" style={{ fontSize: '16px', color: '#dc2626' }}>error</span>
                                        <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#dc2626' }}>파일을 찾을 수 없습니다. 파일을 다시 선택해주세요.</span>
                                    </>
                                )}
                                {excelStatus.status === 'error' && (
                                    <>
                                        <span className="material-icons" style={{ fontSize: '16px', color: '#dc2626' }}>error</span>
                                        <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#dc2626' }}>로드 실패. 파일을 다시 선택해주세요.</span>
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                    {/* 일지양식 불러오기 (다중 선택) */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <div style={{ flex: 1, position: 'relative' }}>
                            <label style={{ display: 'block', fontSize: '0.625rem', fontWeight: 900, color: '#64748b', marginBottom: '4px', position: 'absolute', top: '-18px' }}>
                                일지양식 불러오기 (한꺼번에 선택 가능)
                            </label>
                            <input
                                readOnly
                                value={templateFileNames}
                                title={templateFileNames}
                                placeholder="선택한 양식은 앱 로컬 템플릿 폴더로 복사됩니다."
                                style={{
                                    width: '100%',
                                    height: '50px',
                                    border: '1.5px dashed #cbd5e1',
                                    borderRadius: '12px',
                                    padding: '0 12px',
                                    fontSize: '0.8125rem',
                                    fontWeight: 700,
                                    backgroundColor: '#fcfcfc',
                                    color: '#475569',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis'
                                }}
                            />
                        </div>
                        <label style={{
                            height: '50px',
                            padding: '0 20px',
                            backgroundColor: '#f1f5f9',
                            color: '#1e293b',
                            border: '1px solid #cbd5e1',
                            borderRadius: '12px',
                            fontSize: '0.8125rem',
                            fontWeight: 900,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '6px',
                            transition: 'all 0.1s'
                        }}
                            onMouseEnter={e => e.currentTarget.style.backgroundColor = '#e2e8f0'}
                            onMouseLeave={e => e.currentTarget.style.backgroundColor = '#f1f5f9'}
                        >
                            <span className="material-icons" style={{ fontSize: '18px' }}>library_add</span>
                            양식 선택
                            <input
                                type="file"
                                multiple
                                accept=".xlsx, .xls, .xlsm, .hwpx"
                                style={{ display: 'none' }}
                                onChange={(e) => {
                                    handleTemplateFileChange(Array.from(e.target.files));
                                    e.target.value = '';
                                }}
                            />
                        </label>
                    </div>
                </div>

                {/* 오른쪽: 설정 저장 버튼 */}
                <button
                    onClick={handleApply}
                    style={{
                        width: '180px',
                        height: '112px', // 두 개의 입력창 높이 + 갭에 맞춰 조정
                        backgroundColor: '#1e293b',
                        color: 'white',
                        border: 'none',
                        borderRadius: '12px',
                        fontSize: '0.9375rem',
                        fontWeight: 900,
                        cursor: 'pointer',
                        boxShadow: '0 4px 10px -2px rgba(30,41,59,0.2)',
                        transition: 'all 0.15s',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        flexShrink: 0
                    }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = '#0f172a'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = '#1e293b'}
                >
                    <span className="material-icons" style={{ fontSize: '24px' }}>save</span>
                    설정 저장하기
                </button>
            </div>
        </div>
    );

    return (
        <div className="panel-container">
            {isLoading ? (
                <div style={{ width: '820px', height: '400px', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'white', borderRadius: '20px' }}>
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-slate-900"></div>
                </div>
            ) : (
                <div className="dynamic-panel shadow-2xl border-slate-200" style={{ width: '820px', flexShrink: 0, height: 'auto', minHeight: 'fit-content' }}>
                    {/* 상단 탭 헤더 */}
                    <div style={{
                        display: 'flex',
                        borderBottom: '2px solid #f1f5f9',
                        backgroundColor: '#fff',
                        flexShrink: 0,
                        borderRadius: '20px 20px 0 0',
                        position: 'sticky',
                        top: 0,
                        zIndex: 10
                    }}>
                        {[
                            { id: 'basic', label: '기본설정' },
                            { id: 'flow', label: '유량설정' },
                            { id: 'medicine', label: '약품설정' },
                            { id: 'water', label: '수질설정' },
                            { id: 'kit', label: '키트설정' },
                            { id: 'logMapping', label: '일지설정' },
                            { id: 'webapp', label: '웹/앱설정' }
                        ].map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                style={{
                                    flex: 1,
                                    height: '56px',
                                    border: 'none',
                                    background: 'none',
                                    fontSize: '0.875rem',
                                    fontWeight: activeTab === tab.id ? 900 : 700,
                                    color: activeTab === tab.id ? '#1e293b' : '#94a3b8',
                                    borderBottom: activeTab === tab.id ? '2.5px solid #1e293b' : '2.5px solid transparent',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s'
                                }}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    {/* 콘텐츠 영역 */}
                    <div style={{ flex: 1 }}>
                        {activeTab === 'basic' ? renderBasicSettings() :
                            activeTab === 'flow' ? renderFlowSettings() :
                                activeTab === 'medicine' ? renderMedicineSettings() :
                                    activeTab === 'water' ? renderWaterSettings() :
                                        activeTab === 'kit' ? renderKitSettings() :
                                            activeTab === 'logMapping' ? renderLogMappingSettings() :
                                                activeTab === 'webapp' ? renderWebAppSettings() : null}
                    </div>
                    {renderImportProgress()}
                    {renderDataModal()}
                </div>
            )}

            {/* 키트 기본 입고량 모달 */}
            {showKitDefaultModal && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
                    <div style={{ background: '#fff', borderRadius: '12px', boxShadow: '0 8px 32px rgba(0,0,0,0.18)', width: '340px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.875rem', fontWeight: 800, color: '#1e293b' }}>키트 기본 입고량 지정</span>
                            <button onClick={() => setShowKitDefaultModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '1.1rem', lineHeight: 1 }}>✕</button>
                        </div>
                        <p style={{ fontSize: '0.65rem', color: '#94a3b8', margin: 0 }}>월 데이터가 없을 때 자동으로 채워지는 기본값입니다.</p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {kitDefaultItems.map((item, idx) => (
                                <div key={item.name} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <span style={{ flex: 1, fontSize: '0.75rem', color: '#334155' }}>{item.name}</span>
                                    <input
                                        type="number"
                                        min="0"
                                        value={item.defaultAmount}
                                        onChange={e => {
                                            const updated = [...kitDefaultItems];
                                            updated[idx] = { ...updated[idx], defaultAmount: e.target.value === '' ? '' : Number(e.target.value) };
                                            setKitDefaultItems(updated);
                                        }}
                                        style={{ width: '72px', height: '30px', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '0 8px', fontSize: '0.75rem', textAlign: 'right' }}
                                    />
                                    <span style={{ fontSize: '0.7rem', color: '#64748b', width: '20px' }}>개</span>
                                </div>
                            ))}
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                            <button
                                onClick={() => setShowKitDefaultModal(false)}
                                style={{ padding: '6px 16px', fontSize: '0.75rem', border: '1px solid #cbd5e1', borderRadius: '6px', background: '#f8fafc', cursor: 'pointer', color: '#475569' }}
                            >닫기</button>
                            <button
                                onClick={handleSaveKitDefaults}
                                disabled={isSavingKitDefaults}
                                style={{ padding: '6px 16px', fontSize: '0.75rem', border: 'none', borderRadius: '6px', background: '#1e293b', color: '#fff', cursor: isSavingKitDefaults ? 'not-allowed' : 'pointer', opacity: isSavingKitDefaults ? 0.6 : 1 }}
                            >{isSavingKitDefaults ? '저장 중...' : '저장'}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* 약품 기본 입고량 모달 */}
            {showDefaultAmountModal && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
                    <div style={{ background: '#fff', borderRadius: '12px', boxShadow: '0 8px 32px rgba(0,0,0,0.18)', width: '340px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.875rem', fontWeight: 800, color: '#1e293b' }}>약품 기본 입고량 지정</span>
                            <button onClick={() => setShowDefaultAmountModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '1.1rem', lineHeight: 1 }}>✕</button>
                        </div>
                        <p style={{ fontSize: '0.65rem', color: '#94a3b8', margin: 0 }}>월 데이터가 없을 때 자동으로 채워지는 기본값입니다.</p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '280px', overflowY: 'auto' }}>
                            {defaultAmountItems.length === 0 ? (
                                <p style={{ fontSize: '0.75rem', color: '#94a3b8', textAlign: 'center', padding: '1rem 0' }}>약품 항목이 없습니다.</p>
                            ) : defaultAmountItems.map((item, idx) => (
                                <div key={item.name} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <span style={{ flex: 1, fontSize: '0.75rem', color: '#334155' }}>{item.name}</span>
                                    <input
                                        type="number"
                                        min="0"
                                        value={item.defaultAmount}
                                        onChange={e => {
                                            const updated = [...defaultAmountItems];
                                            updated[idx] = { ...updated[idx], defaultAmount: e.target.value === '' ? '' : Number(e.target.value) };
                                            setDefaultAmountItems(updated);
                                        }}
                                        style={{ width: '72px', height: '30px', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '0 8px', fontSize: '0.75rem', textAlign: 'right' }}
                                    />
                                    <span style={{ fontSize: '0.7rem', color: '#64748b', width: '20px' }}>kg</span>
                                </div>
                            ))}
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                            <button
                                onClick={() => setShowDefaultAmountModal(false)}
                                style={{ padding: '6px 16px', fontSize: '0.75rem', border: '1px solid #cbd5e1', borderRadius: '6px', background: '#f8fafc', cursor: 'pointer', color: '#475569' }}
                            >닫기</button>
                            <button
                                onClick={handleSaveDefaultAmounts}
                                disabled={isSavingDefaultAmounts}
                                style={{ padding: '6px 16px', fontSize: '0.75rem', border: 'none', borderRadius: '6px', background: '#1e293b', color: '#fff', cursor: isSavingDefaultAmounts ? 'not-allowed' : 'pointer', opacity: isSavingDefaultAmounts ? 0.6 : 1 }}
                            >{isSavingDefaultAmounts ? '저장 중...' : '저장'}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SettingsView;

