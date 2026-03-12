import React, { useEffect, useRef, useState } from 'react';
import { useDialog } from '../../components/common/DialogProvider';
import DailyLogFixedPreview from './DailyLogFixedPreview';
import { useDailyLogViewModel } from './useDailyLogViewModel';

const formatDisplayDate = (value) => {
    const normalized = String(value || '').trim();
    if (!normalized) {
        return '';
    }

    const [year, month, day] = normalized.split('-');
    if (!year || !month || !day) {
        return normalized;
    }

    return `${year}-${month}-${day}`;
};

const DailyLogView = ({ currentUser, templateName = '수질분석일지', title = '수질분석일지' }) => {
    const { showAlert } = useDialog();
    const {
        startDate,
        endDate,
        isRangeMode,
        setIsRangeMode,
        setStartDate,
        setEndDate,
        pages,
        currentPage,
        pageRenderData,
        pageIndicator,
        isManifestLoading,
        isPreviewAssetLoading,
        isOutputProcessing,
        manifestError,
        manifestErrorCode,
        hasPreviousPage,
        hasNextPage,
        handlePrevPage,
        handleNextPage,
        handlePrintCurrent,
        handleDownloadCurrent,
        handlePrintRange,
        handleDownloadRange
    } = useDailyLogViewModel(currentUser, undefined, templateName, showAlert);
    const [isOutputMenuOpen, setIsOutputMenuOpen] = useState(false);
    const outputMenuRef = useRef(null);
    const lastAlertMessageRef = useRef('');
    const startDateInputRef = useRef(null);
    const endDateInputRef = useRef(null);
    const showSingleDayBatchActions = !isRangeMode && pages.length > 1;
    const showRangeBatchActions = isRangeMode && startDate !== endDate;

    useEffect(() => {
        const handlePointerDown = (event) => {
            if (!outputMenuRef.current?.contains(event.target)) {
                setIsOutputMenuOpen(false);
            }
        };

        document.addEventListener('mousedown', handlePointerDown);
        return () => document.removeEventListener('mousedown', handlePointerDown);
    }, []);

    useEffect(() => {
        if (manifestErrorCode !== 'REPORT_TEMPLATE_MISSING' || !manifestError) {
            return;
        }

        if (lastAlertMessageRef.current === manifestError) {
            return;
        }

        lastAlertMessageRef.current = manifestError;
        showAlert(manifestError, `${title} 양식 필요`);
    }, [manifestError, manifestErrorCode, showAlert, title]);

    const handleMenuAction = (action) => {
        setIsOutputMenuOpen(false);
        action();
    };

    const outputMenuItemStyle = {
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '12px 14px',
        border: 'none',
        backgroundColor: '#ffffff',
        color: '#0f172a',
        fontSize: '0.8125rem',
        fontWeight: 800,
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background-color 0.15s ease'
    };

    const handleMenuItemMouseEnter = (event) => {
        event.currentTarget.style.backgroundColor = '#e2e8f0';
    };

    const handleMenuItemMouseLeave = (event) => {
        event.currentTarget.style.backgroundColor = '#ffffff';
    };

    const openDatePicker = (inputRef) => {
        const input = inputRef.current;
        if (!input) {
            return;
        }

        if (typeof input.showPicker === 'function') {
            input.showPicker();
            return;
        }

        input.focus();
        input.click();
    };

    return (
        <div
            style={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                width: '70%',
                backgroundColor: '#FFFFFF',
                borderRight: '1px solid #e2e8f0'
            }}
        >
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 12px',
                    backgroundColor: '#f8fafc',
                    borderBottom: '1px solid #f1f5f9',
                    flexShrink: 0
                }}
            >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <button
                                type="button"
                                onClick={setIsRangeMode}
                                aria-pressed={isRangeMode}
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    border: 'none',
                                    background: 'transparent',
                                    padding: 0,
                                    cursor: 'pointer'
                                }}
                            >
                                <span style={{ fontSize: '0.76rem', fontWeight: 900, color: isRangeMode ? '#0f172a' : '#64748b' }}>기간선택</span>
                                <span
                                    style={{
                                        position: 'relative',
                                        width: '38px',
                                        height: '22px',
                                        borderRadius: '999px',
                                        backgroundColor: isRangeMode ? '#2563eb' : '#cbd5e1',
                                        transition: 'background-color 0.2s ease'
                                    }}
                                >
                                    <span
                                        style={{
                                            position: 'absolute',
                                            top: '2px',
                                            left: isRangeMode ? '18px' : '2px',
                                            width: '18px',
                                            height: '18px',
                                            borderRadius: '50%',
                                            backgroundColor: '#ffffff',
                                            boxShadow: '0 1px 3px rgba(15, 23, 42, 0.28)',
                                            transition: 'left 0.2s ease'
                                        }}
                                    />
                                </span>
                            </button>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                <div
                                    className="dailylog-date-field"
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => openDatePicker(startDateInputRef)}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter' || event.key === ' ') {
                                            event.preventDefault();
                                            openDatePicker(startDateInputRef);
                                        }
                                    }}
                                    style={{
                                        position: 'relative',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                        backgroundColor: '#ffffff',
                                        border: '1px solid #334155',
                                        padding: '2px 6px',
                                        borderRadius: '8px',
                                        height: '30px',
                                        cursor: 'pointer'
                                    }}
                                >
                                    <span className="material-icons" style={{ color: '#64748b', fontSize: '14px' }}>event</span>
                                    <span
                                        style={{
                                            fontSize: '0.8rem',
                                            fontWeight: 700,
                                            color: '#0f172a',
                                            letterSpacing: '0.01em',
                                            minWidth: '92px',
                                            lineHeight: 1.1
                                        }}
                                    >
                                        {formatDisplayDate(startDate)}
                                    </span>
                                    <span className="material-icons" style={{ color: '#0f172a', fontSize: '16px' }}>arrow_drop_down</span>
                                    <input
                                        ref={startDateInputRef}
                                        className="dailylog-native-date-input"
                                        type="date"
                                        value={startDate}
                                        onChange={(e) => setStartDate(e.target.value)}
                                        tabIndex={-1}
                                    />
                                </div>
                                {isRangeMode && (
                                    <>
                                        <span style={{ color: '#64748b', fontSize: '0.76rem', fontWeight: 800 }}>~</span>
                                        <div
                                            className="dailylog-date-field"
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => openDatePicker(endDateInputRef)}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter' || event.key === ' ') {
                                                    event.preventDefault();
                                                    openDatePicker(endDateInputRef);
                                                }
                                            }}
                                            style={{
                                                position: 'relative',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '4px',
                                                backgroundColor: '#ffffff',
                                                border: '1px solid #334155',
                                                padding: '2px 6px',
                                                borderRadius: '8px',
                                                height: '30px',
                                                cursor: 'pointer'
                                            }}
                                        >
                                            <span className="material-icons" style={{ color: '#64748b', fontSize: '14px' }}>date_range</span>
                                            <span
                                                style={{
                                                    fontSize: '0.8rem',
                                                    fontWeight: 700,
                                                    color: '#0f172a',
                                                    letterSpacing: '0.01em',
                                                    minWidth: '92px',
                                                    lineHeight: 1.1
                                                }}
                                            >
                                                {formatDisplayDate(endDate)}
                                            </span>
                                            <span className="material-icons" style={{ color: '#0f172a', fontSize: '16px' }}>arrow_drop_down</span>
                                            <input
                                                ref={endDateInputRef}
                                                className="dailylog-native-date-input"
                                                type="date"
                                                value={endDate}
                                                onChange={(e) => setEndDate(e.target.value)}
                                                tabIndex={-1}
                                            />
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                        <div style={{ fontSize: '0.95rem', fontWeight: 900, color: '#0f172a', minWidth: '44px', textAlign: 'right' }}>{pageIndicator}</div>
                        <button
                            type="button"
                            onClick={handlePrevPage}
                            disabled={!hasPreviousPage}
                            style={{
                                width: '38px',
                                height: '38px',
                                borderRadius: '10px',
                                border: '1px solid #cbd5e1',
                                backgroundColor: hasPreviousPage ? '#ffffff' : '#f8fafc',
                                color: hasPreviousPage ? '#0f172a' : '#cbd5e1',
                                cursor: hasPreviousPage ? 'pointer' : 'default'
                            }}
                        >
                            <span className="material-icons" style={{ fontSize: '18px' }}>chevron_left</span>
                        </button>
                        <button
                            type="button"
                            onClick={handleNextPage}
                            disabled={!hasNextPage}
                            style={{
                                width: '38px',
                                height: '38px',
                                borderRadius: '10px',
                                border: '1px solid #cbd5e1',
                                backgroundColor: hasNextPage ? '#ffffff' : '#f8fafc',
                                color: hasNextPage ? '#0f172a' : '#cbd5e1',
                                cursor: hasNextPage ? 'pointer' : 'default'
                            }}
                        >
                            <span className="material-icons" style={{ fontSize: '18px' }}>chevron_right</span>
                        </button>
                        <div ref={outputMenuRef} style={{ position: 'relative' }}>
                        <button
                            type="button"
                            onClick={() => setIsOutputMenuOpen((prev) => !prev)}
                            disabled={!currentPage}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                height: '38px',
                                padding: '0 12px',
                                border: 'none',
                                borderRadius: '10px',
                                backgroundColor: currentPage ? '#0f172a' : '#94a3b8',
                                color: '#ffffff',
                                fontSize: '0.8125rem',
                                fontWeight: 900,
                                cursor: currentPage ? 'pointer' : 'default'
                            }}
                        >
                            <span className="material-icons" style={{ fontSize: '18px' }}>print</span>
                            출력
                            <span className="material-icons" style={{ fontSize: '18px' }}>arrow_drop_down</span>
                        </button>

                        {isOutputMenuOpen && (
                            <div style={{
                                position: 'absolute',
                                top: 'calc(100% + 8px)',
                                right: 0,
                                minWidth: '220px',
                                backgroundColor: '#ffffff',
                                border: '1px solid #cbd5e1',
                                borderRadius: '12px',
                                boxShadow: '0 16px 32px -16px rgba(15, 23, 42, 0.35)',
                                overflow: 'hidden',
                                zIndex: 20
                            }}>
                                <button
                                    type="button"
                                    onClick={() => handleMenuAction(handlePrintCurrent)}
                                    onMouseEnter={handleMenuItemMouseEnter}
                                    onMouseLeave={handleMenuItemMouseLeave}
                                    style={outputMenuItemStyle}
                                >
                                    <span className="material-icons" style={{ fontSize: '18px' }}>print</span>
                                    현재 페이지 인쇄
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleMenuAction(handleDownloadCurrent)}
                                    style={{
                                        borderTop: '1px solid #e2e8f0',
                                        ...outputMenuItemStyle
                                    }}
                                    onMouseEnter={handleMenuItemMouseEnter}
                                    onMouseLeave={handleMenuItemMouseLeave}
                                >
                                    <span className="material-icons" style={{ fontSize: '18px' }}>picture_as_pdf</span>
                                    현재 페이지 PDF
                                </button>
                                {showSingleDayBatchActions && (
                                    <button
                                        type="button"
                                        onClick={() => handleMenuAction(handlePrintRange)}
                                        style={{
                                            borderTop: '1px solid #e2e8f0',
                                            ...outputMenuItemStyle
                                        }}
                                        onMouseEnter={handleMenuItemMouseEnter}
                                        onMouseLeave={handleMenuItemMouseLeave}
                                    >
                                        <span className="material-icons" style={{ fontSize: '18px' }}>local_printshop</span>
                                        금일 페이지 전체 인쇄
                                    </button>
                                )}
                                {showSingleDayBatchActions && (
                                    <button
                                        type="button"
                                        onClick={() => handleMenuAction(handleDownloadRange)}
                                        style={{
                                            borderTop: '1px solid #e2e8f0',
                                            ...outputMenuItemStyle
                                        }}
                                        onMouseEnter={handleMenuItemMouseEnter}
                                        onMouseLeave={handleMenuItemMouseLeave}
                                    >
                                        <span className="material-icons" style={{ fontSize: '18px' }}>download</span>
                                        금일 페이지 전체 PDF
                                    </button>
                                )}
                                {showRangeBatchActions && (
                                    <button
                                        type="button"
                                        onClick={() => handleMenuAction(handlePrintRange)}
                                        style={{
                                            borderTop: '1px solid #e2e8f0',
                                            ...outputMenuItemStyle
                                        }}
                                        onMouseEnter={handleMenuItemMouseEnter}
                                        onMouseLeave={handleMenuItemMouseLeave}
                                    >
                                        <span className="material-icons" style={{ fontSize: '18px' }}>local_printshop</span>
                                        선택 기간 전체 인쇄
                                    </button>
                                )}
                                {showRangeBatchActions && (
                                    <button
                                        type="button"
                                        onClick={() => handleMenuAction(handleDownloadRange)}
                                        style={{
                                            borderTop: '1px solid #e2e8f0',
                                            ...outputMenuItemStyle
                                        }}
                                        onMouseEnter={handleMenuItemMouseEnter}
                                        onMouseLeave={handleMenuItemMouseLeave}
                                    >
                                        <span className="material-icons" style={{ fontSize: '18px' }}>download</span>
                                        선택 기간 전체 PDF
                                    </button>
                                )}
                            </div>
                        )}
                        </div>
                    </div>
                </div>

                <div
                    className="log-print-area"
                    style={{
                        flex: 1,
                        backgroundColor: '#ffffff',
                        padding: '0',
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column',
                        minHeight: 0
                    }}
                >
                    <div
                        style={{
                            flex: 1,
                            width: '100%',
                            minHeight: 0,
                            backgroundColor: '#ffffff',
                            position: 'relative',
                            overflow: 'hidden',
                            display: 'flex'
                        }}
                    >
                        {(isManifestLoading || isPreviewAssetLoading || isOutputProcessing) && (
                            <div
                                style={{
                                    position: 'absolute',
                                    inset: 0,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    backgroundColor: 'rgba(255, 255, 255, 0.92)',
                                    zIndex: 1
                                }}
                            >
                                <div className="spinner" style={{ margin: 0 }} />
                            </div>
                        )}

                        {manifestError ? (
                            <div style={{ padding: '40px 32px', color: '#991b1b', fontWeight: 700 }}>{manifestError}</div>
                        ) : !currentPage ? (
                            <div
                                style={{
                                    flex: 1,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    padding: '32px'
                                }}
                            >
                                <div
                                    style={{
                                        minWidth: '320px',
                                        maxWidth: '520px',
                                        padding: '28px 32px',
                                        borderRadius: '16px',
                                        border: '1px solid #94a3b8',
                                        backgroundColor: '#eef2f7',
                                        boxShadow: '0 16px 32px -24px rgba(15, 23, 42, 0.28)',
                                        textAlign: 'center'
                                    }}
                                >
                                    <div
                                        style={{
                                            width: '52px',
                                            height: '52px',
                                            borderRadius: '50%',
                                            margin: '0 auto 14px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            backgroundColor: '#cbd5e1',
                                            color: '#1e293b'
                                        }}
                                    >
                                        <span className="material-icons" style={{ fontSize: '28px' }}>description</span>
                                    </div>
                                    <div style={{ fontSize: '1rem', fontWeight: 900, color: '#020617', marginBottom: '8px' }}>
                                        표시할 수질분석일지 페이지가 없습니다.
                                    </div>
                                    <div style={{ fontSize: '0.84rem', fontWeight: 800, color: '#334155', lineHeight: 1.5 }}>
                                        선택한 날짜 또는 기간에 연결된 수질분석 데이터가 없어 미리보기를 만들 수 없습니다.
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <DailyLogFixedPreview
                                page={pageRenderData}
                                title={title}
                            />
                        )}
                    </div>
                </div>
            <style>{dailyLogDateInputStyles}</style>
        </div>
    );
};

/* Chromium date input is visually large by default, so tighten its internal segments. */
const dailyLogDateInputStyles = `
    .dailylog-date-field:focus-visible {
        outline: 2px solid #60a5fa;
        outline-offset: 2px;
    }

    .dailylog-date-field .dailylog-native-date-input {
        position: absolute;
        inset: 0;
        opacity: 0;
        cursor: pointer;
    }
`;

export default DailyLogView;
