import React, { useEffect, useMemo, useState } from 'react';

const TAB_META = [
    { id: 'flow', label: '유량관리' },
    { id: 'medicine', label: '약품관리' },
    { id: 'water', label: '수질분석' },
    { id: 'kit', label: '키트관리' },
];

const toNumberOrNull = (value) => {
    if (value === '' || value === null || value === undefined) return null;
    const parsed = Number(String(value).replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
};

const formatValue = (value) => {
    if (value === null || value === undefined || value === '') return '-';
    if (Number.isFinite(Number(value))) return Number(value).toLocaleString();
    return String(value);
};

const inputStyle = {
    height: 36,
    border: '1px solid #cbd5e1',
    borderRadius: 6,
    padding: '0 10px',
    fontSize: 13,
    fontWeight: 700,
    color: '#0f172a',
    textAlign: 'right',
    background: '#fff',
};

const labelStyle = {
    fontSize: 12,
    fontWeight: 800,
    color: '#475569',
};

function buildInitialDraft(tabId, item) {
    if (!item) return {};
    if (tabId === 'flow') {
        return {
            reading: item.values?.reading ?? '',
            calculatedFlow: item.values?.flow ?? '',
        };
    }
    if (tabId === 'medicine' || tabId === 'kit') {
        return {
            purchase: item.values?.purchase ?? '',
            usage: item.values?.usage ?? '',
            inventory: item.values?.inventory ?? '',
        };
    }
    return {
        result: item.values?.result ?? '',
    };
}

export default function UnifiedRecordModal({
    isOpen,
    mode = 'add',
    initialTab = 'flow',
    initialDate = '',
    contexts = {},
    onClose,
    onSaveDraft,
}) {
    const [activeTab, setActiveTab] = useState(initialTab);
    const [date, setDate] = useState(initialDate);
    const [selectedByTab, setSelectedByTab] = useState({});
    const [draft, setDraft] = useState({});

    useEffect(() => {
        if (!isOpen) return;
        setActiveTab(initialTab);
        setDate(initialDate);
        setSelectedByTab({});
        setDraft({});
    }, [isOpen, initialTab, initialDate]);

    const currentItems = useMemo(() => contexts[activeTab]?.items || [], [contexts, activeTab]);
    const selectedKey = selectedByTab[activeTab] || currentItems[0]?.key || '';
    const selectedItem = currentItems.find((item) => item.key === selectedKey) || currentItems[0] || null;
    const draftKey = `${activeTab}:${selectedItem?.key || ''}`;
    const currentDraft = draft[draftKey] || buildInitialDraft(activeTab, selectedItem);

    useEffect(() => {
        if (!selectedItem) return;
        setSelectedByTab((prev) => ({ ...prev, [activeTab]: selectedItem.key }));
    }, [activeTab, selectedItem]);

    if (!isOpen) return null;

    const setDraftField = (field, value) => {
        setDraft((prev) => {
            const nextDraft = {
                ...(prev[draftKey] || buildInitialDraft(activeTab, selectedItem)),
                [field]: value,
            };

            if (activeTab === 'flow' && field === 'reading') {
                const reading = toNumberOrNull(value);
                const previousReading = toNumberOrNull(selectedItem?.previous?.reading);
                if (reading !== null && previousReading !== null) {
                    nextDraft.calculatedFlow = Math.round((reading - previousReading) * 10) / 10;
                }
            }

            if ((activeTab === 'medicine' || activeTab === 'kit') && (field === 'purchase' || field === 'usage')) {
                const previousInventory = toNumberOrNull(selectedItem?.previous?.inventory) || 0;
                const purchase = toNumberOrNull(field === 'purchase' ? value : nextDraft.purchase) || 0;
                const usage = toNumberOrNull(field === 'usage' ? value : nextDraft.usage) || 0;
                nextDraft.inventory = Math.round((previousInventory + purchase - usage) * 10) / 10;
            }

            return { ...prev, [draftKey]: nextDraft };
        });
    };

    const handleSelectItem = (key) => {
        setSelectedByTab((prev) => ({ ...prev, [activeTab]: key }));
    };

    const handleSave = () => {
        onSaveDraft?.({
            mode,
            tab: activeTab,
            date,
            item: selectedItem,
            values: currentDraft,
        });
    };

    const renderFields = () => {
        if (!selectedItem) {
            return (
                <div style={{ padding: 24, color: '#94a3b8', fontWeight: 700, fontSize: 13 }}>
                    선택할 항목이 없습니다.
                </div>
            );
        }

        if (activeTab === 'flow') {
            return (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                    <label style={{ display: 'grid', gap: 6 }}>
                        <span style={labelStyle}>검침값</span>
                        <input style={inputStyle} value={currentDraft.reading} onChange={(e) => setDraftField('reading', e.target.value)} />
                    </label>
                    <label style={{ display: 'grid', gap: 6 }}>
                        <span style={labelStyle}>유량 계산값</span>
                        <input style={{ ...inputStyle, background: '#f8fafc' }} value={currentDraft.calculatedFlow} onChange={(e) => setDraftField('calculatedFlow', e.target.value)} />
                    </label>
                </div>
            );
        }

        if (activeTab === 'medicine' || activeTab === 'kit') {
            return (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
                    <label style={{ display: 'grid', gap: 6 }}>
                        <span style={labelStyle}>{activeTab === 'kit' ? '구매' : '입고'}</span>
                        <input style={inputStyle} value={currentDraft.purchase} onChange={(e) => setDraftField('purchase', e.target.value)} />
                    </label>
                    <label style={{ display: 'grid', gap: 6 }}>
                        <span style={labelStyle}>사용</span>
                        <input style={inputStyle} value={currentDraft.usage} onChange={(e) => setDraftField('usage', e.target.value)} />
                    </label>
                    <label style={{ display: 'grid', gap: 6 }}>
                        <span style={labelStyle}>재고</span>
                        <input style={{ ...inputStyle, background: '#f8fafc' }} value={currentDraft.inventory} onChange={(e) => setDraftField('inventory', e.target.value)} />
                    </label>
                </div>
            );
        }

        return (
            <label style={{ display: 'grid', gap: 6 }}>
                <span style={labelStyle}>측정결과</span>
                <input style={{ ...inputStyle, textAlign: 'left' }} value={currentDraft.result} onChange={(e) => setDraftField('result', e.target.value)} />
            </label>
        );
    };

    return (
        <div style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(15, 23, 42, 0.42)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
        }}>
            <div style={{
                width: 'min(980px, 96vw)',
                height: 'min(640px, 88vh)',
                background: '#fff',
                borderRadius: 12,
                boxShadow: '0 24px 80px rgba(15, 23, 42, 0.24)',
                display: 'flex',
                flexDirection: 'column',
                minWidth: 0,
                minHeight: 0,
                overflow: 'hidden',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid #e2e8f0' }}>
                    <div>
                        <div style={{ fontSize: 18, fontWeight: 900, color: '#0f172a' }}>
                            통합 입력 모달
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginTop: 3 }}>
                            저장 API 연결 전 UI/UX 확인 모드
                        </div>
                    </div>
                    <button type="button" onClick={onClose} style={{ border: 0, background: 'transparent', cursor: 'pointer', color: '#94a3b8', padding: 6 }}>
                        <span className="material-icons" style={{ fontSize: 26 }}>close</span>
                    </button>
                </div>

                <div style={{ display: 'flex', gap: 4, padding: '12px 18px 0', borderBottom: '1px solid #e2e8f0' }}>
                    {TAB_META.map((tab) => {
                        const isActive = tab.id === activeTab;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => setActiveTab(tab.id)}
                                style={{
                                    padding: '10px 18px',
                                    border: 0,
                                    borderBottom: isActive ? '3px solid #1e293b' : '3px solid transparent',
                                    background: 'transparent',
                                    cursor: 'pointer',
                                    fontSize: 14,
                                    fontWeight: 900,
                                    color: isActive ? '#0f172a' : '#94a3b8',
                                }}
                            >
                                {tab.label}
                            </button>
                        );
                    })}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 0, minHeight: 0, flex: 1 }}>
                    <aside style={{ borderRight: '1px solid #e2e8f0', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                        <div style={{ padding: '14px 16px', borderBottom: '1px solid #e2e8f0' }}>
                            <input
                                type="date"
                                value={date}
                                onChange={(e) => setDate(e.target.value)}
                                style={{ ...inputStyle, width: '100%', textAlign: 'left', boxSizing: 'border-box' }}
                            />
                        </div>
                        <div style={{ overflowY: 'auto', padding: 10, display: 'grid', gap: 6 }}>
                            {currentItems.map((item) => {
                                const isSelected = item.key === selectedItem?.key;
                                return (
                                    <button
                                        key={item.key}
                                        type="button"
                                        onClick={() => handleSelectItem(item.key)}
                                        style={{
                                            border: `1px solid ${isSelected ? '#2563eb' : '#e2e8f0'}`,
                                            background: isSelected ? '#eff6ff' : '#fff',
                                            color: isSelected ? '#1d4ed8' : '#334155',
                                            borderRadius: 8,
                                            padding: '10px 12px',
                                            cursor: 'pointer',
                                            textAlign: 'left',
                                            fontSize: 13,
                                            fontWeight: 850,
                                        }}
                                    >
                                        {item.label}
                                    </button>
                                );
                            })}
                        </div>
                    </aside>

                    <main style={{ minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                        <div style={{ padding: '18px 22px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
                            <div style={{ fontSize: 16, fontWeight: 900, color: '#0f172a' }}>{selectedItem?.label || '항목 선택'}</div>
                            <div style={{ display: 'flex', gap: 18, marginTop: 10, flexWrap: 'wrap' }}>
                                {(selectedItem?.summary || []).map((item) => (
                                    <div key={item.label} style={{ fontSize: 12, color: '#64748b', fontWeight: 800 }}>
                                        {item.label}: <span style={{ color: '#0f172a' }}>{formatValue(item.value)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div style={{ padding: 22, flex: 1, overflowY: 'auto' }}>
                            {renderFields()}
                            <div style={{ marginTop: 18, padding: 14, borderRadius: 8, background: '#f8fafc', color: '#64748b', fontSize: 12, fontWeight: 700, lineHeight: 1.55 }}>
                                이 단계에서는 입력값이 로컬 DB에 저장되지 않습니다. 탭 전환, 항목 선택, 값 입력, 자동계산 흐름을 확인한 뒤 저장 API와 BigQuery 동기화를 연결합니다.
                            </div>
                        </div>
                    </main>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '14px 18px', borderTop: '1px solid #e2e8f0' }}>
                    <button type="button" onClick={onClose} style={{ padding: '9px 18px', borderRadius: 7, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontWeight: 800, color: '#475569' }}>
                        닫기
                    </button>
                    <button type="button" onClick={handleSave} style={{ padding: '9px 18px', borderRadius: 7, border: 0, background: '#1e293b', cursor: 'pointer', fontWeight: 900, color: '#fff' }}>
                        저장 UX 확인
                    </button>
                </div>
            </div>
        </div>
    );
}
