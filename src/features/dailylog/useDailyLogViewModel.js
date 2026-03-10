import { startTransition, useEffect, useMemo, useState } from 'react';
import { DailyLogModel } from './DailyLogModel';

function buildCurrentPdfFileName(templateName, currentPage) {
    if (!currentPage) {
        return 'preview.pdf';
    }

    const safeTemplateName = String(templateName || '수질분석일지').trim() || '수질분석일지';
    return `${safeTemplateName}-${currentPage.date}-${currentPage.pageNumberForDate}.pdf`;
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

    const firstPagePreviewUrl = useMemo(() => DailyLogModel.getPagePreviewPdfUrl({
        startDate,
        endDate,
        templateName,
    }), [endDate, startDate, templateName]);

    const previewUrl = useMemo(() => {
        if (!currentPage || currentPageIndex === 0) {
            return firstPagePreviewUrl;
        }

        return DailyLogModel.getPagePreviewPdfUrl({
            startDate,
            endDate,
            pageKey: currentPage.pageKey,
            templateName,
        });
    }, [currentPage, currentPageIndex, endDate, firstPagePreviewUrl, startDate, templateName]);

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

    useEffect(() => {
        if (!currentPage || !previewUrl) {
            return;
        }

        DailyLogModel.primePreviewPdfUrls([previewUrl]);
    }, [currentPage, previewUrl]);

    const currentPageDownloadUrl = useMemo(() => {
        if (!currentPage) {
            return '';
        }

        return DailyLogModel.getPagePreviewPdfUrl({
            startDate,
            endDate,
            pageKey: currentPage.pageKey,
            templateName,
            download: true,
        });
    }, [currentPage, endDate, startDate, templateName]);

    const rangePreviewUrl = useMemo(() => DailyLogModel.getBatchPreviewPdfUrl({
        startDate,
        endDate,
        templateName,
    }), [endDate, startDate, templateName]);

    const rangeDownloadUrl = useMemo(() => DailyLogModel.getBatchPreviewPdfUrl({
        startDate,
        endDate,
        templateName,
        download: true,
    }), [endDate, startDate, templateName]);

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

    const handlePrintCurrent = async () => {
        if (!previewUrl) {
            return;
        }

        try {
            const pdfUrl = await DailyLogModel.getCachedPreviewPdfUrl(previewUrl);
            const iframe = document.createElement('iframe');
            iframe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:0;height:0;border:none;';
            document.body.appendChild(iframe);
            iframe.src = pdfUrl;
            iframe.onload = () => {
                try {
                    iframe.contentWindow.focus();
                    iframe.contentWindow.print();
                } catch (_) {
                    window.open(pdfUrl, '_blank');
                }
                setTimeout(() => document.body.removeChild(iframe), 60000);
            };
        } catch (_) {
            window.open(previewUrl, '_blank');
        }
    };

    const handleDownloadCurrent = async () => {
        if (!previewUrl) {
            return;
        }

        const link = document.createElement('a');
        try {
            const cachedUrl = await DailyLogModel.getCachedPreviewPdfUrl(previewUrl);
            link.href = cachedUrl;
            link.download = buildCurrentPdfFileName(templateName, currentPage);
            document.body.appendChild(link);
            link.click();
            await showAlert?.('PDF 저장이 완료되었습니다. 다운로드 폴더를 확인해 주세요.', 'PDF 저장 완료');
        } catch (_) {
            link.href = currentPageDownloadUrl;
            link.download = '';
            document.body.appendChild(link);
            link.click();
            await showAlert?.('PDF 저장이 완료되었습니다. 다운로드 폴더를 확인해 주세요.', 'PDF 저장 완료');
        } finally {
            document.body.removeChild(link);
        }
    };

    const handlePrintRange = async () => {
        try {
            const pdfUrl = await DailyLogModel.getCachedPreviewPdfUrl(rangePreviewUrl);
            const iframe = document.createElement('iframe');
            iframe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:0;height:0;border:none;';
            document.body.appendChild(iframe);
            iframe.src = pdfUrl;
            iframe.onload = () => {
                try {
                    iframe.contentWindow.focus();
                    iframe.contentWindow.print();
                } catch (_) {
                    window.open(pdfUrl, '_blank');
                }
                setTimeout(() => document.body.removeChild(iframe), 60000);
            };
        } catch (_) {
            window.open(rangePreviewUrl, '_blank');
        }
    };

    const handleDownloadRange = async () => {
        const link = document.createElement('a');
        try {
            const cachedUrl = await DailyLogModel.getCachedPreviewPdfUrl(rangePreviewUrl);
            link.href = cachedUrl;
            link.download = '';
            document.body.appendChild(link);
            link.click();
            await showAlert?.('PDF 저장이 완료되었습니다. 다운로드 폴더를 확인해 주세요.', 'PDF 저장 완료');
        } catch (_) {
            link.href = rangeDownloadUrl;
            link.download = '';
            document.body.appendChild(link);
            link.click();
            await showAlert?.('PDF 저장이 완료되었습니다. 다운로드 폴더를 확인해 주세요.', 'PDF 저장 완료');
        } finally {
            document.body.removeChild(link);
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
        previewUrl,
        isManifestLoading,
        isPreviewAssetLoading,
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
