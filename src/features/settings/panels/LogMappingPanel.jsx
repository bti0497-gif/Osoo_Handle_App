import React from 'react';
import SludgeExportPanel from './SludgeExportPanel';

export default function LogMappingPanel({
  LOG_TYPES,
  selectedLogType,
  setSelectedLogType,
  siteInfo,
  flowOption,
  setFlowOption,
  handleSaveFlowOption,
  sludgeExportSettings,
  setSludgeExportSettings,
  isSavingSludgeExportSettings,
  handleSaveSludgeExportSettings,
}) {
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
                        {siteInfo.series === '2계열' ? (
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
                                    <option value="">선택하세요</option>
                                    <option value="single1">1계열값 매핑</option>
                                    <option value="single2">2계열값 매핑</option>
                                    <option value="combined">1+2계열값 매핑</option>
                                </select>
                                <button
                                    onClick={() => handleSaveFlowOption(flowOption)}
                                    disabled={!flowOption}
                                    style={{
                                        height: '36px',
                                        padding: '0 16px',
                                        border: 'none',
                                        borderRadius: '8px',
                                        backgroundColor: flowOption ? '#0284c7' : '#94a3b8',
                                        color: 'white',
                                        fontSize: '0.75rem',
                                        fontWeight: 800,
                                        cursor: flowOption ? 'pointer' : 'not-allowed',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                        transition: 'background-color 0.15s'
                                    }}
                                    onMouseEnter={e => {
                                        if (flowOption) e.target.style.backgroundColor = '#0369a1';
                                    }}
                                    onMouseLeave={e => {
                                        e.target.style.backgroundColor = flowOption ? '#0284c7' : '#94a3b8';
                                    }}
                                >
                                    <span className="material-icons" style={{ fontSize: '14px' }}>save</span>
                                    저장
                                </button>
                            </div>
                        ) : (
                            <div style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '8px',
                                backgroundColor: '#e0f2fe',
                                border: '1px solid #bae6fd',
                                borderRadius: '9999px',
                                padding: '6px 12px',
                                width: 'fit-content'
                            }}>
                                <span className="material-icons" style={{ fontSize: '16px', color: '#0369a1' }}>check_circle</span>
                                <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#0c4a6e' }}>
                                    1계열 기본값(1계열값 매핑) 자동 적용
                                </span>
                            </div>
                        )}
                        <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>
                            {siteInfo.series === '2계열'
                                ? '2계열 현장입니다. 내부/외부 반송 유량의 매핑 방식을 선택하세요.'
                                : '1계열 현장입니다. 기본값(1계열값 매핑)이 적용됩니다.'}
                        </span>
                    </div>
                )}

                {/* 슬러지반출관리대장 기본설정 */}
                {selectedLogType === 'sludge_export_ledger' && (
                    <SludgeExportPanel
                        sludgeExportSettings={sludgeExportSettings}
                        setSludgeExportSettings={setSludgeExportSettings}
                        isSavingSludgeExportSettings={isSavingSludgeExportSettings}
                        handleSaveSludgeExportSettings={handleSaveSludgeExportSettings}
                    />
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


    return renderLogMappingSettings();
}
