import React, { useEffect, useRef, useState } from 'react';
import Calendar from 'react-calendar';
import 'react-calendar/dist/Calendar.css';
import '../../styles/calendar-custom.css';
import { useDialog } from '../../components/common/DialogProvider';
import DailyLogFixedPreview from './DailyLogFixedPreview';
import ExcelHtmlPrintView from './ExcelHtmlPrintView';
import DailyLogStatusDashboard from './DailyLogStatusDashboard';
import { useDailyLogViewModel } from './useDailyLogViewModel';

const FIXED_PREVIEW_TEMPLATES = ['수질분석일지'];

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
        selectedDates,
        handleDateClick,
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
        handleDownloadRange,
        activeDates,
        setCalendarActiveStartDate,
        handleExportExcel,
        dashboardRows,
        dashboardDateRows,
        dashboardSummary,
        isDashboardLoading,
    } = useDailyLogViewModel(currentUser, undefined, templateName, showAlert);
    const [isOutputMenuOpen, setIsOutputMenuOpen] = useState(false);
    const outputMenuRef = useRef(null);
    const lastAlertMessageRef = useRef('');
    
    const isMultipleDates = selectedDates && selectedDates.length > 1;
    const showSingleDayBatchActions = !isMultipleDates && pages.length > 1;
    const showRangeBatchActions = isMultipleDates;

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

    // date 포맷 지원 함수 (캘린더의 타일 비교를 위함)
    const getFormattedDateString = (date) => {
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        return `${date.getFullYear()}-${mm}-${dd}`;
    };

    return (
        <div style={{ display: 'flex', width: '100%', height: '100%', backgroundColor: '#ffffff', padding: '1.25rem', gap: '1.25rem' }}>
            {/* 좌측 패널 (조회 조건 및 내보내기 설정) */}
            <div style={{ width: '380px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <h1 style={{ fontSize: '1.25rem', fontWeight: 900, color: '#1e293b', letterSpacing: '-0.025em', margin: 0 }}>
                    {title}
                </h1>

                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1rem', overflowY: 'auto' }}>
                    {/* 달력 컴포넌트 영역 */}
                    <div>
                        <div style={{ backgroundColor: '#ffffff', borderRadius: '12px', overflow: 'hidden', border: '1px solid #e2e8f0', padding: '8px', boxShadow: '0 1px 2px rgba(15,23,42,0.05)' }}>
                             <Calendar 
                                onClickDay={(value, event) => handleDateClick(value, event)}
                                onActiveStartDateChange={({ activeStartDate }) => setCalendarActiveStartDate(activeStartDate)}
                                 tileClassName={({ date, view }) => {
                                    if (view === 'month') {
                                        const dStr = getFormattedDateString(date);
                                        const classes = [];
                                        
                                        if (selectedDates && selectedDates.includes(dStr)) {
                                            classes.push('react-calendar__tile--active');
                                        }
                                        
                                        if (templateName !== '일일업무일지' && activeDates && activeDates.includes(dStr)) {
                                            classes.push('has-data-badge');
                                        }
                                        
                                        return classes.join(' ');
                                    }
                                    return null;
                                }}
                                tileContent={({ date, view }) => {
                                    if (view === 'month') {
                                        const dStr = getFormattedDateString(date);
                                        if (templateName !== '일일업무일지' && activeDates && activeDates.includes(dStr)) {
                                            return <div className="data-badge" />
                                        }
                                    }
                                    return null;
                                }}
                                formatDay={(locale, date) => date.getDate()}
                                calendarType="gregory"
                                next2Label={null}
                                prev2Label={null}
                                className="custom-calendar"
                             />
                        </div>
                    </div>

                    {/* 출력 대상 옵션 및 데이터 표시 */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                        <div style={{ fontSize: '0.8125rem', fontWeight: 800, color: '#475569', marginBottom: '0.75rem' }}>출력 대상 페이지</div>
                        <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '12px',
                            backgroundColor: '#f8fafc',
                            border: '1px solid #e2e8f0',
                            borderRadius: '12px',
                            padding: '16px'
                        }}>
                            {/* 라디오 1: 전체 페이지 */}
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                <input
                                    type="radio"
                                    name="pageOption"
                                    value="all"
                                    defaultChecked
                                    style={{ margin: 0, width: '16px', height: '16px', accentColor: '#1e293b' }}
                                    onChange={() => {}} 
                                />
                                <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#334155' }}>전체 페이지 지정</span>
                            </label>

                            {/* 라디오 2: 부분 페이지 */}
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'not-allowed', opacity: 0.45 }}>
                                <input
                                    type="radio"
                                    name="pageOption"
                                    value="partial"
                                    disabled={true}
                                    style={{ margin: 0, width: '16px', height: '16px', accentColor: '#1e293b' }}
                                    onChange={() => {}} 
                                />
                                <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#334155' }}>부분 페이지 지정</span>
                            </label>
                            
                            {/* 부분 입력 창 */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingLeft: '24px', opacity: 0.45 }}>
                                <input
                                    type="text"
                                    placeholder="예: 1-3, 5"
                                    disabled={true} 
                                    style={{
                                        flex: 1,
                                        height: '36px',
                                        padding: '0 12px',
                                        border: '1px solid #e2e8f0',
                                        borderRadius: '8px',
                                        fontSize: '0.875rem',
                                        outline: 'none',
                                        backgroundColor: '#ffffff'
                                    }}
                                />
                            </div>
                        </div>
                    </div>

                    {/* 내보내기 버튼 영역 */}
                    <div>
                        <button 
                            onClick={() => handleExportExcel()}
                            disabled={isOutputProcessing}
                            style={{
                            width: '100%', height: '48px', 
                            backgroundColor: isOutputProcessing ? '#64748b' : '#1e293b', 
                            color: 'white',
                            border: 'none', borderRadius: '12px', fontSize: '1rem', fontWeight: 900,
                            cursor: isOutputProcessing ? 'not-allowed' : 'pointer', 
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                            boxShadow: '0 4px 12px rgba(30,41,59,0.2)',
                            transition: 'all 0.2s ease',
                            opacity: isOutputProcessing ? 0.8 : 1
                        }}>
                            <span className="material-icons">{isOutputProcessing ? 'sync' : 'download'}</span> {title} {isOutputProcessing ? '생성 중...' : '생성하기'}
                        </button>
                    </div>
                </div>
            </div>

            {/* 우측 패널 (데이터 미리보기 표) */}
            <div style={{ flex: 1, maxWidth: '1200px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <DailyLogStatusDashboard
                    title={title}
                    dashboardSummary={dashboardSummary}
                    dashboardDateRows={dashboardDateRows}
                    dashboardRows={dashboardRows}
                    isLoading={isManifestLoading || isDashboardLoading || isPreviewAssetLoading}
                    manifestError={manifestError}
                />
            </div>

            {/* 작업 중 로딩 오버레이 (Toast 느낌) */}
            {isOutputProcessing && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(255, 255, 255, 0.7)',
                    backdropFilter: 'blur(4px)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 9999,
                    animation: 'fadeIn 0.2s ease-out'
                }}>
                    <div style={{
                        backgroundColor: '#1e293b',
                        color: 'white',
                        padding: '16px 32px',
                        borderRadius: '50px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
                        fontWeight: 700,
                        fontSize: '1rem'
                    }}>
                        <div className="processing-spinner" style={{
                            width: '20px',
                            height: '20px',
                            border: '3px solid rgba(255,255,255,0.3)',
                            borderTopColor: '#ffffff',
                            borderRadius: '50%',
                            animation: 'spin 0.8s linear infinite'
                        }} />
                        엑셀 일지를 생성 중입니다. 잠시만 기다려 주세요...
                    </div>
                </div>
            )}

            <style>{`
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                .custom-calendar {
                    width: 100% !important;
                    border: none !important;
                    font-family: inherit !important;
                }
                .react-calendar__tile--active {
                    background: #1e293b !important;
                    color: white !important;
                    border-radius: 8px !important;
                }
                .has-data-badge {
                    position: relative;
                }
                .data-badge {
                    position: absolute;
                    bottom: 4px;
                    left: 50%;
                    transform: translateX(-50%);
                    width: 4px;
                    height: 4px;
                    background-color: #ef4444;
                    border-radius: 50%;
                }
            `}</style>
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
