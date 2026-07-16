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

const iconButtonStyle = {
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
};

const CertificateView = ({ currentUser }) => {
    const { showToast, showAlert } = useDialog();
    const {
        isLoading,
        visibleRecords,
        selectedId,
        setSelectedId,
        selectedYear,
        setSelectedYear,
        selectedMonth,
        setSelectedMonth,
        yearOptions,
        monthOptions,
        moveMonth,
        handleDownload,
        selectedRecords,
        selectedCertificateIds,
        toggleCertificateSelection,
        toggleAllVisibleSelection,
        allVisibleSelected,
        viewMode,
        setViewMode,
        openPreview,
        errorMessage,
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
            minWidth: 0,
            minHeight: 0,
        }}>
            <div style={headerWrapStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="material-icons" style={{ fontSize: '18px', color: '#475569' }}>description</span>
                    <strong style={{ color: '#1e293b', fontSize: '14px' }}>성적서 목록</strong>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {viewMode === 'card' && (
                        <label style={{ display: 'flex', alignItems: 'center', gap: '5px', marginRight: '4px', color: '#475569', fontSize: '12px', fontWeight: 800, cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={allVisibleSelected}
                                onChange={toggleAllVisibleSelection}
                                disabled={visibleRecords.length === 0}
                            />
                            전체 선택
                        </label>
                    )}
                    {[['list', 'view_list', '목록형'], ['card', 'grid_view', '카드형']].map(([mode, icon, label]) => (
                        <button
                            key={mode}
                            type="button"
                            onClick={() => setViewMode(mode)}
                            aria-pressed={viewMode === mode}
                            title={`${label}으로 보기`}
                            style={{
                                ...iconButtonStyle,
                                width: 'auto',
                                padding: '0 10px',
                                gap: '5px',
                                borderColor: viewMode === mode ? '#2563eb' : '#cbd5e1',
                                background: viewMode === mode ? '#eff6ff' : '#ffffff',
                                color: viewMode === mode ? '#1d4ed8' : '#475569',
                            }}
                        >
                            <span className="material-icons" style={{ fontSize: '17px' }}>{icon}</span>
                            <span style={{ fontSize: '12px', fontWeight: 800 }}>{label}</span>
                        </button>
                    ))}
                </div>
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
                {viewMode === 'list' && <div style={{
                    display: 'grid',
                    gridTemplateColumns: '42px 1fr',
                    borderBottom: '1px solid #e2e8f0',
                    background: '#f8fafc',
                    fontSize: '12px',
                    fontWeight: 800,
                    color: '#475569',
                    padding: '10px 12px',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <input
                            type="checkbox"
                            checked={allVisibleSelected}
                            onChange={toggleAllVisibleSelection}
                            disabled={visibleRecords.length === 0}
                            aria-label="전체 선택"
                        />
                    </div>
                    <div>파일명</div>
                </div>}

                <div style={{ overflowY: 'auto', flex: 1, background: viewMode === 'card' ? '#f8fafc' : '#ffffff' }}>
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
                            {isLoading ? '성적서 목록을 불러오는 중...' : (errorMessage || '표시할 성적서가 없습니다.')}
                        </div>
                    ) : viewMode === 'list' ? (
                        visibleRecords.map((item) => {
                            const selected = item.id === selectedId;
                            const checked = selectedCertificateIds.has(item.id);
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
                                        gridTemplateColumns: '42px 1fr',
                                        textAlign: 'left',
                                        cursor: 'pointer',
                                        fontSize: '12px',
                                        color: '#1e293b',
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={(event) => {
                                                event.stopPropagation();
                                                toggleCertificateSelection(item.id);
                                            }}
                                            onClick={(event) => event.stopPropagation()}
                                            aria-label={`${item.fileName} 선택`}
                                        />
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                        <span style={{ fontWeight: 700 }}>{item.fileName}</span>
                                    </div>
                                </button>
                            );
                        })
                    ) : (
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
                            gap: '14px',
                            padding: '14px',
                            alignItems: 'start',
                        }}>
                            {visibleRecords.map((item) => {
                                const selected = item.id === selectedId;
                                const checked = selectedCertificateIds.has(item.id);
                                return (
                                    <article
                                        key={item.id}
                                        style={{
                                            position: 'relative',
                                            minWidth: 0,
                                            border: `2px solid ${checked ? '#2563eb' : (selected ? '#93c5fd' : '#e2e8f0')}`,
                                            borderRadius: '12px',
                                            background: '#ffffff',
                                            overflow: 'hidden',
                                            boxShadow: checked ? '0 8px 20px rgba(37, 99, 235, 0.14)' : '0 2px 8px rgba(15, 23, 42, 0.06)',
                                        }}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={() => toggleCertificateSelection(item.id)}
                                            aria-label={`${item.fileName} 선택`}
                                            style={{
                                                position: 'absolute',
                                                zIndex: 2,
                                                top: '10px',
                                                left: '10px',
                                                width: '20px',
                                                height: '20px',
                                                accentColor: '#2563eb',
                                                cursor: 'pointer',
                                            }}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setSelectedId(item.id);
                                                openPreview(item);
                                            }}
                                            title={`${item.fileName} 크게 보기`}
                                            style={{
                                                width: '100%',
                                                height: '280px',
                                                padding: 0,
                                                border: 0,
                                                background: '#e2e8f0',
                                                cursor: 'zoom-in',
                                                display: 'block',
                                                overflow: 'hidden',
                                            }}
                                        >
                                            <img
                                                src={item.previewUrl}
                                                alt={item.fileName}
                                                loading="lazy"
                                                style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', background: '#f1f5f9' }}
                                            />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setSelectedId(item.id)}
                                            style={{
                                                width: '100%',
                                                border: 0,
                                                borderTop: '1px solid #e2e8f0',
                                                background: '#ffffff',
                                                padding: '10px 12px',
                                                textAlign: 'left',
                                                cursor: 'pointer',
                                            }}
                                        >
                                            <span style={{
                                                display: 'block',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                                color: '#1e293b',
                                                fontSize: '12px',
                                                fontWeight: 800,
                                            }}>
                                                {item.fileName}
                                            </span>
                                            <span style={{ display: 'block', marginTop: '3px', color: '#64748b', fontSize: '11px', fontWeight: 700 }}>
                                                {item.issuedAt !== '-' ? item.issuedAt : item.sampledAt}
                                            </span>
                                        </button>
                                    </article>
                                );
                            })}
                        </div>
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
                    <button type="button" onClick={() => moveMonth(-1)} style={iconButtonStyle} aria-label="이전 달">
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

                    <button type="button" onClick={() => moveMonth(1)} style={iconButtonStyle} aria-label="다음 달">
                        <span className="material-icons" style={{ fontSize: '18px' }}>chevron_right</span>
                    </button>
                </div>

                <button
                    type="button"
                    onClick={handleDownload}
                    disabled={selectedRecords.length === 0}
                    title="체크한 성적서를 PDF로 다운로드"
                    style={{
                        height: '34px',
                        minWidth: '128px',
                        borderRadius: '8px',
                        border: '1px solid #cbd5e1',
                        background: selectedRecords.length > 0 ? '#ffffff' : '#f8fafc',
                        color: selectedRecords.length > 0 ? '#334155' : '#94a3b8',
                        fontWeight: 800,
                        fontSize: '12px',
                        cursor: selectedRecords.length > 0 ? 'pointer' : 'default',
                    }}
                >
                    PDF 다운로드{selectedRecords.length > 0 ? ` (${selectedRecords.length})` : ''}
                </button>
            </div>
        </div>
    );
};

export default CertificateView;
