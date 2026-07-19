import React, { useEffect, useRef } from 'react';
import Calendar from 'react-calendar';
import 'react-calendar/dist/Calendar.css';
import '../../styles/calendar-custom.css';
import { useDialog } from '../../components/common/DialogContext';
import DailyLogStatusDashboard from './DailyLogStatusDashboard';
import { useDailyLogViewModel } from './useDailyLogViewModel';

const DailyLogView = ({ currentUser, templateName = '수질분석일지', title = '수질분석일지' }) => {
    const { showToast } = useDialog();
    const {
        selectedDates,
        handleDateClick,
        isManifestLoading,
        isPreviewAssetLoading,
        isOutputProcessing,
        outputFormat,
        setOutputFormat,
        manifestError,
        manifestErrorCode,
        setCalendarActiveStartDate,
        handleExport,
        dashboardRows,
        dashboardDateRows,
        dashboardSummary,
        isDashboardLoading,
        outputSites,
        selectedOutputSiteId,
        handleOutputSiteChange,
    } = useDailyLogViewModel(currentUser, undefined, templateName, showToast);
    const lastAlertMessageRef = useRef('');

    useEffect(() => {
        if (!['REPORT_TEMPLATE_MISSING', 'REPORT_HWPX_TEMPLATE_MISSING'].includes(manifestErrorCode) || !manifestError) {
            return;
        }

        if (lastAlertMessageRef.current === manifestError) {
            return;
        }

        lastAlertMessageRef.current = manifestError;
        showToast(manifestError, 'error');
    }, [manifestError, manifestErrorCode, showToast, title]);

    // date 포맷 지원 함수 (캘린더의 타일 비교를 위함)
    const getFormattedDateString = (date) => {
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        return `${date.getFullYear()}-${mm}-${dd}`;
    };

    const isDailyWorkLog = templateName === '일일업무일지';
    const outputFormatLabel = isDailyWorkLog
        ? (outputFormat === 'hwpx' ? '한글' : 'PDF')
        : '엑셀';
    const exportButtonLabel = isDailyWorkLog
        ? `${outputFormatLabel} 업무일지 출력`
        : '분석일지 출력';

    return (
        <div style={{ display: 'flex', width: '100%', height: '100%', minWidth: 0, minHeight: 0, backgroundColor: '#ffffff', padding: '1.25rem', gap: '1.25rem' }}>
            {/* 좌측 패널 (조회 조건 및 내보내기 설정) */}
            <div style={{ width: '220px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <h1 style={{ fontSize: '1.25rem', fontWeight: 900, color: '#1e293b', letterSpacing: '-0.025em', margin: 0 }}>
                    {title}
                </h1>

                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1rem', overflowY: 'auto' }}>
                    {/* 달력 컴포넌트 영역 */}
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                        <div style={{ width: '220px', backgroundColor: '#ffffff', borderRadius: '12px', overflow: 'hidden', border: '1px solid #e2e8f0', padding: '12px 10px', boxShadow: '0 1px 2px rgba(15,23,42,0.05)' }}>
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
                                        
                                        return classes.join(' ');
                                    }
                                    return null;
                                }}
                                tileContent={() => {
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

                    {isDailyWorkLog && (
                    <div style={{ display: outputSites.length > 1 ? 'flex' : 'none', flexDirection: 'column', gap: '6px' }}>
                        <label htmlFor="daily-log-output-site" style={{ fontSize: '0.8125rem', fontWeight: 800, color: '#475569' }}>
                            출력 현장
                        </label>
                        <select
                            id="daily-log-output-site"
                            value={selectedOutputSiteId}
                            onChange={(event) => handleOutputSiteChange(event.target.value)}
                            style={{
                                width: '100%',
                                height: '38px',
                                border: '1px solid #cbd5e1',
                                borderRadius: '8px',
                                padding: '0 10px',
                                backgroundColor: '#fff',
                                color: '#1e293b',
                                fontSize: '0.8125rem',
                                fontWeight: 800,
                            }}
                        >
                            {outputSites.map((site) => (
                                <option key={site.id} value={site.id}>{site.site_name}</option>
                            ))}
                        </select>
                    </div>
                    )}

                    {isDailyWorkLog && (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <div style={{ fontSize: '0.8125rem', fontWeight: 800, color: '#475569', marginBottom: '0.75rem' }}>출력 형식</div>
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(2, 1fr)',
                            gap: '6px',
                            backgroundColor: '#f8fafc',
                            border: '1px solid #e2e8f0',
                            borderRadius: '12px',
                            padding: '6px'
                        }}>
                            {[
                                { id: 'hwpx', label: '한글' },
                                { id: 'pdf', label: 'PDF' },
                            ].map((format) => {
                                const selected = outputFormat === format.id;
                                return (
                                    <button
                                        key={format.id}
                                        type="button"
                                        onClick={() => setOutputFormat(format.id)}
                                        aria-pressed={selected}
                                        style={{
                                            height: '38px',
                                            border: selected ? '1px solid #1e293b' : '1px solid transparent',
                                            borderRadius: '8px',
                                            backgroundColor: selected ? '#1e293b' : 'transparent',
                                            color: selected ? '#ffffff' : '#475569',
                                            fontSize: '0.8125rem',
                                            fontWeight: 800,
                                            cursor: 'pointer',
                                        }}
                                    >
                                        {format.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                    )}

                    {/* 내보내기 버튼 영역 */}
                    <div>
                        <button 
                            onClick={() => handleExport()}
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
                            <span className="material-icons">{isOutputProcessing ? 'sync' : 'download'}</span> {isOutputProcessing ? '출력 중...' : exportButtonLabel}
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
                        {outputFormatLabel} 일지를 출력 중입니다. 잠시만 기다려 주세요...
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

export default DailyLogView;
