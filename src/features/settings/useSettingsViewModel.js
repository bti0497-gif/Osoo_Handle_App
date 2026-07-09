import { useState, useEffect } from 'react';
import { SettingsModel } from './SettingsModel';
import { useBasicSiteSettings } from './hooks/useBasicSiteSettings';
import { useDefaultAmountSettings } from './hooks/useDefaultAmountSettings';
import { useExternalServiceSettings } from './hooks/useExternalServiceSettings';
import { useItemSettings } from './hooks/useItemSettings';
import { useMappingSettings } from './hooks/useMappingSettings';
import { useMeasurementPlaceSettings } from './hooks/useMeasurementPlaceSettings';
import { useTemplateSettings } from './hooks/useTemplateSettings';
import {
    ALPHABET,
    EMPTY_SITE_INFO,
    DEFAULT_MEDICINE_ITEMS,
    cloneItems,
    createDefaultFlowItems,
    createDefaultLocationItems,
    getDefaultFlowOptionBySeries,
} from './settingsDefaults';

export const useSettingsViewModel = (currentUser, { showAlert, showConfirm } = {}) => {
    const [activeTab, setActiveTab] = useState('basic');
    const [isLoading, setIsLoading] = useState(true);
    const [hasLoadedSettings, setHasLoadedSettings] = useState(false);
    const [isAppSiteConfigured, setIsAppSiteConfigured] = useState(false);

    const [siteInfo, setSiteInfo] = useState(EMPTY_SITE_INFO);
    const [availableSites, setAvailableSites] = useState([]);
    const [selectedSiteId, setSelectedSiteId] = useState('');
    const [isSiteListLoading, setIsSiteListLoading] = useState(false);
    // flowOption state: 'single1' | 'single2' | 'combined' (2계열 기본은 combined)
    const [flowOption, setFlowOption] = useState('single1');
    const [sludgeExportSettings, setSludgeExportSettings] = useState({
        companyName: '',
        defaultAmount: ''
    });
    const [isSavingSludgeExportSettings, setIsSavingSludgeExportSettings] = useState(false);

    const [flowConfig, setFlowConfig] = useState({ sheet: '', startRow: 1, endRow: 31, dateCol: 'A' });
    const [flowMapping, setFlowMapping] = useState({});

    const [medicineConfig, setMedicineConfig] = useState({ sheet: '', startRow: 1, endRow: 31, dateCol: 'A' });
    const [medicineMapping, setMedicineMapping] = useState({});

    const [kitConfig, setKitConfig] = useState({ sheet: '', startRow: 1, endRow: 31, dateCol: 'A' });
    const [kitMapping, setKitMapping] = useState({});

    const [waterConfig, setWaterConfig] = useState({ sheet: '', startRow: 1, endRow: 31, dateCol: 'A' });
    const [waterMapping, setWaterMapping] = useState({});

    const {
        flowItems,
        setFlowItems,
        medicineItems,
        setMedicineItems,
        waterItems,
        setWaterItems,
        kitItems,
        setKitItems,
        newFlowItem,
        setNewFlowItem,
        newMedicineItem,
        setNewMedicineItem,
        resetItemListsToDefaults,
        handleSeriesChange,
        addItem: addManagedItem,
        toggleItem: toggleManagedItem,
        getFlowRowsForExcelMapping,
    } = useItemSettings({ siteInfo, setSiteInfo, setFlowOption, showAlert });

    const {
        locationItems,
        setLocationItems,
        newLocationItem,
        setNewLocationItem,
        resetLocationItemsToDefaults,
        addLocationItem,
        toggleLocationItem,
        moveLocationItem,
    } = useMeasurementPlaceSettings({ showAlert });

    const resetAllItemListsToDefaults = (series = '1계열', method = 'A2O') => {
        resetItemListsToDefaults(series, method);
        resetLocationItemsToDefaults(method);
    };

    const addItem = (type) => {
        if (type === 'location') return addLocationItem();
        return addManagedItem(type);
    };

    const toggleItem = (type, index) => {
        if (type === 'location') return toggleLocationItem(index);
        return toggleManagedItem(type, index);
    };

    // --- Log Mapping State ---
    const LOG_TYPES = [
        { id: 'daily_work_log', label: '일일업무일지' },
        { id: 'water_analysis_log', label: '수질분석일지' },
        { id: 'medicine_ledger', label: '약품관리대장' },
        { id: 'medicine_receipt_log', label: '약품입고일지' },
        { id: 'sludge_export_ledger', label: '슬러지반출관리대장' },
        { id: 'sludge_photo_ledger', label: '슬러지사진대지' }
    ];
    const [selectedLogType, setSelectedLogType] = useState('daily_work_log');

    const {
        excelFileName,
        templateFileNames,
        templateFiles,
        setTemplateFiles,
        excelSheets,
        sampleRowData,
        excelStatus,
        isMetadataLoading,
        isPreviewLoading,
        isUploading,
        hydrateTemplateSettings,
        checkExcelStatus,
        loadExcelPreview,
        handleExcelFileUpload,
        handleTemplateFileChange,
        handleOpenLocalFolder,
    } = useTemplateSettings({ showAlert, reloadSettings: () => loadSettings() });

    const {
        webAppCredentials,
        setWebAppCredentials,
        qntechImportSettings,
        setQntechImportSettings,
        passwordVisibility,
        urlEditability,
        geminiApiKey,
        setGeminiApiKey,
        geminiKeyVisible,
        setGeminiKeyVisible,
        hydrateExternalSettings,
        updateWebAppCredentialField,
        togglePasswordVisibility,
        toggleUrlEditability,
        handleSaveWebAppCredentials,
        updateQntechImportSettingField,
        updateQntechSampleMapping,
        addQntechSampleMapping,
        removeQntechSampleMapping,
        handleSaveQntechImportSettings,
        handleSaveGeminiApiKey,
    } = useExternalServiceSettings({ showAlert, reloadSettings: () => loadSettings() });

    const {
        importProgress,
        setImportProgress,
        importedData,
        showDataModal,
        setShowDataModal,
        handleSaveFlowMapping,
        handleSaveMedicineMapping,
        handleSaveKitMapping,
        handleSaveWaterMapping,
    } = useMappingSettings({
        flowConfig,
        flowMapping,
        medicineConfig,
        medicineMapping,
        kitConfig,
        kitMapping,
        waterConfig,
        waterMapping,
        reloadSettings: () => loadSettings(),
    });

    const {
        showDefaultAmountModal,
        setShowDefaultAmountModal,
        defaultAmountItems,
        setDefaultAmountItems,
        isSavingDefaultAmounts,
        handleOpenDefaultAmountModal,
        handleSaveDefaultAmounts,
        showKitDefaultModal,
        setShowKitDefaultModal,
        kitDefaultItems,
        setKitDefaultItems,
        isSavingKitDefaults,
        handleOpenKitDefaultModal,
        handleSaveKitDefaults,
    } = useDefaultAmountSettings({ medicineItems, showAlert });

    const {
        applySiteSelection,
        handleSiteSelection,
    } = useBasicSiteSettings({
        siteInfo,
        setSiteInfo,
        availableSites,
        selectedSiteId,
        setSelectedSiteId,
        setFlowOption,
        hasLoadedSettings,
        isAppSiteConfigured,
        resetItemListsToDefaults: resetAllItemListsToDefaults,
        reloadSettings: () => loadSettings({ force: true }),
        showAlert,
        showConfirm,
    });

    // 초기 설정 로드는 마운트 시 1회만 수행한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { loadSettings(); }, []);

    useEffect(() => {
        if (activeTab === 'flow' || activeTab === 'medicine' || activeTab === 'kit' || activeTab === 'water') {
            if (excelStatus.status !== 'ready' && excelStatus.status !== 'loading') {
                checkExcelStatus();
            }
        }
    }, [activeTab, excelStatus.sheets, excelStatus.status]);

    useEffect(() => {
        if (activeTab === 'flow' && flowConfig.sheet && flowConfig.startRow)
            loadExcelPreview(flowConfig.sheet, flowConfig.startRow);
        else if (activeTab === 'medicine' && medicineConfig.sheet && medicineConfig.startRow)
            loadExcelPreview(medicineConfig.sheet, medicineConfig.startRow);
        else if (activeTab === 'kit' && kitConfig.sheet && kitConfig.startRow)
            loadExcelPreview(kitConfig.sheet, kitConfig.startRow);
        else if (activeTab === 'water' && waterConfig.sheet && waterConfig.startRow)
            loadExcelPreview(waterConfig.sheet, waterConfig.startRow);
    }, [activeTab, flowConfig.sheet, flowConfig.startRow, medicineConfig.sheet, medicineConfig.startRow, kitConfig.sheet, kitConfig.startRow, waterConfig.sheet, waterConfig.startRow]);

    const resetBasicItemsToDefaults = (series = '1계열', method = 'A2O') => {
        resetAllItemListsToDefaults(series, method);
        setFlowMapping({});
        setMedicineMapping({});
        setWaterMapping({});
        setKitMapping({});
    };

    const normalizeLocationItemsForSite = (storedLocations = [], method = 'A2O') => {
        const restored = storedLocations.map((item) => ({
            name: item.item_name,
            checked: !!item.is_active
        }));
        const isMbr = String(method || '').trim().toUpperCase() === 'MBR';
        const defaultLocations = createDefaultLocationItems(method);
        const defaultNames = new Set(defaultLocations.map((item) => item.name));
        const restoredByName = new Map(restored.map((item) => [item.name, item]));

        const normalizedDefaults = defaultLocations.map((item) => {
            const saved = restoredByName.get(item.name);
            if (isMbr && item.name === '침전조') return { ...item, checked: false };
            return saved ? { ...item, checked: saved.checked } : item;
        });

        const customLocations = restored.filter((item) => {
            if (defaultNames.has(item.name)) return false;
            return true;
        });

        return [...normalizedDefaults, ...customLocations];
    };

    const normalizeFlowItemsForSite = (storedFlows = [], series = '1계열', method = 'A2O') => {
        const restored = storedFlows.map((item) => ({
            name: item.item_name,
            checked: !!item.is_active
        }));
        const defaults = createDefaultFlowItems(series, method);
        const expectedNames = new Set(defaults.map((item) => item.name));
        const restoredByName = new Map(restored.map((item) => [item.name, item]));
        const knownBuiltInNames = new Set(
            [
                ...createDefaultFlowItems('1계열', 'A2O'),
                ...createDefaultFlowItems('1계열', 'MBR'),
                ...createDefaultFlowItems('2계열', 'A2O'),
                ...createDefaultFlowItems('2계열', 'MBR'),
            ].map((item) => item.name)
        );

        const normalizedDefaults = defaults.map((item) => {
            const saved = restoredByName.get(item.name);
            return saved ? { ...item, checked: saved.checked } : item;
        });
        const extraItems = restored
            .filter((item) => !expectedNames.has(item.name))
            .map((item) => (
                knownBuiltInNames.has(item.name)
                    ? { ...item, checked: false }
                    : item
            ));

        return [...normalizedDefaults, ...extraItems];
    };

    const loadSettings = async (options = {}) => {
        try {
            setIsSiteListLoading(true);
            const [data, sitesData] = await Promise.all([
                SettingsModel.getSettings({ force: options.force }),
                SettingsModel.getSites().catch(() => null)
            ]);

            const siteList = Array.isArray(sitesData?.sites) ? sitesData.sites : [];
            setAvailableSites(siteList);

            if (data?.success && data.settings) {
                const hasSavedSiteIdentity = Boolean(
                    String(data.settings.site_id || '').trim() || String(data.settings.site_name || '').trim()
                );

                setIsAppSiteConfigured(hasSavedSiteIdentity);

                if (data.settings.site_name || data.settings.excel_template_path) setHasLoadedSettings(true);

                // 설치 후 저장된 현장 설정은 재진입 시 자동으로 복원한다.
                const savedSiteId = String(data.settings.site_id || '').trim();
                const savedSiteName = String(data.settings.site_name || '').trim();
                const matchedSite = siteList.find((site) => String(site?.id || '') === savedSiteId)
                    || siteList.find((site) => String(site?.site_name || '').trim() === savedSiteName);

                const resolvedSeries = String((matchedSite?.series ?? data.settings.series ?? '1계열') || '1계열').trim() || '1계열';
                const resolvedMethod = String((matchedSite?.method ?? data.settings.method ?? 'A2O') || 'A2O').trim() || 'A2O';

                if (matchedSite) {
                    applySiteSelection({
                        ...matchedSite,
                        target_lat: matchedSite.target_lat ?? data.settings.target_lat,
                        target_lng: matchedSite.target_lng ?? data.settings.target_lng,
                        radius_m: matchedSite.radius_m ?? data.settings.radius_m
                    });
                } else if (savedSiteId || savedSiteName) {
                    // 사이트 목록 조회가 지연/실패해도 마지막 저장값은 화면에 유지한다.
                    applySiteSelection({
                        id: savedSiteId,
                        site_name: data.settings.site_name || '',
                        manager_name: data.settings.manager_name || '',
                        method: data.settings.method || '',
                        series: data.settings.series || '',
                        target_lat: data.settings.target_lat,
                        target_lng: data.settings.target_lng,
                        radius_m: data.settings.radius_m
                    });
                } else {
                    applySiteSelection(null);
                }

                hydrateTemplateSettings(data.settings);
                if (data.sludgeExportSettings) {
                    const normalizedCompanyName = data.sludgeExportSettings.company_name || '';
                    const normalizedDefaultAmount = data.sludgeExportSettings.default_amount == null
                        ? ''
                        : Number(data.sludgeExportSettings.default_amount);

                    // 초기 시드(업체명 공백 + 0)는 미입력 상태로 본다.
                    const isSeedDefault = normalizedCompanyName.trim() === '' && normalizedDefaultAmount === 0;
                    setSludgeExportSettings({
                        companyName: normalizedCompanyName,
                        defaultAmount: isSeedDefault ? '' : normalizedDefaultAmount
                    });
                }
                if (data.settings.flow_sheet) setFlowConfig({ sheet: data.settings.flow_sheet, startRow: data.settings.flow_start_row || 1, endRow: data.settings.flow_end_row || 31, dateCol: data.settings.flow_date_col || 'A' });
                setFlowOption(getDefaultFlowOptionBySeries(resolvedSeries));
                if (data.settings.med_sheet) setMedicineConfig({ sheet: data.settings.med_sheet, startRow: data.settings.med_start_row || 1, endRow: data.settings.med_end_row || 31, dateCol: data.settings.med_date_col || 'A' });
                if (data.settings.kit_sheet) setKitConfig({ sheet: data.settings.kit_sheet, startRow: data.settings.kit_start_row || 1, endRow: data.settings.kit_end_row || 31, dateCol: data.settings.kit_date_col || 'A' });
                if (data.settings.water_sheet) setWaterConfig({ sheet: data.settings.water_sheet, startRow: data.settings.water_start_row || 1, endRow: data.settings.water_end_row || 31, dateCol: data.settings.water_date_col || 'A' });

                hydrateExternalSettings(data.credentials, data.settings);

                if (!hasSavedSiteIdentity) {
                    resetBasicItemsToDefaults();
                } else if (data.configItems?.length > 0) {
                    const flows = data.configItems.filter(i => i.category === 'flow');
                    if (flows.length > 0) {
                        const baseFlows = flows.filter(i => !i.item_name.includes('_raw') && !i.item_name.includes('_flow'));
                        const restored = {};
                        flows.forEach(i => {
                            if (i.excel_cell && (i.item_name.endsWith('_raw') || i.item_name.endsWith('_flow'))) {
                                restored[i.item_name] = i.excel_cell;
                            }
                        });
                        setFlowItems(normalizeFlowItemsForSite(baseFlows, resolvedSeries, resolvedMethod));
                        setFlowMapping(restored);
                    } else {
                        setFlowItems(createDefaultFlowItems(resolvedSeries, resolvedMethod));
                        setFlowMapping({});
                    }
                    const meds = data.configItems.filter(i => i.category === 'medicine');
                    if (meds.length > 0) {
                        const baseMeds = meds.filter(i => !i.item_name.endsWith('_purchase') && !i.item_name.endsWith('_usage') && !i.item_name.endsWith('_inventory'));
                        if (baseMeds.length > 0) {
                            setMedicineItems(baseMeds.map(i => ({ name: i.item_name, checked: !!i.is_active, defaultAmount: Number(i.default_amount) || 0 })));
                        } else {
                            // 신규/비정상 상태(기본 항목 없음)에서는 기본 3종 강제
                            setMedicineItems(cloneItems(DEFAULT_MEDICINE_ITEMS));
                        }
                        const restored = {};
                        meds.forEach(i => {
                            if (i.excel_cell && (i.item_name.endsWith('_purchase') || i.item_name.endsWith('_usage') || i.item_name.endsWith('_inventory'))) {
                                restored[i.item_name] = i.excel_cell;
                            }
                        });
                        if (Object.keys(restored).length > 0) setMedicineMapping(restored);
                    } else {
                        // 저장된 약품 항목이 전혀 없으면 초기 기본 3종 사용
                        setMedicineItems(cloneItems(DEFAULT_MEDICINE_ITEMS));
                    }
                    const water = data.configItems.filter(i => i.category === 'water');
                    if (water.length > 0) {
                        // water 카테고리는 이제 순수 파라미터명만 포함되지만, 안전을 위해 필터링 유지
                        const baseWater = water.filter(i => !i.item_name.includes('_'));
                        setWaterItems(baseWater.map(i => ({ name: i.item_name, checked: !!i.is_active })));
                    }

                    // 매핑 정보 복원: 신규 water_mapping 카테고리만 신뢰한다.
                    // 레거시 water 카테고리의 밑줄 포함 항목은 파라미터/장소 설정과 충돌할 수 있어 복원하지 않는다.
                    const waterMappings = data.configItems.filter(i => i.category === 'water_mapping');

                    const restoredWaterMapping = {};
                    waterMappings.forEach(i => { if (i.excel_cell) restoredWaterMapping[i.item_name] = i.excel_cell; });

                    if (Object.keys(restoredWaterMapping).length > 0) {
                        setWaterMapping(restoredWaterMapping);
                    }
                    const kits = data.configItems.filter(i => i.category === 'kit');
                    if (kits.length > 0) {
                        const baseKits = kits.filter(i => !i.item_name.endsWith('_purchase') && !i.item_name.endsWith('_usage') && !i.item_name.endsWith('_inventory'));
                        setKitItems(baseKits.map(i => ({ name: i.item_name, checked: !!i.is_active, defaultAmount: Number(i.default_amount) || 0 })));

                        const restored = {};
                        kits.forEach(i => {
                            if (i.excel_cell && (i.item_name.endsWith('_purchase') || i.item_name.endsWith('_usage') || i.item_name.endsWith('_inventory'))) {
                                restored[i.item_name] = i.excel_cell;
                            }
                        });
                        if (Object.keys(restored).length > 0) setKitMapping(restored);
                    }
                    const locations = data.configItems.filter(i => i.category === 'location');
                    if (locations.length > 0) {
                        setLocationItems(normalizeLocationItemsForSite(locations, resolvedMethod));
                    } else {
                        setLocationItems(createDefaultLocationItems(resolvedMethod));
                    }
                } else {
                    // 저장 설정은 있으나 config_items가 비어있는 극초기 상태 대비
                    resetBasicItemsToDefaults(resolvedSeries, resolvedMethod);
                }
            }
        } catch (err) { console.warn('Settings load failed, using defaults:', err); }
        finally {
            setIsSiteListLoading(false);
            setIsLoading(false);
        }
    };

    const handleApply = async () => {
        try {
            if (!selectedSiteId || !siteInfo.siteName) {
                showAlert?.('기본설정을 저장하려면 먼저 현장을 선택해주세요.');
                return;
            }

            if (hasLoadedSettings) {
                const confirmed = await showConfirm?.("이미 기본 설정이 저장되어 있는 상태입니다. \n이 내용을 바탕으로 설정을 수정하시겠습니까?");
                if (!confirmed) return;
            }
            const configItems = [
                ...flowItems.map(i => ({ ...i, category: 'flow' })),
                ...medicineItems.map(i => ({ ...i, category: 'medicine' })),
                ...kitItems.map(i => ({ ...i, category: 'kit' })),
                ...locationItems.map(i => ({ ...i, category: 'location' }))
            ];
            const response = await SettingsModel.saveSettings({ settings: siteInfo, configItems });

            if (response.success) {
                showAlert?.('설정이 성공적으로 저장되었습니다.');
                setIsAppSiteConfigured(true);
                setTemplateFiles([]);
                loadSettings();
            } else {
                throw new Error(response.message || '알 수 없는 오류가 발생했습니다.');
            }
        } catch (err) {
            console.error('Settings Apply Error:', err);
            showAlert?.('저장 중 오류가 발생했습니다: ' + err.message);
        }
    };

    // --- Flow Option Save ---
    const handleSaveFlowOption = async (option) => {
        try {
            if (!option) {
                showAlert?.('유량 매핑 옵션을 선택한 후 저장해주세요.');
                return;
            }
            setFlowOption(option);
            await SettingsModel.saveFlowOption(option);
            showAlert?.('유량 매핑 옵션이 저장되었습니다.');
        } catch (err) {
            console.error('Flow option save error:', err);
            showAlert?.('유량 매핑 옵션 저장 중 오류: ' + err.message);
        }
    };

    const handleSaveSludgeExportSettings = async () => {
        setIsSavingSludgeExportSettings(true);
        try {
            const response = await SettingsModel.saveSludgeExportSettings({
                companyName: sludgeExportSettings.companyName,
                defaultAmount: sludgeExportSettings.defaultAmount
            });
            if (!response?.success) {
                throw new Error(response?.message || '저장 실패');
            }
            showAlert?.('슬러지반출관리대장 기본 설정이 저장되었습니다.');
            await loadSettings();
        } catch (err) {
            showAlert?.('슬러지반출관리대장 기본 설정 저장 중 오류: ' + err.message);
        } finally {
            setIsSavingSludgeExportSettings(false);
        }
    };

    const shellState = {
        activeTab,
        setActiveTab,
        isLoading,
        hasLoadedSettings,
        isAppSiteConfigured,
        importProgress,
        setImportProgress,
        importedData,
        showDataModal,
        setShowDataModal,
    };

    const basicSiteState = {
        siteInfo,
        setSiteInfo,
        availableSites,
        selectedSiteId,
        isSiteListLoading,
        handleSiteSelection,
        handleApply,
    };

    const itemState = {
        flowItems,
        medicineItems,
        waterItems,
        kitItems,
        locationItems,
        newFlowItem,
        setNewFlowItem,
        newMedicineItem,
        setNewMedicineItem,
        newLocationItem,
        setNewLocationItem,
        handleSeriesChange,
        addItem,
        toggleItem,
        moveLocationItem,
        getFlowRowsForExcelMapping,
    };

    const templateState = {
        excelFileName,
        templateFileNames,
        templateFiles,
        handleExcelFileUpload,
        handleTemplateFileChange,
        handleOpenLocalFolder,
        excelSheets,
        sampleRowData,
        excelStatus,
        isMetadataLoading,
        isPreviewLoading,
        isUploading,
    };

    const mappingState = {
        flow: { config: flowConfig, setConfig: setFlowConfig, mapping: flowMapping, setMapping: setFlowMapping, onSave: handleSaveFlowMapping },
        medicine: { config: medicineConfig, setConfig: setMedicineConfig, mapping: medicineMapping, setMapping: setMedicineMapping, onSave: handleSaveMedicineMapping },
        kit: { config: kitConfig, setConfig: setKitConfig, mapping: kitMapping, setMapping: setKitMapping, onSave: handleSaveKitMapping },
        water: { config: waterConfig, setConfig: setWaterConfig, mapping: waterMapping, setMapping: setWaterMapping, onSave: handleSaveWaterMapping },
    };

    const webAppState = {
        webAppCredentials,
        setWebAppCredentials,
        qntechImportSettings,
        setQntechImportSettings,
        passwordVisibility,
        urlEditability,
        geminiApiKey,
        setGeminiApiKey,
        geminiKeyVisible,
        setGeminiKeyVisible,
        updateWebAppCredentialField,
        togglePasswordVisibility,
        toggleUrlEditability,
        handleSaveWebAppCredentials,
        updateQntechImportSettingField,
        updateQntechSampleMapping,
        addQntechSampleMapping,
        removeQntechSampleMapping,
        handleSaveQntechImportSettings,
        handleSaveGeminiApiKey,
    };

    const logMappingState = {
        LOG_TYPES,
        selectedLogType,
        setSelectedLogType,
        flowOption,
        setFlowOption,
        handleSaveFlowOption,
        sludgeExportSettings,
        setSludgeExportSettings,
        isSavingSludgeExportSettings,
        handleSaveSludgeExportSettings,
    };

    const defaultAmountState = {
        showDefaultAmountModal,
        setShowDefaultAmountModal,
        defaultAmountItems,
        setDefaultAmountItems,
        isSavingDefaultAmounts,
        handleOpenDefaultAmountModal,
        handleSaveDefaultAmounts,
        showKitDefaultModal,
        setShowKitDefaultModal,
        kitDefaultItems,
        setKitDefaultItems,
        isSavingKitDefaults,
        handleOpenKitDefaultModal,
        handleSaveKitDefaults,
    };

    return {
        shellState,
        basicSiteState,
        itemState,
        templateState,
        mappingState,
        webAppState,
        logMappingState,
        defaultAmountState,
        alphabet: ALPHABET,
    };
};
