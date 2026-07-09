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
                gridTemplateColumns: 'minmax(260px, 360px) 140px 110px 110px',
                gap: '0.75rem',
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
        </div>
    );
}
