import React from 'react';

export default function ItemManagementPanel({
    title,
    items,
    type,
    value,
    onValueChange,
    placeholder,
    addTitle,
    renderItemGrid,
    addItem,
    actionLabel,
    onAction,
}) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid #e2e8f0', borderRadius: '12px', backgroundColor: '#ffffff', boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.8rem 0.9rem', borderBottom: '1px solid #e2e8f0', backgroundColor: '#f8fafc', borderTopLeftRadius: '12px', borderTopRightRadius: '12px' }}>
                <h3 style={{ fontSize: '0.78rem', fontWeight: 900, color: '#1e293b', margin: 0 }}>{title}</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                    <span style={{ fontSize: '0.68rem', fontWeight: 800, color: '#475569', background: '#e2e8f0', borderRadius: '9999px', padding: '2px 8px' }}>
                        {items.filter((item) => item.checked).length}/{items.length}
                    </span>
                    {actionLabel && (
                        <button
                            onClick={onAction}
                            style={{ fontSize: '0.625rem', fontWeight: 700, color: '#475569', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '5px', padding: '3px 8px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                        >
                            {actionLabel}
                        </button>
                    )}
                </div>
            </div>
            <div style={{ padding: '0.7rem 0.9rem', minHeight: '180px' }}>
                {renderItemGrid(items, type)}
            </div>
            <div style={{ display: 'flex', gap: '0.4rem', padding: '0.7rem 0.9rem 0.9rem', borderTop: '1px solid #f1f5f9' }}>
                <input
                    placeholder={placeholder}
                    value={value}
                    onChange={(e) => onValueChange(e.target.value)}
                    style={{ flex: 1, border: '1px solid #cbd5e1', height: '34px', padding: '0 10px', borderRadius: '6px', fontSize: '0.75rem' }}
                />
                <button
                    onClick={() => addItem(type)}
                    style={{ width: '34px', height: '34px', backgroundColor: '#1e293b', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    title={addTitle}
                >
                    <span className="material-icons" style={{ fontSize: '18px' }}>add</span>
                </button>
            </div>
        </div>
    );
}
