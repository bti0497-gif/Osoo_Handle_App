import React from 'react';

export default function TemplateUploadCard({
    label,
    value,
    title,
    placeholder,
    buttonLabel,
    icon,
    accept,
    multiple = false,
    status,
    onFileChange,
    onOpenFolder,
    openFolderTitle = '저장 폴더 열기',
}) {
    const borderColor = status?.status === 'ready'
        ? '#86efac'
        : status?.status === 'not-found'
            ? '#fca5a5'
            : '#cbd5e1';
    const backgroundColor = status?.status === 'ready'
        ? '#f0fdf4'
        : status?.status === 'not-found'
            ? '#fef2f2'
            : '#fcfcfc';

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <div style={{ flex: 1, position: 'relative' }}>
                    <label style={{ display: 'block', fontSize: '0.625rem', fontWeight: 900, color: '#64748b', marginBottom: '4px', position: 'absolute', top: '-18px' }}>
                        {label}
                    </label>
                    <input
                        readOnly
                        value={value}
                        title={title || value}
                        placeholder={placeholder}
                        style={{
                            width: '100%',
                            height: '50px',
                            border: `1.5px dashed ${borderColor}`,
                            borderRadius: '12px',
                            padding: onOpenFolder ? '0 48px 0 12px' : '0 12px',
                            fontSize: '0.8125rem',
                            fontWeight: 700,
                            backgroundColor,
                            color: '#475569',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                        }}
                    />
                    {onOpenFolder && (
                        <button
                            type="button"
                            title={openFolderTitle}
                            aria-label={openFolderTitle}
                            onClick={onOpenFolder}
                            style={{
                                position: 'absolute',
                                right: '8px',
                                top: '50%',
                                transform: 'translateY(-50%)',
                                width: '34px',
                                height: '34px',
                                border: '1px solid #cbd5e1',
                                borderRadius: '8px',
                                backgroundColor: '#f8fafc',
                                color: '#475569',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'pointer',
                                transition: 'all 0.1s',
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = '#e2e8f0';
                                e.currentTarget.style.color = '#1e293b';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = '#f8fafc';
                                e.currentTarget.style.color = '#475569';
                            }}
                        >
                            <span className="material-icons" style={{ fontSize: '18px' }}>folder_open</span>
                        </button>
                    )}
                </div>
                <label
                    style={{
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
                        transition: 'all 0.1s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#e2e8f0'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#f1f5f9'; }}
                >
                    <span className="material-icons" style={{ fontSize: '18px' }}>{icon}</span>
                    {buttonLabel}
                    <input
                        type="file"
                        multiple={multiple}
                        accept={accept}
                        style={{ display: 'none' }}
                        onChange={(e) => {
                            onFileChange?.(multiple ? Array.from(e.target.files) : e.target.files[0]);
                            if (multiple) e.target.value = '';
                        }}
                    />
                </label>
            </div>

            {status?.status && status.status !== 'idle' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingLeft: '4px' }}>
                    {(status.status === 'loading' || status.status === 'uploading') && (
                        <>
                            <div style={{ width: '14px', height: '14px', border: '2px solid #e2e8f0', borderTopColor: '#64748b', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />
                            <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#64748b' }}>
                                {status.status === 'uploading' ? '엑셀 원본 데이터를 저장하는 중입니다...' : '상태 확인 중...'}
                            </span>
                        </>
                    )}
                    {status.status === 'ready' && (
                        <>
                            <span className="material-icons" style={{ fontSize: '16px', color: '#16a34a' }}>check_circle</span>
                            <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#16a34a' }}>
                                데이터 준비 완료 &mdash; {status.sheets.length}개 시트
                                {status.sheets.length > 0 && ` (${status.sheets.join(', ')})`}
                            </span>
                        </>
                    )}
                    {status.status === 'not-found' && (
                        <>
                            <span className="material-icons" style={{ fontSize: '16px', color: '#dc2626' }}>error</span>
                            <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#dc2626' }}>파일을 찾을 수 없습니다. 파일을 다시 선택해주세요.</span>
                        </>
                    )}
                    {status.status === 'error' && (
                        <>
                            <span className="material-icons" style={{ fontSize: '16px', color: '#dc2626' }}>error</span>
                            <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#dc2626' }}>로드 실패. 파일을 다시 선택해주세요.</span>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
