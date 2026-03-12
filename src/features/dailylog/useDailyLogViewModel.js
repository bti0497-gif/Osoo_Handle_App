import { startTransition, useEffect, useState } from 'react';
import { DailyLogModel } from './DailyLogModel';
import { buildFixedPreviewPrintableDocumentHtml, openPrintableDocument } from './dailyLogHtmlDocument';

function buildCurrentPdfFileName(templateName, currentPage) {
    if (!currentPage) {
        return 'preview.pdf';
    }

    const safeTemplateName = String(templateName || '수질분석일지').trim() || '수질분석일지';
    return `${safeTemplateName}-${currentPage.date}-${currentPage.pageNumberForDate}.pdf`;
}

function buildRangePdfFileName(templateName, startDate, endDate) {
    const safeTemplateName = String(templateName || '수질분석일지').trim() || '수질분석일지';
    return startDate === endDate
        ? `${safeTemplateName}-${startDate}.pdf`
        : `${safeTemplateName}-${startDate}_${endDate}.pdf`;
}

export const useDailyLogViewModel = (currentUser, initialDate, templateName, showAlert) => {
    const today = initialDate || new Date().toISOString().split('T')[0];
    const [startDate, setStartDate] = useState(today);
    const [endDate, setEndDate] = useState(today);
    const [isRangeMode, setIsRangeMode] = useState(false);
    const [pages, setPages] = useState([]);
    const [currentPageIndex, setCurrentPageIndex] = useState(0);
    const [isManifestLoading, setIsManifestLoading] = useState(true);
    const [manifestError, setManifestError] = useState('');
    const [manifestErrorCode, setManifestErrorCode] = useState('');
    const [pageRenderData, setPageRenderData] = useState(null);
    const [isPreviewAssetLoading, setIsPreviewAssetLoading] = useState(false);
    const [isOutputProcessing, setIsOutputProcessing] = useState(false);

    useEffect(() => {
        let isDisposed = false;

        const loadManifest = async () => {
            setIsManifestLoading(true);
            setManifestError('');
            setManifestErrorCode('');

            try {
                const result = await DailyLogModel.fetchPreviewManifest(startDate, endDate, templateName);
                if (isDisposed) {
                    return;
                }

                const nextPages = Array.isArray(result.pages) ? result.pages : [];
                setPages(nextPages);
                setCurrentPageIndex((prevIndex) => {
                    if (!nextPages.length) {
                        return 0;
                    }
                    return Math.min(prevIndex, nextPages.length - 1);
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
    }, [startDate, endDate, templateName]);

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
                    startDate,
                    endDate,
                    pageKey: currentPage.pageKey,
                    templateName,
                });

                if (!isDisposed) {
                    setPageRenderData(result.page || null);
                }
            } catch (_) {
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
    }, [currentPage, endDate, startDate, templateName]);

    const handleStartDateChange = (nextDate) => {
        setStartDate(nextDate);
        if (!isRangeMode) {
            setEndDate(nextDate);
        } else if (nextDate > endDate) {
            setEndDate(nextDate);
        }
        setCurrentPageIndex(0);
    };

    const handleEndDateChange = (nextDate) => {
        setEndDate(nextDate);
        if (nextDate < startDate) {
            setStartDate(nextDate);
        }
        setCurrentPageIndex(0);
    };

    const handleToggleRangeMode = () => {
        setCurrentPageIndex(0);
        setIsRangeMode((prev) => {
            if (prev) {
                setEndDate(startDate);
                return false;
            }

            const nextDay = new Date(`${startDate}T00:00:00`);
            if (!Number.isNaN(nextDay.getTime())) {
                nextDay.setDate(nextDay.getDate() + 1);
                const normalizedNextDay = nextDay.toISOString().split('T')[0];
                setEndDate(startDate === endDate ? normalizedNextDay : endDate);
            }
            return true;
        });
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

    const openHtmlPrintDocument = async (pagesToRender, defaultFileName) => {
        if (!pagesToRender.length) {
            return;
        }

        const title = defaultFileName.replace(/\.pdf$/i, '');
        const documentHtml = buildFixedPreviewPrintableDocumentHtml({
            pages: pagesToRender,
            title,
        });

        openPrintableDocument(documentHtml);
    };

    const savePdfDocument = async (pagesToRender, defaultFileName) => {
        if (!pagesToRender.length) {
            return;
        }

        const documentHtml = buildFixedPreviewPrintableDocumentHtml({
            pages: pagesToRender,
            title: defaultFileName.replace(/\.pdf$/i, ''),
        });

        const electronApi = window?.electronAPI;
        if (electronApi?.savePdf) {
            const result = await electronApi.savePdf({
                defaultFileName,
                htmlContent: documentHtml,
            });

            return result;
        }

        openPrintableDocument(documentHtml);
        await showAlert?.('브라우저 환경에서는 시스템 인쇄 창에서 PDF로 저장해 주세요.', 'PDF 저장 안내');
        return { canceled: true, fallback: true };
    };

    const fetchRenderPages = async (targetPages) => {
        return Promise.all(targetPages.map(async (page) => {
            if (pageRenderData && currentPage?.pageKey === page.pageKey) {
                return pageRenderData;
            }

            const result = await DailyLogModel.fetchPreviewPageData({
                startDate,
                endDate,
                pageKey: page.pageKey,
                templateName,
            });

            return result.page || null;
        }));
    };

    const handlePrintCurrent = async () => {
        if (!currentPage || !pageRenderData) {
            return;
        }

        try {
            setIsOutputProcessing(true);
            await openHtmlPrintDocument([pageRenderData], buildCurrentPdfFileName(templateName, currentPage));
        } catch (error) {
            await showAlert?.(error?.data?.userMessage || error?.message || '출력용 HTML 문서를 만들지 못했습니다.', '출력 실패');
        } finally {
            setIsOutputProcessing(false);
        }
    };

    const handleDownloadCurrent = async () => {
        if (!currentPage || !pageRenderData) {
            return;
        }
        try {
            setIsOutputProcessing(true);
            const result = await savePdfDocument([pageRenderData], buildCurrentPdfFileName(templateName, currentPage));
            if (!result?.canceled && !result?.fallback) {
                await showAlert?.('PDF 저장이 완료되었습니다.', 'PDF 저장 완료');
            }
        } catch (error) {
            await showAlert?.(error?.data?.userMessage || error?.message || 'PDF 저장용 HTML 문서를 만들지 못했습니다.', 'PDF 저장 실패');
        } finally {
            setIsOutputProcessing(false);
        }
    };

    const handlePrintRange = async () => {
        try {
            if (!pages.length) {
                return;
            }

            setIsOutputProcessing(true);
            const renderPages = (await fetchRenderPages(pages)).filter(Boolean);
            await openHtmlPrintDocument(renderPages, buildRangePdfFileName(templateName, startDate, endDate));
        } catch (error) {
            await showAlert?.(error?.data?.userMessage || error?.message || '범위 출력용 HTML 문서를 만들지 못했습니다.', '출력 실패');
        } finally {
            setIsOutputProcessing(false);
        }
    };

    const handleDownloadRange = async () => {
        try {
            if (!pages.length) {
                return;
            }

            setIsOutputProcessing(true);
            const renderPages = (await fetchRenderPages(pages)).filter(Boolean);
            const result = await savePdfDocument(renderPages, buildRangePdfFileName(templateName, startDate, endDate));
            if (!result?.canceled && !result?.fallback) {
                await showAlert?.('PDF 저장이 완료되었습니다.', 'PDF 저장 완료');
            }
        } catch (error) {
            await showAlert?.(error?.data?.userMessage || error?.message || '범위 PDF 저장용 HTML 문서를 만들지 못했습니다.', 'PDF 저장 실패');
        } finally {
            setIsOutputProcessing(false);
        }
    };

    const pageIndicator = currentPage
        ? `${currentPageIndex + 1}/${pages.length || 1}`
        : '0/0';

    const selectedDateLabel = isRangeMode && startDate !== endDate
        ? `${startDate} ~ ${endDate}`
        : startDate;

    return {
        startDate,
        endDate,
        isRangeMode,
        setIsRangeMode: handleToggleRangeMode,
        setStartDate: handleStartDateChange,
        setEndDate: handleEndDateChange,
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
        handlePrintCurrent,
        handleDownloadCurrent,
        handlePrintRange,
        handleDownloadRange,
    };
};
