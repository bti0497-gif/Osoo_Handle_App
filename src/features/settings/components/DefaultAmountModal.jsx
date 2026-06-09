import React from 'react';

export default function DefaultAmountModal({
    isOpen,
    title,
    items,
    setItems,
    unit,
    emptyMessage,
    isSaving,
    onClose,
    onSave,
    maxHeight,
}) {
    if (!isOpen) return null;

    return (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
            <div style={{ background: '#fff', borderRadius: '12px', boxShadow: '0 8px 32px rgba(0,0,0,0.18)', width: '340px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.875rem', fontWeight: 800, color: '#1e293b' }}>{title}</span>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '1.1rem', lineHeight: 1 }}>✕</button>
                </div>
                <p style={{ fontSize: '0.65rem', color: '#94a3b8', margin: 0 }}>월 데이터가 없을 때 자동으로 채워지는 기본값입니다.</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight, overflowY: maxHeight ? 'auto' : undefined }}>
                    {items.length === 0 ? (
                        <p style={{ fontSize: '0.75rem', color: '#94a3b8', textAlign: 'center', padding: '1rem 0' }}>{emptyMessage}</p>
                    ) : items.map((item, idx) => (
                        <div key={item.name} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ flex: 1, fontSize: '0.75rem', color: '#334155' }}>{item.name}</span>
                            <input
                                type="number"
                                min="0"
                                value={item.defaultAmount}
                                onChange={e => {
                                    const updated = [...items];
                                    updated[idx] = { ...updated[idx], defaultAmount: e.target.value === '' ? '' : Number(e.target.value) };
                                    setItems(updated);
                                }}
                                style={{ width: '72px', height: '30px', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '0 8px', fontSize: '0.75rem', textAlign: 'right' }}
                            />
                            <span style={{ fontSize: '0.7rem', color: '#64748b', width: '20px' }}>{unit}</span>
                        </div>
                    ))}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                    <button
                        onClick={onClose}
                        style={{ padding: '6px 16px', fontSize: '0.75rem', border: '1px solid #cbd5e1', borderRadius: '6px', background: '#f8fafc', cursor: 'pointer', color: '#475569' }}
                    >
                        닫기
                    </button>
                    <button
                        onClick={onSave}
                        disabled={isSaving}
                        style={{ padding: '6px 16px', fontSize: '0.75rem', border: 'none', borderRadius: '6px', background: '#1e293b', color: '#fff', cursor: isSaving ? 'not-allowed' : 'pointer', opacity: isSaving ? 0.6 : 1 }}
                    >
                        {isSaving ? '저장 중...' : '저장'}
                    </button>
                </div>
            </div>
        </div>
    );
}
