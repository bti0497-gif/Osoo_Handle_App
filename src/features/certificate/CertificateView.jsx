import React from 'react';
import { useDialog } from '../../components/common/DialogContext';
import { BatchProgressDialog } from '../../components/common/BatchProgressDialog';
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
        selectedYear,
        setSelectedYear,
        selectedMonth,
        setSelectedMonth,
        yearOptions,
        monthOptions,
        moveMonth,
        siteOptions,
        fileInputRef,
        openFileDialog,
        handleUploadFiles,
        handleDownload,
        handlePrint,
        batchProcess,
        selectedRecord,
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
                accept=".zip,application/zip"
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
                    gridTemplateColumns: '1fr',
                    borderBottom: '1px solid #e2e8f0',
                    background: '#f8fafc',
                    fontSize: '12px',
                    fontWeight: 800,
                    color: '#475569',
                    padding: '10px 12px',
                }}>
                    <div>파일명</div>
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
                                        gridTemplateColumns: '1fr',
                                        textAlign: 'left',
                                        cursor: 'pointer',
                                        fontSize: '12px',
                                        color: '#1e293b',
                                    }}
                                >
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                        <span style={{ fontWeight: 700 }}>{item.fileName}</span>
                                    </div>
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
                <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                        type="button"
                        onClick={() => moveMonth(-1)}
                        style={{
                            width: '30px',
                            height: '30px',
                            borderRadius: '8px',
                            border: '1px solid #cbd5e1',
                            background: '#ffffff',
                            color: '#334155',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                        aria-label="이전 달"
                    >
                        <span className="material-icons" style={{ fontSize: '18px' }}>chevron_left</span>
                    </button>

                    <select
                        value={selectedYear}
                        onChange={(e) => setSelectedYear(Number(e.target.value))}
                        style={{ ...selectStyle, minWidth: '96px' }}
                    >
                        {yearOptions.map((y) => (
                            <option key={y} value={y}>{y}년</option>
                        ))}
                    </select>

                    <select
                        value={selectedMonth}
                        onChange={(e) => setSelectedMonth(Number(e.target.value))}
                        style={{ ...selectStyle, minWidth: '88px' }}
                    >
                        {monthOptions.map((m) => (
                            <option key={m} value={m}>{m}월</option>
                        ))}
                    </select>

                    <button
                        type="button"
                        onClick={() => moveMonth(1)}
                        style={{
                            width: '30px',
                            height: '30px',
                            borderRadius: '8px',
                            border: '1px solid #cbd5e1',
                            background: '#ffffff',
                            color: '#334155',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                        aria-label="다음 달"
                    >
                        <span className="material-icons" style={{ fontSize: '18px' }}>chevron_right</span>
                    </button>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                        type="button"
                        onClick={handleDownload}
                        disabled={!selectedRecord?.downloadUrl}
                        style={{
                            height: '34px',
                            minWidth: '96px',
                            borderRadius: '8px',
                            border: '1px solid #cbd5e1',
                            background: selectedRecord?.downloadUrl ? '#ffffff' : '#f8fafc',
                            color: selectedRecord?.downloadUrl ? '#334155' : '#94a3b8',
                            fontWeight: 800,
                            fontSize: '12px',
                            cursor: selectedRecord?.downloadUrl ? 'pointer' : 'default',
                        }}
                    >
                        다운받기
                    </button>
                    <button
                        type="button"
                        onClick={handlePrint}
                        disabled={!selectedRecord?.downloadUrl}
                        style={{
                            height: '34px',
                            minWidth: '80px',
                            borderRadius: '8px',
                            border: '1px solid #cbd5e1',
                            background: selectedRecord?.downloadUrl ? '#ffffff' : '#f8fafc',
                            color: selectedRecord?.downloadUrl ? '#334155' : '#94a3b8',
                            fontWeight: 800,
                            fontSize: '12px',
                            cursor: selectedRecord?.downloadUrl ? 'pointer' : 'default',
                        }}
                    >
                        인쇄
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
                            추출 ZIP 업로드
                        </button>
                    )}
                </div>
            </div>

            <BatchProgressDialog
                isOpen={batchProcess.tasks.length > 0}
                title="성적서 ZIP 일괄 업로드"
                tasks={batchProcess.tasks}
                progress={batchProcess.progress}
                isProcessing={batchProcess.isProcessing}
                isFinished={batchProcess.isFinished}
                onClose={() => batchProcess.resetBatch()}
            />
        </div>
    );
};

export default CertificateView;
