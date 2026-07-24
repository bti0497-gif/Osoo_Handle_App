import React from 'react';

const TEXT = {
    siteName: '\uD604\uC7A5\uBA85',
    managerName: '\uAD00\uB9AC\uC790\uBA85',
    method: '\uACF5\uBC95',
    series: '\uACC4\uC5F4\uC218',
    loadingSites: '\uD604\uC7A5 \uBAA9\uB85D \uBD88\uB7EC\uC624\uB294 \uC911...',
    selectSite: '\uD604\uC7A5\uC744 \uC120\uD0DD\uD558\uC138\uC694',
    autoFill: '\uD604\uC7A5 \uC120\uD0DD \uC2DC \uC790\uB3D9 \uC785\uB825',
};

export default function BasicSiteHeaderPanel({
    availableSites,
    selectedSiteId,
    isSiteListLoading,
    handleSiteSelection,
    siteInfo,
    showHistoryRestore = false,
    onOpenHistoryRestore,
    showMultiSiteToggle = false,
    multiSiteEnabled = false,
    isSavingMultiSiteMode = false,
    onMultiSiteModeChange,
}) {
    const labelStyle = {
        display: 'block',
        fontSize: '0.58rem',
        fontWeight: 900,
        color: '#64748b',
        marginBottom: '5px',
        textTransform: 'uppercase',
    };

    const controlStyle = {
        width: '100%',
        height: '34px',
        border: '1.5px solid #cbd5e1',
        borderRadius: '7px',
        padding: '0 10px',
        boxSizing: 'border-box',
        outline: 'none',
        fontSize: '0.75rem',
        fontWeight: 700,
    };

    const fields = [
        { label: TEXT.managerName, key: 'managerName' },
        { label: TEXT.method, key: 'method' },
        { label: TEXT.series, key: 'series' },
    ];

    return (
        <div
            style={{
                display: 'grid',
                gridTemplateColumns: `minmax(230px, 1fr) 120px 88px 88px${showHistoryRestore || showMultiSiteToggle ? ' minmax(300px, auto)' : ''}`,
                gap: '0.6rem',
                alignItems: 'end',
                justifyContent: 'start',
                backgroundColor: '#f8fafc',
                padding: '1rem',
                borderRadius: '10px',
                border: '1px solid #e2e8f0',
                overflowX: 'auto',
            }}
        >
            <div>
                <label style={labelStyle}>{TEXT.siteName}</label>
                <select
                    value={selectedSiteId}
                    onChange={(event) => handleSiteSelection(event.target.value)}
                    disabled={isSiteListLoading}
                    style={{
                        ...controlStyle,
                        color: selectedSiteId ? '#1e293b' : '#94a3b8',
                        backgroundColor: 'white',
                    }}
                >
                    <option value="">{isSiteListLoading ? TEXT.loadingSites : TEXT.selectSite}</option>
                    {availableSites.map((site) => (
                        <option key={site.id} value={site.id}>{site.site_name}</option>
                    ))}
                </select>
            </div>

            {fields.map((item) => (
                <div key={item.key}>
                    <label style={labelStyle}>{item.label}</label>
                    <input
                        type="text"
                        value={siteInfo[item.key] || ''}
                        readOnly
                        placeholder={TEXT.autoFill}
                        style={{
                            ...controlStyle,
                            color: siteInfo[item.key] ? '#1e293b' : '#94a3b8',
                            backgroundColor: '#f8fafc',
                        }}
                    />
                </div>
            ))}

            {showHistoryRestore || showMultiSiteToggle ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', minHeight: '34px' }}>
                    {showHistoryRestore ? (
                        <button
                            type="button"
                            onClick={onOpenHistoryRestore}
                            style={{
                                ...controlStyle,
                                width: 'auto',
                                minWidth: '112px',
                                borderColor: '#1e3a8a',
                                color: 'white',
                                backgroundColor: '#1e3a8a',
                                cursor: 'pointer',
                            }}
                        >
                            과거자료 복원
                        </button>
                    ) : null}
                    {showMultiSiteToggle ? (
                        <button
                            type="button"
                            role="switch"
                            aria-checked={multiSiteEnabled}
                            disabled={isSavingMultiSiteMode}
                            onClick={() => onMultiSiteModeChange?.(!multiSiteEnabled)}
                            title="한 PC에서 두 방향 현장을 통합 관리하도록 설정"
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.45rem',
                                height: '34px',
                                padding: '0 8px',
                                borderRadius: '7px',
                                border: `1.5px solid ${multiSiteEnabled ? '#2563eb' : '#cbd5e1'}`,
                                backgroundColor: multiSiteEnabled ? '#eff6ff' : '#fff',
                                color: multiSiteEnabled ? '#1d4ed8' : '#475569',
                                cursor: isSavingMultiSiteMode ? 'wait' : 'pointer',
                                fontSize: '0.68rem',
                                fontWeight: 800,
                                whiteSpace: 'nowrap',
                            }}
                        >
                            <span
                                aria-hidden="true"
                                style={{
                                    position: 'relative',
                                    display: 'inline-block',
                                    width: '30px',
                                    height: '17px',
                                    borderRadius: '999px',
                                    backgroundColor: multiSiteEnabled ? '#2563eb' : '#cbd5e1',
                                    transition: 'background-color 160ms ease',
                                }}
                            >
                                <span
                                    style={{
                                        position: 'absolute',
                                        top: '2px',
                                        left: multiSiteEnabled ? '15px' : '2px',
                                        width: '13px',
                                        height: '13px',
                                        borderRadius: '50%',
                                        backgroundColor: '#fff',
                                        boxShadow: '0 1px 2px rgba(15, 23, 42, 0.28)',
                                        transition: 'left 160ms ease',
                                    }}
                                />
                            </span>
                            {isSavingMultiSiteMode ? '저장 중...' : '양방향 통합관리'}
                        </button>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
