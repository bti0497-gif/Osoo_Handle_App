import React from 'react';
import { useDialog } from '../../components/common/DialogContext';
import { useCertificateViewModel } from './useCertificateViewModel';

const headerWrapStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    marginBottom: '12px',
};

const selectStyle = {
    height: '34px',
    border: '1px solid #cbd5e1',
    borderRadius: '8px',
    padding: '0 10px',
    fontSize: '13px',
    fontWeight: 700,
    color: '#334155',
    background: '#ffffff',
    outline: 'none',
};

const CertificateView = ({ currentUser }) => {
    const { showToast, showAlert } = useDialog();
    const {
        isPrivileged,
        isLoading,
        visibleRecords,
        selectedId,
        setSelectedId,
        selectedSite,
        setSelectedSite,
        siteOptions,
        fileInputRef,
        openFileDialog,
        handleUploadFiles,
        handleDownload,
    } = useCertificateViewModel(currentUser, { showToast, showAlert });

    return (
        <div style={{
            width: '100%',
            height: '100%',
            backgroundColor: '#ffffff',
            padding: '1.25rem',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            minHeight: 0,
        }}>
            <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                multiple
                style={{ display: 'none' }}
                onChange={handleUploadFiles}
            />

            <div style={headerWrapStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="material-icons" style={{ fontSize: '18px', color: '#475569' }}>description</span>
                    <strong style={{ color: '#1e293b', fontSize: '14px' }}>성적서 목록</strong>
                </div>
                {isPrivileged && (
                    <select
                        value={selectedSite}
                        onChange={(e) => setSelectedSite(e.target.value)}
                        style={{ ...selectStyle, minWidth: '180px' }}
                    >
                        {siteOptions.map((name) => (
                            <option key={name} value={name}>
                                {name === 'ALL' ? '전체 현장' : name}
                            </option>
                        ))}
                    </select>
                )}
            </div>

            <div style={{
                flex: 1,
                minHeight: 0,
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
            }}>
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: '2fr 1fr 1fr',
                    borderBottom: '1px solid #e2e8f0',
                    background: '#f8fafc',
                    fontSize: '12px',
                    fontWeight: 800,
                    color: '#475569',
                    padding: '10px 12px',
                }}>
                    <div>파일명 / 현장</div>
                    <div>채취일</div>
                    <div>발행일</div>
                </div>

                <div style={{ overflowY: 'auto', flex: 1 }}>
                    {visibleRecords.length === 0 ? (
                        <div style={{
                            height: '100%',
                            minHeight: '220px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#94a3b8',
                            fontWeight: 700,
                            fontSize: '13px',
                        }}>
                            {isLoading ? '성적서 목록을 불러오는 중...' : '표시할 성적서가 없습니다.'}
                        </div>
                    ) : (
                        visibleRecords.map((item) => {
                            const selected = item.id === selectedId;
                            return (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => setSelectedId(item.id)}
                                    style={{
                                        width: '100%',
                                        border: 'none',
                                        background: selected ? '#eff6ff' : '#ffffff',
                                        borderBottom: '1px solid #f1f5f9',
                                        padding: '10px 12px',
                                        display: 'grid',
                                        gridTemplateColumns: '2fr 1fr 1fr',
                                        textAlign: 'left',
                                        cursor: 'pointer',
                                        fontSize: '12px',
                                        color: '#1e293b',
                                    }}
                                >
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                        <span style={{ fontWeight: 700 }}>{item.fileName}</span>
                                        <span style={{ color: '#64748b', fontSize: '11px' }}>{item.siteName}</span>
                                    </div>
                                    <div style={{ color: '#334155' }}>{item.sampledAt}</div>
                                    <div style={{ color: '#334155' }}>{item.issuedAt}</div>
                                </button>
                            );
                        })
                    )}
                </div>
            </div>

            <div style={{
                borderTop: '1px solid #e2e8f0',
                paddingTop: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
            }}>
                <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 700 }}>
                    {isPrivileged
                        ? '중앙/최고관리자는 현장별 조회 및 성적서 업로드가 가능합니다.'
                        : '현장관리자는 본인 현장 성적서만 열람/다운로드할 수 있습니다.'}
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                        type="button"
                        onClick={handleDownload}
                        disabled={!selectedId}
                        style={{
                            height: '34px',
                            minWidth: '96px',
                            borderRadius: '8px',
                            border: '1px solid #cbd5e1',
                            background: selectedId ? '#ffffff' : '#f8fafc',
                            color: selectedId ? '#334155' : '#94a3b8',
                            fontWeight: 800,
                            fontSize: '12px',
                            cursor: selectedId ? 'pointer' : 'default',
                        }}
                    >
                        다운받기
                    </button>
                    {isPrivileged && (
                        <button
                            type="button"
                            onClick={openFileDialog}
                            style={{
                                height: '34px',
                                minWidth: '110px',
                                borderRadius: '8px',
                                border: 'none',
                                background: '#1e293b',
                                color: '#ffffff',
                                fontWeight: 800,
                                fontSize: '12px',
                                cursor: 'pointer',
                            }}
                        >
                            성적서 올리기
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CertificateView;
