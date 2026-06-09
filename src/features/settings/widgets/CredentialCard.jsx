import React from 'react';

export default function CredentialCard({
    sectionKey,
    title,
    description,
    credential,
    isPasswordVisible,
    isUrlEditable,
    showUrlField = true,
    onFieldChange,
    onTogglePassword,
    onToggleUrlEditable,
    onSave,
}) {
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
                            onChange={(e) => onFieldChange(sectionKey, 'serviceUrl', e.target.value)}
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
                            onClick={() => onToggleUrlEditable(sectionKey)}
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
                        onChange={(e) => onFieldChange(sectionKey, 'userId', e.target.value)}
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
                            onChange={(e) => onFieldChange(sectionKey, 'password', e.target.value)}
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
                            onClick={() => onTogglePassword(sectionKey)}
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
                    onClick={() => onSave(sectionKey)}
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
}
