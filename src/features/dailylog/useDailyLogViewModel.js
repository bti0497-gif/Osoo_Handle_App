import { startTransition, useEffect, useMemo, useState } from 'react';
import { DailyLogModel } from './DailyLogModel';
import { SettingsModel } from '../settings/SettingsModel';

function parseLocalDateString(value) {
    const normalized = String(value || '').trim();
    const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (!match) {
        return null;
    }

    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function cloneDateOnly(value) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

const DAILY_WORK_LOG_TEMPLATE = '일일업무일지';
const DAILY_WORK_LOG_FLOW_KEYS = ['유입금일', '방류금일', '내부반송금일', '외부반송금일', '슬러지'];
const DAILY_WORK_LOG_FLOW_AGGREGATE_KEYS = ['월간유입', '연간유입', '월간방류', '연간방류', '월간내부', '연간내부', '월간외부', '연간외부', '월간슬러지', '연간슬러지'];
const DAILY_WORK_LOG_MATERIAL_KEYS = [
    '포도당구입', '포도당사용', '포도당재고',
    '중탄산구입', '중탄산사용', '중탄산재고',
    '팩구입', '팩사용', '팩재고',
    '추가약품1구입', '추가약품1사용', '추가약품1재고',
    '추가약품2구입', '추가약품2사용', '추가약품2재고',
    '추가약품3구입', '추가약품3사용', '추가약품3재고',
    '암모니아구입', '암모니아사용', '암모니아재고',
    '질산구입', '질산사용', '질산재고',
    '인구입', '인사용', '인재고',
    '알칼리구입', '알칼리도사용', '알칼리재고',
];
const DAILY_WORK_LOG_POWER_KEYS = ['금일전력', '전력사용'];

function hasNonEmptyBinding(bindings, keys) {
    return keys.some((key) => {
        const value = bindings?.[key];
        return value !== undefined && value !== null && String(value).trim() !== '';
    });
}

export const useDailyLogViewModel = (currentUser, initialDate, templateName, showToast) => {
    const today = initialDate || new Date().toISOString().split('T')[0];
    const isDailyWorkLog = templateName === DAILY_WORK_LOG_TEMPLATE;
    const expectedPhotoCountPerSheet = isDailyWorkLog ? 0 : 4;
    const [selectedDates, setSelectedDates] = useState([today]);
    const [lastClickedDate, setLastClickedDate] = useState(today);
    const [pages, setPages] = useState([]);
    const [currentPageIndex, setCurrentPageIndex] = useState(0);
    const [isManifestLoading, setIsManifestLoading] = useState(true);
    const [manifestError, setManifestError] = useState('');
    const [manifestErrorCode, setManifestErrorCode] = useState('');
    const [pageRenderData, setPageRenderData] = useState(null);
    const [isPreviewAssetLoading, setIsPreviewAssetLoading] = useState(false);
    const [isOutputProcessing, setIsOutputProcessing] = useState(false);
    const [activeDates, setActiveDates] = useState([]);
    const [siteName, setSiteName] = useState('');
    const [dashboardRows, setDashboardRows] = useState([]);
    const [isDashboardLoading, setIsDashboardLoading] = useState(false);
    const requestContext = useMemo(() => ({
        siteId: currentUser?.site_id || '',
        author: currentUser?.name || '',
    }), [currentUser?.site_id, currentUser?.name]);
    
    // 달력 표시 기준이 되는 년/월
    const [calendarActiveStartDate, setCalendarActiveStartDate] = useState(new Date(today));

    // 사이트 이름 설정 가져오기
    useEffect(() => {
        SettingsModel.getSettings().then(res => {
            if (res.success && res.settings?.site_name) {
                setSiteName(res.settings.site_name);
            }
        }).catch(err => console.error('Failed to fetch site name for daily log:', err));
    }, []);

    const sortedDates = [...selectedDates].sort();
    const computedStartDate = sortedDates[0] || today;
    const computedEndDate = sortedDates[sortedDates.length - 1] || today;

    // Active Dates (달력에 표시될 기간 월에 해당하는 데이터가 있는 날짜 가져오기)
    useEffect(() => {
        let isDisposed = false;
        
        const fetchMonthActiveDates = async () => {
            if (!calendarActiveStartDate) return;
            
            const year = calendarActiveStartDate.getFullYear();
            const month = String(calendarActiveStartDate.getMonth() + 1).padStart(2, '0');
            const lastDay = new Date(year, calendarActiveStartDate.getMonth() + 1, 0).getDate();
            
            const startDate = `${year}-${month}-01`;
            const endDate = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
            
            try {
                const dates = await DailyLogModel.fetchActiveDates(startDate, endDate, templateName, siteName, requestContext);
                if (!isDisposed) {
                    setActiveDates(dates);
                }
            } catch (error) {
                console.error("Failed to fetch active dates for calendar:", error);
            }
        };
        
        fetchMonthActiveDates();
        
        return () => {
            isDisposed = true;
        }
    }, [calendarActiveStartDate, templateName, siteName, requestContext]);

    useEffect(() => {
        let isDisposed = false;

        const loadManifest = async () => {
            if (!selectedDates.length) {
                setPages([]);
                setCurrentPageIndex(0);
                return;
            }

            setIsManifestLoading(true);
            setManifestError('');
            setManifestErrorCode('');

            try {
                const result = await DailyLogModel.fetchPreviewManifest(computedStartDate, computedEndDate, templateName, siteName, requestContext);
                if (isDisposed) {
                    return;
                }

                const nextPages = Array.isArray(result.pages) ? result.pages : [];
                // 선택된 날짜에 포함된 페이지들만 필터링
                const filteredPages = nextPages.filter(p => selectedDates.includes(p.date));
                
                setPages(filteredPages);
                setCurrentPageIndex((prevIndex) => {
                    if (!filteredPages.length) {
                        return 0;
                    }
                    return Math.min(prevIndex, filteredPages.length - 1);
                });
            } catch (error) {
                if (!isDisposed) {
                    setPages([]);
                    setCurrentPageIndex(0);
                    setManifestErrorCode(error?.data?.code || '');
                    setManifestError(error?.data?.userMessage || error?.data?.error || error?.message || '문서 페이지 정보를 불러오지 못했습니다.');
                }
            } finally {
                if (!isDisposed) {
                    setIsManifestLoading(false);
                }
            }
        };

        loadManifest();

        return () => {
            isDisposed = true;
        };
    }, [selectedDates, computedStartDate, computedEndDate, templateName, siteName, requestContext]);

    const currentPage = pages[currentPageIndex] || null;

    useEffect(() => {
        let isDisposed = false;

        const loadPageRenderData = async () => {
            if (!currentPage) {
                setPageRenderData(null);
                setIsPreviewAssetLoading(false);
                return;
            }

            setIsPreviewAssetLoading(true);

            try {
                const result = await DailyLogModel.fetchPreviewPageData({
                    startDate: computedStartDate,
                    endDate: computedEndDate,
                    pageKey: currentPage.pageKey,
                    templateName,
                    siteName,
                    ...requestContext,
                });

                if (!isDisposed) {
                    setPageRenderData(result.page || null);
                }
            } catch {
                if (!isDisposed) {
                    setPageRenderData(null);
                }
            } finally {
                if (!isDisposed) {
                    setIsPreviewAssetLoading(false);
                }
            }
        };

        loadPageRenderData();

        return () => {
            isDisposed = true;
        };
    }, [currentPage, computedEndDate, computedStartDate, templateName, siteName, requestContext]);

    useEffect(() => {
        let isDisposed = false;

        const loadDashboardRows = async () => {
            if (!pages.length) {
                setDashboardRows([]);
                setIsDashboardLoading(false);
                return;
            }

            setIsDashboardLoading(true);

            try {
                const rows = await Promise.all(pages.map(async (page) => {
                    let renderPage = null;

                    if (currentPage?.pageKey === page.pageKey && pageRenderData) {
                        renderPage = pageRenderData;
                    } else {
                        try {
                            const result = await DailyLogModel.fetchPreviewPageData({
                                startDate: computedStartDate,
                                endDate: computedEndDate,
                                pageKey: page.pageKey,
                                templateName,
                                siteName,
                                ...requestContext,
                            });
                            renderPage = result.page || null;
                        } catch {
                            renderPage = null;
                        }
                    }

                    if (isDailyWorkLog) {
                        const bindings = renderPage?.bindings || {};
                        const hasFlowData = hasNonEmptyBinding(bindings, DAILY_WORK_LOG_FLOW_KEYS);
                        const hasAggregateData = hasNonEmptyBinding(bindings, DAILY_WORK_LOG_FLOW_AGGREGATE_KEYS);
                        const hasMaterialData = hasNonEmptyBinding(bindings, DAILY_WORK_LOG_MATERIAL_KEYS);
                        const hasPowerData = hasNonEmptyBinding(bindings, DAILY_WORK_LOG_POWER_KEYS);
                        const hasPrimaryData = hasFlowData || hasMaterialData || hasPowerData;

                        return {
                            id: page.pageKey,
                            date: page.date,
                            sheetLabel: '1장',
                            sheetCount: 1,
                            flowStatus: hasFlowData ? '입력됨' : '없음',
                            aggregateStatus: hasAggregateData ? '계산됨' : '없음',
                            materialStatus: hasMaterialData ? '반영됨' : '없음',
                            powerStatus: hasPowerData ? '입력됨' : '없음',
                            status: hasPrimaryData ? '작성 가능' : '데이터 없음',
                            hasFlowData,
                            hasAggregateData,
                            hasMaterialData,
                            hasPowerData,
                            hasPrimaryData,
                        };
                    }

                    const photoCount = Object.values(renderPage?.photoUrls || {}).filter(Boolean).length;

                    return {
                        id: page.pageKey,
                        date: page.date,
                        sheetLabel: `${page.pageNumberForDate}차`,
                        measurementOrder: page.measurementOrder,
                        groupLabel: page.sourceLabel || page.measurementGroup || '-',
                        rowCount: page.rowCount || 0,
                        locationCount: page.locationCount || 0,
                        photoCount,
                        photoStatus: `${photoCount}/${expectedPhotoCountPerSheet}`,
                        totalPagesForDate: page.totalPagesForDate || 0,
                        status: photoCount >= expectedPhotoCountPerSheet ? '생성 준비' : (photoCount > 0 ? '사진 확인' : '사진 없음'),
                    };
                }));

                if (!isDisposed) {
                    setDashboardRows(rows);
                }
            } finally {
                if (!isDisposed) {
                    setIsDashboardLoading(false);
                }
            }
        };

        loadDashboardRows();

        return () => {
            isDisposed = true;
        };
    }, [pages, currentPage, pageRenderData, computedStartDate, computedEndDate, templateName, siteName, expectedPhotoCountPerSheet, isDailyWorkLog, requestContext]);

    const formatFormatDateForState = (d) => {
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${d.getFullYear()}-${mm}-${dd}`;
    };

    const handleDateClick = (clickedDate, event) => {
        const dateStr = formatFormatDateForState(clickedDate);
        const normalizedClickedDate = cloneDateOnly(clickedDate);
        
        if (event.ctrlKey || event.metaKey) {
            setLastClickedDate(dateStr);
            setSelectedDates(prev => {
                if (prev.includes(dateStr)) {
                    const next = prev.filter(d => d !== dateStr);
                    return next.length ? next : [dateStr]; // 최소 1개는 유지
                }
                return [...prev, dateStr];
            });
        } else if (event.shiftKey) {
            setSelectedDates(prev => {
                if (!prev.length) {
                    return [dateStr];
                }

                const anchorDate = parseLocalDateString(lastClickedDate) || parseLocalDateString(prev[prev.length - 1]);
                if (!anchorDate) {
                    return [dateStr];
                }

                const start = anchorDate <= normalizedClickedDate ? cloneDateOnly(anchorDate) : cloneDateOnly(normalizedClickedDate);
                const end = anchorDate <= normalizedClickedDate ? cloneDateOnly(normalizedClickedDate) : cloneDateOnly(anchorDate);
                
                const newDates = new Set(prev);
                let current = cloneDateOnly(start);
                while (current <= end) {
                    newDates.add(formatFormatDateForState(current));
                    current.setDate(current.getDate() + 1);
                }
                return Array.from(newDates);
            });
            setLastClickedDate(dateStr);
        } else {
            setLastClickedDate(dateStr);
            setSelectedDates([dateStr]);
        }
    };

    const handleMovePage = (direction) => {
        startTransition(() => {
            setCurrentPageIndex((prevIndex) => {
                const nextIndex = prevIndex + direction;
                if (nextIndex < 0 || nextIndex >= pages.length) {
                    return prevIndex;
                }
                return nextIndex;
            });
        });
    };

    const handleExportExcel = async () => {
        const dateRangeStr = sortedDates.length > 1
            ? `${computedStartDate},${computedEndDate}`
            : computedStartDate;
        let alertTitle = '';
        let alertMessage = '';

        try {
            setIsOutputProcessing(true);
            const result = await DailyLogModel.fetchExportExcel(dateRangeStr, templateName, siteName, requestContext);
            if (result && result.success) {
                const fileList = Array.isArray(result.files) && result.files.length
                    ? `\n${result.files.join('\n')}`
                    : '';
                alertTitle = '일지 생성 완료';
                alertMessage = `${templateName} 생성이 완료되었습니다.${fileList}`;
            } else {
                alertTitle = '일지 생성 실패';
                alertMessage = result?.userMessage || result?.message || result?.error || '일지 생성 결과를 확인하지 못했습니다.';
            }
        } catch (error) {
            alertTitle = '내보내기 실패';
            alertMessage = error?.data?.userMessage || error?.message || '엑셀 내보내기를 시작하지 못했습니다.';
        } finally {
            setIsOutputProcessing(false);
        }

        if (alertMessage) {
            if (showToast) {
                showToast(alertMessage, alertTitle.includes('실패') ? 'error' : 'success');
            }
        }
    };

    const pageIndicator = currentPage
        ? `${currentPageIndex + 1}/${pages.length || 1}`
        : '0/0';

    const selectedDateLabel = sortedDates.length > 1
        ? `${computedStartDate} ~ ${computedEndDate} (총 ${sortedDates.length}일)`
        : computedStartDate;

    const dashboardSummary = {
        dashboardType: isDailyWorkLog ? 'daily-work-log' : 'water-analysis',
        title: templateName,
        selectedDateLabel,
        selectedDateCount: sortedDates.length,
        totalSheetCount: pages.length,
        datedSheetCount: new Set(pages.map((page) => page.date)).size,
        totalPhotoCount: dashboardRows.reduce((sum, row) => sum + (row.photoCount || 0), 0),
        expectedPhotoCount: pages.length * expectedPhotoCountPerSheet,
        totalExperimentCount: pages.reduce((sum, page) => sum + (page.rowCount || 0), 0),
        totalFlowDataDates: dashboardRows.reduce((sum, row) => sum + (row.hasFlowData ? 1 : 0), 0),
        totalAggregateDataDates: dashboardRows.reduce((sum, row) => sum + (row.hasAggregateData ? 1 : 0), 0),
        totalMaterialDataDates: dashboardRows.reduce((sum, row) => sum + (row.hasMaterialData ? 1 : 0), 0),
        totalPowerDataDates: dashboardRows.reduce((sum, row) => sum + (row.hasPowerData ? 1 : 0), 0),
        issueDateCount: dashboardRows.reduce((sum, row) => sum + (row.hasPrimaryData ? 0 : 1), 0),
    };

    const dashboardDateRows = sortedDates.map((date) => {
        const datePages = pages.filter((page) => page.date === date);
        const dateDashboardRows = dashboardRows.filter((row) => row.date === date);

        if (isDailyWorkLog) {
            const dailyRow = dateDashboardRows[0];
            return {
                id: date,
                date,
                sheetCount: datePages.length || 1,
                flowStatus: dailyRow?.flowStatus || '없음',
                aggregateStatus: dailyRow?.aggregateStatus || '없음',
                powerStatus: dailyRow?.powerStatus || '없음',
                status: dailyRow?.status || '데이터 없음',
            };
        }

        return {
            id: date,
            date,
            sheetCount: datePages.length,
            experimentCount: datePages.reduce((sum, page) => sum + (page.rowCount || 0), 0),
            photoCount: dateDashboardRows.reduce((sum, row) => sum + (row.photoCount || 0), 0),
            status: datePages.length ? '데이터 있음' : '데이터 없음',
        };
    });

    return {
        selectedDates,
        handleDateClick,
        pages,
        currentPage,
        pageRenderData,
        currentPageIndex,
        pageIndicator,
        selectedDateLabel,
        isManifestLoading,
        isPreviewAssetLoading,
        isOutputProcessing,
        manifestError,
        manifestErrorCode,
        hasPreviousPage: currentPageIndex > 0,
        hasNextPage: currentPageIndex < pages.length - 1,
        handlePrevPage: () => handleMovePage(-1),
        handleNextPage: () => handleMovePage(1),
        handleExportExcel,
        activeDates,
        setCalendarActiveStartDate,
        dashboardRows,
        dashboardDateRows,
        dashboardSummary,
        isDashboardLoading,
    };
};
