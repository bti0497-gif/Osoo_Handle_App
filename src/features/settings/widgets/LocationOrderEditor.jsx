import React from 'react';

export default function LocationOrderEditor({
    items,
    isSiteSelected,
    onToggle,
    onMove,
}) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', padding: '0.25rem 0' }}>
            {items.map((item, index) => (
                <div
                    key={`${item.name}-${index}`}
                    onClick={() => {
                        if (!isSiteSelected) return;
                        onToggle('location', index);
                    }}
                    style={{
                        display: 'grid',
                        gridTemplateColumns: '24px 1fr 58px',
                        gap: '0.35rem',
                        alignItems: 'center',
                        cursor: isSiteSelected ? 'pointer' : 'not-allowed',
                        opacity: isSiteSelected ? 1 : 0.65
                    }}
                >
                    <span
                        className="material-icons"
                        style={{
                            fontSize: '18px',
                            color: item.checked ? '#1e293b' : '#cbd5e1',
                            transition: 'color 0.2s'
                        }}
                    >
                        {item.checked ? 'check_box' : 'check_box_outline_blank'}
                    </span>
                    <span style={{
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        color: item.checked ? '#334155' : '#94a3b8',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                    }}>
                        {item.name}
                    </span>
                    <div style={{ display: 'flex', gap: '3px', justifyContent: 'flex-end' }}>
                        <button
                            type="button"
                            disabled={!isSiteSelected || index === 0}
                            onClick={(e) => {
                                e.stopPropagation();
                                onMove(index, -1);
                            }}
                            title="위로 이동"
                            style={{
                                width: '26px',
                                height: '26px',
                                border: '1px solid #cbd5e1',
                                borderRadius: '5px',
                                background: 'white',
                                color: index === 0 ? '#cbd5e1' : '#475569',
                                cursor: !isSiteSelected || index === 0 ? 'not-allowed' : 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: 0
                            }}
                        >
                            <span className="material-icons" style={{ fontSize: '16px' }}>keyboard_arrow_up</span>
                        </button>
                        <button
                            type="button"
                            disabled={!isSiteSelected || index === items.length - 1}
                            onClick={(e) => {
                                e.stopPropagation();
                                onMove(index, 1);
                            }}
                            title="아래로 이동"
                            style={{
                                width: '26px',
                                height: '26px',
                                border: '1px solid #cbd5e1',
                                borderRadius: '5px',
                                background: 'white',
                                color: index === items.length - 1 ? '#cbd5e1' : '#475569',
                                cursor: !isSiteSelected || index === items.length - 1 ? 'not-allowed' : 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: 0
                            }}
                        >
                            <span className="material-icons" style={{ fontSize: '16px' }}>keyboard_arrow_down</span>
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
}
