import { startTransition, useEffect, useMemo, useState } from 'react';
import { DailyLogModel } from './DailyLogModel';

export const useDailyLogViewModel = (currentUser, initialDate, templateName) => {
    const today = initialDate || new Date().toISOString().split('T')[0];
    const [startDate, setStartDate] = useState(today);
    const [endDate, setEndDate] = useState(today);
    const [isRangeMode, setIsRangeMode] = useState(false);
    const [pages, setPages] = useState([]);
    const [currentPageIndex, setCurrentPageIndex] = useState(0);
    const [isManifestLoading, setIsManifestLoading] = useState(true);
    const [manifestError, setManifestError] = useState('');
    const [manifestErrorCode, setManifestErrorCode] = useState('');
    const [resolvedPreviewUrl, setResolvedPreviewUrl] = useState('');
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

    const pagePreviewUrls = useMemo(() => pages.map((page) => DailyLogModel.getPagePreviewPdfUrl({
        startDate,
        endDate,
        pageKey: page.pageKey,
        templateName,
    })), [endDate, pages, startDate, templateName]);

    const previewUrl = useMemo(() => {
        if (!currentPage) {
            return '';
        }

        return DailyLogModel.getPagePreviewPdfUrl({
            startDate,
            endDate,
            pageKey: currentPage.pageKey,
            templateName,
        });
    }, [currentPage, endDate, startDate, templateName]);

    useEffect(() => {
        if (!pagePreviewUrls.length) {
            return;
        }

        DailyLogModel.primePreviewPdfUrls(pagePreviewUrls);
    }, [pagePreviewUrls]);

    useEffect(() => {
        let isDisposed = false;

        const resolvePreviewAsset = async () => {
            if (!previewUrl) {
                setResolvedPreviewUrl('');
                setIsPreviewAssetLoading(false);
                return;
            }

            setIsPreviewAssetLoading(true);

            try {
                const nextResolvedUrl = await DailyLogModel.getCachedPreviewPdfUrl(previewUrl);
                if (!isDisposed) {
                    setResolvedPreviewUrl(nextResolvedUrl);
                }
            } catch (_) {
                if (!isDisposed) {
                    setResolvedPreviewUrl('');
                }
            } finally {
                if (!isDisposed) {
                    setIsPreviewAssetLoading(false);
                }
            }
        };

        resolvePreviewAsset();

        return () => {
            isDisposed = true;
        };
    }, [previewUrl]);

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

    const handlePrintCurrent = () => {
        window.open(previewUrl, '_blank', 'noopener,noreferrer');
    };

    const handleDownloadCurrent = () => {
        const link = document.createElement('a');
        link.href = currentPageDownloadUrl;
        link.download = '';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handlePrintRange = () => {
        window.open(rangePreviewUrl, '_blank', 'noopener,noreferrer');
    };

    const handleDownloadRange = () => {
        const link = document.createElement('a');
        link.href = rangeDownloadUrl;
        link.download = '';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
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
        currentPageIndex,
        pageIndicator,
        selectedDateLabel,
        previewUrl: resolvedPreviewUrl || previewUrl,
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
