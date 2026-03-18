import React from 'react';

// status 매핑 처리용
const statusIconMap = {
    pending: 'schedule',
    processing: 'sync',
    success: 'check_circle',
    error: 'error'
};

const statusTextMap = {
    pending: '대기 중',
    processing: '처리 중...',
    success: '완료',
    error: '오류'
};

const getStatusBadgeStyle = (status) => {
    let bg = '#f3f2f1';
    let color = '#605e5c';

    if (status === 'processing') {
        bg = '#e1dfdd';
        color = '#0078d4'; // Theme Primary
    } else if (status === 'success') {
        bg = '#dff6dd';
        color = '#107c10'; // Success
    } else if (status === 'error') {
        bg = '#fde7e9';
        color = '#a4262c'; // Error
    }

    return {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '2px 8px',
        borderRadius: '12px',
        fontSize: '12px',
        fontWeight: '600',
        backgroundColor: bg,
        color: color
    }; // Fluent UI style pills
};

/**
 * 일괄 작업(Batch) 진행 상태를 띄워주는 공통 다이얼로그 모듈
 * 
 * @param {Object} props
 * @param {boolean} props.isOpen UI 노출 여부
 * @param {string} props.title 작업의 제목
 * @param {Array} props.tasks 처리할 작업 항목들의 배열 ({id, title, status, message})
 * @param {number} props.progress 현재 진행률(0~100)
 * @param {boolean} props.isProcessing 작업이 진행 중인지 여부 (닫기 방지용)
 * @param {boolean} props.isFinished 작업이 모두 끝났는지 여부
 * @param {Function} props.onClose 닫기 버튼 클릭 핸들러 (작업 중엔 차단될 수 있음)
 */
export const BatchProgressDialog = ({
    isOpen,
    title = '일괄 작업 진행',
    tasks = [],
    progress = 0,
    isProcessing = false,
    isFinished = false,
    onClose
}) => {
    if (!isOpen) return null;

    const completedCount = tasks.filter(t => t.status === 'success').length;
    const errorCount = tasks.filter(t => t.status === 'error').length;

    return (
        <div style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.4)',
            backdropFilter: 'blur(2px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 10000,
            fontFamily: '"Segoe UI", "Segoe UI Web (West European)", -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", sans-serif'
        }}>
            <div style={{
                backgroundColor: 'white',
                borderRadius: '8px',
                width: '600px',
                maxWidth: 'calc(100vw - 32px)',
                maxHeight: 'calc(100vh - 64px)',
                boxShadow: '0 8px 16px rgba(0,0,0,0.14), 0 0 2px rgba(0,0,0,0.12)',
                display: 'flex', flexDirection: 'column',
                animation: 'dialogFadeIn 0.2s cubic-bezier(0.1, 0.9, 0.2, 1)',
                overflow: 'hidden'
            }}>
                <div style={{
                    padding: '20px 24px',
                    display: 'flex', alignItems: 'center', gap: '12px',
                    borderBottom: '1px solid #edebe9'
                }}>
                    <h3 style={{
                        fontSize: '20px', fontWeight: 600, color: '#323130',
                        margin: 0, display: 'flex', alignItems: 'center', gap: '10px'
                    }}>
                        <span className="material-icons" style={{ color: '#0078d4', fontSize: '24px' }}>
                            checklist_rtl
                        </span>
                        {title}
                    </h3>
                </div>
                
                <div style={{
                    padding: '0 24px 24px 24px',
                    display: 'flex', flexDirection: 'column', gap: '20px',
                    overflowY: 'auto', flex: 1, marginTop: '20px'
                }}>
                    <div className="custom-scrollbar" style={{
                        border: '1px solid #edebe9', borderRadius: '4px',
                        overflow: 'hidden', maxHeight: '300px', overflowY: 'auto'
                    }}>
                        <table style={{
                            width: '100%', borderCollapse: 'collapse', fontSize: '13px'
                        }}>
                            <thead>
                                <tr>
                                    <th style={{ backgroundColor: '#faf9f8', padding: '6px 12px', textAlign: 'left', fontWeight: 600, color: '#323130', borderBottom: '1px solid #edebe9', position: 'sticky', top: 0, zIndex: 1, width: '40%' }}>항목 이름</th>
                                    <th style={{ backgroundColor: '#faf9f8', padding: '6px 12px', textAlign: 'left', fontWeight: 600, color: '#323130', borderBottom: '1px solid #edebe9', position: 'sticky', top: 0, zIndex: 1, width: '25%' }}>상태</th>
                                    <th style={{ backgroundColor: '#faf9f8', padding: '6px 12px', textAlign: 'left', fontWeight: 600, color: '#323130', borderBottom: '1px solid #edebe9', position: 'sticky', top: 0, zIndex: 1, width: '35%' }}>메시지</th>
                                </tr>
                            </thead>
                            <tbody>
                                {tasks.map((task) => (
                                    <tr key={task.id} style={{ transition: 'background-color 0.15s' }} className="fluent-row">
                                        <td style={{ padding: '6px 12px', borderBottom: '1px solid #edebe9', color: '#323130', fontWeight: 400 }}>{task.title}</td>
                                        <td style={{ padding: '6px 12px', borderBottom: '1px solid #edebe9', color: '#323130' }}>
                                            <span style={getStatusBadgeStyle(task.status)}>
                                                <span 
                                                    className={`material-icons ${task.status === 'processing' ? 'rotating' : ''}`}
                                                    style={{ 
                                                        fontSize: '14px',
                                                        animation: task.status === 'processing' ? 'spin 1.5s linear infinite' : 'none' 
                                                    }}
                                                >
                                                    {statusIconMap[task.status] || 'help'}
                                                </span>
                                                {statusTextMap[task.status] || task.status}
                                            </span>
                                        </td>
                                        <td style={{ 
                                            padding: '6px 12px', borderBottom: '1px solid #edebe9',
                                            color: task.status === 'error' ? '#a4262c' : '#605e5c',
                                            fontSize: '12px'
                                        }}>
                                            {task.message || '-'}
                                        </td>
                                    </tr>
                                ))}
                                {tasks.length === 0 && (
                                    <tr>
                                        <td colSpan="3" style={{ padding: '24px', textAlign: 'center', color: '#a19f9d' }}>
                                            작업 항목이 없습니다.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '14px', fontWeight: 600, color: '#323130' }}>
                            <span>전체 진행 상태</span>
                            <span>
                                {completedCount} 완료 / {errorCount} 오류 / {tasks.length} 전체
                                {` (${progress}%)`}
                            </span>
                        </div>
                        <div style={{ height: '4px', backgroundColor: '#edebe9', borderRadius: '2px', overflow: 'hidden' }}>
                            <div style={{
                                height: '100%', backgroundColor: '#0078d4', borderRadius: '2px',
                                width: `${progress}%`, transition: 'width 0.3s cubic-bezier(0.1, 0.9, 0.2, 1)'
                            }} />
                        </div>
                    </div>
                </div>
                
                <div style={{
                    padding: '16px 24px', borderTop: '1px solid #edebe9',
                    display: 'flex', justifyContent: 'flex-end', backgroundColor: '#faf9f8'
                }}>
                    <button 
                        onClick={onClose} 
                        disabled={isProcessing}
                        style={{
                            padding: '6px 20px', backgroundColor: '#0078d4', color: 'white',
                            border: 'none', borderRadius: '4px', fontSize: '14px', fontWeight: 600,
                            cursor: isProcessing ? 'not-allowed' : 'pointer',
                            opacity: isProcessing ? 0.6 : 1, transition: 'background-color 0.2s',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                        }}
                        onMouseOver={(e) => { if (!isProcessing) e.currentTarget.style.backgroundColor = '#106ebe'; }}
                        onMouseOut={(e) => { if (!isProcessing) e.currentTarget.style.backgroundColor = '#0078d4'; }}
                    >
                        {isFinished ? '닫기' : (isProcessing ? '작업 중...' : '닫기')}
                    </button>
                </div>
            </div>
            <style>{`
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                @keyframes dialogFadeIn {
                    from { opacity: 0; transform: scale(0.95) translateY(-10px); }
                    to { opacity: 1; transform: scale(1) translateY(0); }
                }
                .fluent-row:hover {
                    background-color: #f3f2f1;
                }
                .custom-scrollbar::-webkit-scrollbar {
                    width: 6px;
                    height: 6px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background-color: #c8c6c4;
                    border-radius: 4px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background-color: #a19f9d;
                }
                .custom-scrollbar table tr:last-child td {
                    border-bottom: none !important;
                }
            `}</style>
        </div>
    );
};
