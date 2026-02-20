import React from 'react';
import { useSettingsViewModel } from './useSettingsViewModel';

const SettingsView = ({ currentUser }) => {
    const vm = useSettingsViewModel(currentUser);
    const {
        activeTab, setActiveTab, isLoading,
        siteInfo, setSiteInfo, handleSeriesChange,
        flowItems, medicineItems, waterItems,
        newFlowItem, setNewFlowItem, newMedicineItem, setNewMedicineItem,
        addItem, toggleItem,
        excelFileName, templateFileNames,
        handleExcelFileUpload, handleTemplateFileChange,
        flowConfig, setFlowConfig, flowMapping, setFlowMapping,
        medicineConfig, setMedicineConfig, medicineMapping, setMedicineMapping,
        kitConfig, setKitConfig, kitMapping, setKitMapping,
        excelSheets, sampleRowData,
        excelStatus, isMetadataLoading, isPreviewLoading, isUploading,
        importProgress, setImportProgress, importedData, showDataModal, setShowDataModal,
        handleSaveFlowMapping, handleSaveMedicineMapping, handleSaveKitMapping,
        handleApply,
        alphabet,
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
                            onChange={(e) => setFlowConfig({...flowConfig, sheet: e.target.value})}
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
                                setFlowConfig({...flowConfig, startRow: start, endRow: start + 30});
                            }}
                            style={{ width: '100%', height: '40px', border: '1.5px solid #cbd5e1', borderRadius: '8px', padding: '0 12px', fontSize: '0.8125rem', fontWeight: 700 }}
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.625rem', fontWeight: 900, color: '#64748b', marginBottom: '6px' }}>데이터 종료 행</label>
                        <input 
                            type="number"
                            value={flowConfig.endRow}
                            onChange={(e) => setFlowConfig({...flowConfig, endRow: parseInt(e.target.value) || 31})}
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
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', position: 'relative' }}>
                        {/* 프리뷰 로딩 오버레이 */}
                        {isPreviewLoading && (
                            <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(248,250,252,0.85)', borderRadius: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 5, gap: '10px' }}>
                                <div style={{ width: '28px', height: '28px', border: '3px solid #e2e8f0', borderTopColor: '#1e293b', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b' }}>시작행 데이터 불러오는 중...</span>
                            </div>
                        )}
                        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', padding: '0 12px', borderBottom: '2px solid #1e293b', paddingBottom: '8px' }}>
                            <span style={{ fontSize: '0.75rem', fontWeight: 900, color: '#1e293b' }}>검침항목 이름</span>
                            <span style={{ fontSize: '0.75rem', fontWeight: 900, color: '#1e293b' }}>엑셀 칼럼 선택</span>
                            <span style={{ fontSize: '0.75rem', fontWeight: 900, color: '#1e293b' }}>시작행 데이터 프리뷰</span>
                        </div>

                        {/* 매칭 리스트 본문 */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {rows.map((row, idx) => (
                                <div key={idx} style={{ 
                                    display: 'grid', 
                                    gridTemplateColumns: '1.2fr 1fr 1fr', 
                                    padding: '12px', 
                                    backgroundColor: idx % 2 === 0 ? '#fff' : '#f8fafc',
                                    borderRadius: '8px',
                                    alignItems: 'center',
                                    border: '1px solid #f1f5f9'
                                }}>
                                    <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#334155' }}>{row.name}</span>
                                    <select 
                                        value={row.isDate ? (flowConfig.dateCol || 'A') : (flowMapping[row.name] || '')}
                                        onChange={(e) => {
                                            if (row.isDate) {
                                                setFlowConfig({...flowConfig, dateCol: e.target.value});
                                            } else {
                                                setFlowMapping({...flowMapping, [row.name]: e.target.value});
                                            }
                                        }}
                                        style={{ width: '120px', height: '34px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700 }}
                                    >
                                        <option value="">선택...</option>
                                        {alphabet.map(l => <option key={l} value={l}>{l}열</option>)}
                                    </select>
                                    <span style={{ 
                                        fontSize: '0.75rem', 
                                        fontWeight: 700, 
                                        color: (row.isDate ? flowConfig.dateCol : flowMapping[row.name]) ? '#059669' : '#94a3b8',
                                        backgroundColor: (row.isDate ? flowConfig.dateCol : flowMapping[row.name]) ? '#f0fdf4' : '#f1f5f9',
                                        padding: '6px 10px',
                                        borderRadius: '6px',
                                        width: 'fit-content',
                                        minWidth: '100px',
                                        textAlign: 'center'
                                    }}>
                                        {(row.isDate ? sampleRowData[flowConfig.dateCol] : sampleRowData[flowMapping[row.name]]) || '-- No Data --'}
                                    </span>
                                </div>
                            ))}
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
                            onClick={() => {
                                const isAllMapped = rows.every(r => r.isDate ? flowConfig.dateCol : flowMapping[r.name]);
                                if (!isAllMapped) {
                                    alert("모든 항목의 콤보박스 선택이 완료되어야 저장할 수 있습니다.");
                                    return;
                                }
                                if (window.confirm("기존 유량데이터를 데이터베이스에 저장하시겠습니까?")) {
                                    handleSaveFlowMapping();
                                }
                            }}
                            disabled={!rows.every(r => r.isDate ? flowConfig.dateCol : flowMapping[r.name])}
                            style={{
                                width: '240px',
                                height: '50px',
                                backgroundColor: rows.every(r => r.isDate ? flowConfig.dateCol : flowMapping[r.name]) ? '#1e293b' : '#cbd5e1',
                                color: 'white',
                                border: 'none',
                                borderRadius: '12px',
                                fontSize: '0.9375rem',
                                fontWeight: 900,
                                cursor: rows.every(r => r.isDate ? flowConfig.dateCol : flowMapping[r.name]) ? 'pointer' : 'not-allowed',
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
                            onChange={(e) => setMedicineConfig({...medicineConfig, sheet: e.target.value})}
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
                            onChange={(e) => { const s = parseInt(e.target.value) || 1; setMedicineConfig({...medicineConfig, startRow: s, endRow: s + 30}); }}
                            style={{ width: '100%', height: '40px', border: '1.5px solid #cbd5e1', borderRadius: '8px', padding: '0 12px', fontSize: '0.8125rem', fontWeight: 700 }}
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.625rem', fontWeight: 900, color: '#64748b', marginBottom: '6px' }}>데이터 종료 행</label>
                        <input type="number" value={medicineConfig.endRow}
                            onChange={(e) => setMedicineConfig({...medicineConfig, endRow: parseInt(e.target.value) || 31})}
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
                                        <select value={dateCol || 'A'} onChange={(e) => setMedicineConfig({...medicineConfig, dateCol: e.target.value})}
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
                                                        <select value={colKey} onChange={(e) => setMedicineMapping({...medicineMapping, [row.key]: e.target.value})}
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
                            style={{ width: '160px', height: '50px', backgroundColor: importedData ? '#f1f5f9' : '#f8fafc', color: importedData ? '#1e293b' : '#cbd5e1',
                                border: '1.5px solid #cbd5e1', borderRadius: '12px', fontSize: '0.9375rem', fontWeight: 900,
                                cursor: importedData ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                            <span className="material-icons">visibility</span>저장된 데이타보기
                        </button>
                        <button
                            onClick={() => {
                                if (!allMapped) { alert("모든 약품 항목의 칼럼 선택이 완료되어야 저장할 수 있습니다."); return; }
                                if (window.confirm("기존 약품 데이터를 데이터베이스에 저장하시겠습니까?")) handleSaveMedicineMapping();
                            }}
                            disabled={!allMapped}
                            style={{ width: '240px', height: '50px', backgroundColor: allMapped ? '#1e293b' : '#cbd5e1', color: 'white',
                                border: 'none', borderRadius: '12px', fontSize: '0.9375rem', fontWeight: 900,
                                cursor: allMapped ? 'pointer' : 'not-allowed', transition: 'all 0.2s',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                            <span className="material-icons">medication</span>약품 데이터 저장하기
                        </button>
                    </div>
                )}
            </div>
        );
    };

    const renderKitSettings = () => {
        // 분석키트는 수질 분석과는 별개로 TN, TP, COD 등을 관리할 수 있도록 기본 항목을 상정합니다.
        const kitItems = [
            { name: 'T-N (총질소)' },
            { name: 'T-P (총인)' },
            { name: 'COD (화학적산소요구량)' },
            { name: 'SS (부유물질)' }
        ];

        const rows = [
            { name: '날짜 (Date)', isDate: true },
            ...kitItems.map(item => ({ name: item.name, isDate: false }))
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
                            value={kitConfig.sheet}
                            onChange={(e) => setKitConfig({...kitConfig, sheet: e.target.value})}
                            disabled={isMetadataLoading}
                            style={{ width: '100%', height: '40px', border: '1.5px solid #cbd5e1', borderRadius: '8px', padding: '0 12px', fontSize: '0.8125rem', fontWeight: 700, opacity: isMetadataLoading ? 0.5 : 1 }}
                        >
                            <option value="">{isMetadataLoading ? '시트 목록 불러오는 중...' : '시트를 선택하세요...'}</option>
                            {excelSheets.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.625rem', fontWeight: 900, color: '#64748b', marginBottom: '6px' }}>데이터 시작 행</label>
                        <input 
                            type="number"
                            value={kitConfig.startRow}
                            onChange={(e) => {
                                const start = parseInt(e.target.value) || 1;
                                setKitConfig({...kitConfig, startRow: start, endRow: start + 30});
                            }}
                            style={{ width: '100%', height: '40px', border: '1.5px solid #cbd5e1', borderRadius: '8px', padding: '0 12px', fontSize: '0.8125rem', fontWeight: 700 }}
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.625rem', fontWeight: 900, color: '#64748b', marginBottom: '6px' }}>데이터 종료 행</label>
                        <input 
                            type="number"
                            value={kitConfig.endRow}
                            onChange={(e) => setKitConfig({...kitConfig, endRow: parseInt(e.target.value) || 31})}
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
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', position: 'relative' }}>
                        {/* 프리뷰 로딩 오버레이 */}
                        {isPreviewLoading && (
                            <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(248,250,252,0.85)', borderRadius: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 5, gap: '10px' }}>
                                <div style={{ width: '28px', height: '28px', border: '3px solid #e2e8f0', borderTopColor: '#1e293b', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b' }}>시작행 데이터 불러오는 중...</span>
                            </div>
                        )}
                        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', padding: '0 12px', borderBottom: '2px solid #1e293b', paddingBottom: '8px' }}>
                            <span style={{ fontSize: '0.75rem', fontWeight: 900, color: '#1e293b' }}>키트 항목</span>
                            <span style={{ fontSize: '0.75rem', fontWeight: 900, color: '#1e293b' }}>엑셀 칼럼 선택</span>
                            <span style={{ fontSize: '0.75rem', fontWeight: 900, color: '#1e293b' }}>시작행 데이터 프리뷰</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {rows.map((row, idx) => (
                                <div key={idx} style={{ 
                                    display: 'grid', 
                                    gridTemplateColumns: '1.2fr 1fr 1fr', 
                                    padding: '12px', 
                                    backgroundColor: idx % 2 === 0 ? '#fff' : '#f8fafc',
                                    borderRadius: '8px',
                                    alignItems: 'center',
                                    border: '1px solid #f1f5f9'
                                }}>
                                    <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#334155' }}>{row.name}</span>
                                    <select 
                                        value={row.isDate ? kitConfig.dateCol : kitMapping[row.name]}
                                        onChange={(e) => {
                                            if (row.isDate) setKitConfig({...kitConfig, dateCol: e.target.value});
                                            else setKitMapping({...kitMapping, [row.name]: e.target.value});
                                        }}
                                        style={{ width: '120px', height: '34px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700 }}
                                    >
                                        <option value="">선택...</option>
                                        {alphabet.map(l => <option key={l} value={l}>{l}열</option>)}
                                    </select>
                                    <span style={{ 
                                        fontSize: '0.75rem', fontWeight: 700,
                                        color: (row.isDate ? kitConfig.dateCol : kitMapping[row.name]) ? '#059669' : '#94a3b8',
                                        backgroundColor: (row.isDate ? kitConfig.dateCol : kitMapping[row.name]) ? '#f0fdf4' : '#f1f5f9',
                                        padding: '6px 10px', borderRadius: '6px', minWidth: '100px', textAlign: 'center'
                                    }}>
                                        {(row.isDate ? sampleRowData[kitConfig.dateCol] : sampleRowData[kitMapping[row.name]]) || '-- No Data --'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                
                {kitConfig.sheet && (
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
                            onClick={() => {
                                const isAllMapped = rows.every(r => r.isDate ? kitConfig.dateCol : kitMapping[r.name]);
                                if (!isAllMapped) {
                                    alert("모든 항목의 콤보박스 선택이 완료되어야 저장할 수 있습니다.");
                                    return;
                                }
                                if (window.confirm("기존 분석 데이터를 데이터베이스에 저장하시겠습니까?")) {
                                    handleSaveKitMapping();
                                }
                            }}
                            disabled={!rows.every(r => r.isDate ? kitConfig.dateCol : kitMapping[r.name])}
                            style={{
                                width: '240px', height: '50px',
                                backgroundColor: rows.every(r => r.isDate ? kitConfig.dateCol : kitMapping[r.name]) ? '#1e293b' : '#cbd5e1',
                                color: 'white', border: 'none', borderRadius: '12px', fontSize: '0.9375rem', fontWeight: 900,
                                cursor: rows.every(r => r.isDate ? kitConfig.dateCol : kitMapping[r.name]) ? 'pointer' : 'not-allowed',
                                transition: 'all 0.2s',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
                            }}
                        >
                            <span className="material-icons">science</span>
                            키트 데이터 저장하기
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

            {/* 중간 섹션: 3 Columns */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '2rem' }}>
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
                    <h3 style={{ fontSize: '0.75rem', fontWeight: 900, color: '#1e293b', paddingBottom: '0.6rem', borderBottom: '2px solid #1e293b', marginBottom: '0.75rem' }}>약품항목</h3>
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

                {/* Column 3: 수질항목 */}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <h3 style={{ fontSize: '0.75rem', fontWeight: 900, color: '#1e293b', paddingBottom: '0.6rem', borderBottom: '2px solid #1e293b', marginBottom: '0.75rem' }}>수질항목</h3>
                    {renderItemGrid(waterItems, 'water')}
                    <p style={{ marginTop: '0.75rem', fontSize: '0.625rem', color: '#94a3b8', fontWeight: 600, lineHeight: 1.4 }}>* 수질은 관리 양식에 맞춰 고정되어 관리됩니다.</p>
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
                                placeholder="보고서 양식들을 선택해주세요 (Excel, HWPX)..."
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
                                onChange={(e) => handleTemplateFileChange(Array.from(e.target.files))}
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
                            { id: 'kit', label: '키트설정' }
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
                         activeTab === 'kit' ? renderKitSettings() : (
                            <div style={{ padding: '4rem 0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#cbd5e1', gap: '1rem' }}>
                                <span className="material-icons" style={{ fontSize: '48px' }}>construction</span>
                                <span style={{ fontWeight: 700, fontSize: '1.125rem' }}>준비 중인 메뉴입니다.</span>
                            </div>
                        )}
                    </div>
                    {renderImportProgress()}
                    {renderDataModal()}
                </div>
            )}
        </div>
    );
};

export default SettingsView;

