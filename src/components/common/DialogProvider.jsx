import React, { createContext, useContext, useState, useCallback } from 'react';

const DialogContext = createContext();

export const useDialog = () => {
    const context = useContext(DialogContext);
    if (!context) {
        throw new Error('useDialog must be used within a DialogProvider');
    }
    return context;
};

export const DialogProvider = ({ children }) => {
    const [dialogs, setDialogs] = useState([]);

    const showAlert = useCallback((message, title = '알림') => {
        return new Promise((resolve) => {
            const id = Date.now() + Math.random().toString(36).substring(2, 9);
            setDialogs(prev => [...prev, { id, type: 'alert', title, message, resolve }]);
        });
    }, []);

    const showConfirm = useCallback((message, title = '확인') => {
        return new Promise((resolve) => {
            const id = Date.now() + Math.random().toString(36).substring(2, 9);
            setDialogs(prev => [...prev, { id, type: 'confirm', title, message, resolve }]);
        });
    }, []);

    const closeDialog = useCallback((id, result) => {
        setDialogs(prev => {
            const dialog = prev.find(d => d.id === id);
            if (dialog) {
                dialog.resolve(result);
            }
            return prev.filter(d => d.id !== id);
        });
    }, []);

    return (
        <DialogContext.Provider value={{ showAlert, showConfirm }}>
            {children}
            {dialogs.map((dialog, index) => (
                <div key={dialog.id} style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(15, 23, 42, 0.4)',
                    backdropFilter: 'blur(4px)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    zIndex: 9999 + index
                }}>
                    <div style={{
                        backgroundColor: 'white',
                        padding: '1.25rem',
                        borderRadius: '16px',
                        width: '420px',
                        maxWidth: 'calc(100vw - 32px)',
                        boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
                        display: 'flex', flexDirection: 'column', gap: '1rem',
                        animation: 'dialogFadeIn 0.2s ease-out'
                    }}>
                        <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#1e293b', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span className="material-icons" style={{ color: dialog.type === 'confirm' ? '#3b82f6' : '#f59e0b', fontSize: '20px' }}>
                                {dialog.type === 'confirm' ? 'help_outline' : 'info'}
                            </span>
                            {dialog.title}
                        </h3>
                        <p style={{ fontSize: '0.8125rem', color: '#475569', margin: 0, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'keep-all' }}>
                            {dialog.message}
                        </p>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
                            {dialog.type === 'confirm' && (
                                <button
                                    onClick={() => closeDialog(dialog.id, false)}
                                    style={{
                                        padding: '0.5rem 1rem',
                                        backgroundColor: '#f1f5f9',
                                        color: '#475569',
                                        border: '1px solid #cbd5e1',
                                        borderRadius: '8px',
                                        fontSize: '0.875rem',
                                        fontWeight: 700,
                                        cursor: 'pointer',
                                        transition: 'all 0.2s'
                                    }}
                                    onMouseEnter={e => e.currentTarget.style.backgroundColor = '#e2e8f0'}
                                    onMouseLeave={e => e.currentTarget.style.backgroundColor = '#f1f5f9'}
                                >
                                    취소
                                </button>
                            )}
                            <button
                                onClick={() => closeDialog(dialog.id, true)}
                                style={{
                                    padding: '0.5rem 1rem',
                                    backgroundColor: '#1e293b',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '8px',
                                    fontSize: '0.875rem',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    transition: 'all 0.2s'
                                }}
                                onMouseEnter={e => e.currentTarget.style.backgroundColor = '#0f172a'}
                                onMouseLeave={e => e.currentTarget.style.backgroundColor = '#1e293b'}
                            >
                                확인
                            </button>
                        </div>
                    </div>
                </div>
            ))}
            <style>{`
                @keyframes dialogFadeIn {
                    from { opacity: 0; transform: scale(0.95) translateY(-10px); }
                    to { opacity: 1; transform: scale(1) translateY(0); }
                }
            `}</style>
        </DialogContext.Provider>
    );
};
