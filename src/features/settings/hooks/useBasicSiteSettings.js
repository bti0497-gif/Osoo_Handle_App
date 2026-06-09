import { SettingsModel } from '../SettingsModel';
import { EMPTY_SITE_INFO, getDefaultFlowOptionBySeries } from '../settingsDefaults';

export const useBasicSiteSettings = ({
    siteInfo,
    setSiteInfo,
    availableSites,
    selectedSiteId,
    setSelectedSiteId,
    setFlowOption,
    hasLoadedSettings,
    resetItemListsToDefaults,
    reloadSettings,
    showAlert,
    showConfirm,
} = {}) => {
    const applySiteSelection = (site, { resetDefaults = false, preserveLocation = false } = {}) => {
        if (!site) {
            setSelectedSiteId?.('');
            setSiteInfo?.(EMPTY_SITE_INFO);
            setFlowOption?.('single1');
            if (resetDefaults) {
                resetItemListsToDefaults?.('1계열', 'A2O');
            }
            return;
        }

        setSelectedSiteId?.(String(site.id || ''));
        setSiteInfo?.((prev) => ({
            siteId: String(site.id || ''),
            siteName: site.site_name || '',
            managerName: site.manager_name || '',
            method: site.method || '',
            series: site.series || '',
            targetLat: preserveLocation ? prev.targetLat : (site.target_lat ?? null),
            targetLng: preserveLocation ? prev.targetLng : (site.target_lng ?? null),
            radiusM: site.radius_m ?? 500
        }));
        setFlowOption?.(getDefaultFlowOptionBySeries(site.series || '1계열'));

        if (resetDefaults) {
            resetItemListsToDefaults?.(site.series || '1계열', site.method || 'A2O');
        }
    };

    const handleCaptureSiteLocation = async () => {
        if (!selectedSiteId || !siteInfo?.siteName) {
            showAlert?.('먼저 현장을 선택해주세요.');
            return;
        }
        try {
            const data = await SettingsModel.getCurrentLocation();
            if (!data?.success || data?.latitude == null || data?.longitude == null) {
                throw new Error('현재 위치를 확인할 수 없습니다.');
            }
            const response = await SettingsModel.saveSiteLocation(data.latitude, data.longitude);
            if (!response?.success) {
                throw new Error(response?.message || '위치 저장에 실패했습니다.');
            }
            setSiteInfo?.((prev) => ({
                ...prev,
                targetLat: response.targetLat,
                targetLng: response.targetLng,
                radiusM: response.radiusM ?? prev.radiusM ?? 500
            }));
            showAlert?.('현장 기준 위치가 저장되었습니다.');
        } catch (err) {
            showAlert?.('위치 저장 중 오류가 발생했습니다: ' + err.message);
        }
    };

    const handleSiteSelection = async (siteId) => {
        const nextSiteId = String(siteId || '');
        const currentSiteId = String(selectedSiteId || '');

        if (nextSiteId && currentSiteId && nextSiteId !== currentSiteId && hasLoadedSettings) {
            const confirmed = await showConfirm?.(
                '이미 현장이 저장된 상태입니다.\n현장을 변경하면 이후 저장 데이터 기준 현장이 바뀝니다.\n선택한 현장으로 변경하시겠습니까?'
            );
            if (!confirmed) {
                return;
            }
        }

        if (!nextSiteId) {
            applySiteSelection(null, { resetDefaults: true });
            return;
        }

        const selectedSite = availableSites?.find((site) => String(site.id) === nextSiteId);
        if (!selectedSite) {
            applySiteSelection(null, { resetDefaults: true });
            return;
        }

        applySiteSelection(selectedSite, { resetDefaults: true, preserveLocation: true });

        try {
            const response = await SettingsModel.selectSite(nextSiteId);
            if (!response?.success) {
                throw new Error(response?.message || '현장 선택 저장에 실패했습니다.');
            }

            const boundSite = response.site
                ? {
                    id: response.site.id,
                    site_name: response.site.site_name,
                    manager_name: response.site.manager_name,
                    method: response.site.method,
                    series: response.site.series,
                    target_lat: response.site.target_lat,
                    target_lng: response.site.target_lng,
                    radius_m: response.site.radius_m
                }
                : selectedSite;

            applySiteSelection(boundSite, { resetDefaults: true });
            await reloadSettings?.();
        } catch (err) {
            console.error('Site selection error:', err);
            showAlert?.('현장 선택 중 오류가 발생했습니다: ' + err.message);
            await reloadSettings?.();
        }
    };

    return {
        applySiteSelection,
        handleCaptureSiteLocation,
        handleSiteSelection,
    };
};
