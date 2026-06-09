import React from 'react';

export default function SludgeExportPanel({
    sludgeExportSettings,
    setSludgeExportSettings,
    isSavingSludgeExportSettings,
    handleSaveSludgeExportSettings,
}) {
    return (
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
                        onChange={(e) => setSludgeExportSettings((prev) => ({ ...prev, companyName: e.target.value }))}
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
                        onChange={(e) => setSludgeExportSettings((prev) => ({ ...prev, defaultAmount: e.target.value === '' ? '' : Number(e.target.value) }))}
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
    );
}
