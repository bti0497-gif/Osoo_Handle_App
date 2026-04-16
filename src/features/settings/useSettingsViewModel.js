import { useState, useEffect, useCallback } from 'react';
import { SettingsModel } from './SettingsModel';

const DEFAULT_ROAD_WEB_URL = 'https://nwpo.ex.co.kr:5002//security/login.do';
const DEFAULT_WATER_ANALYSIS_URL = 'https://eco.qntech.co.kr';

const ALPHABET = (() => {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const res = [...letters];
    letters.forEach(l => res.push('A' + l));
    return res;
})();

const EMPTY_SITE_INFO = {
    siteName: '',
    managerName: '',
    method: '',
    series: '',
    targetLat: null,
    targetLng: null
};

/** 2계열: 일지 반송 유량은 미설정 시 1+2 합산(combined)을 기본으로 둔다(빈 flow_option 오류 방지) */
const getDefaultFlowOptionBySeries = (series) => (series === '2계열' ? 'combined' : 'single1');

const createDefaultFlowItems = (series = '1계열', method = 'A2O') => {
    const isMbr = String(method || '').toUpperCase() === 'MBR';
    const items = [
        { name: '유입유량계', checked: true },
        { name: '방류유량계', checked: true }
    ];

    if (series === '2계열') {
        items.push(
            { name: '내부반송유량계1', checked: true },
            { name: '내부반송유량계2', checked: true },
            { name: '외부반송유량계1', checked: !isMbr },
            { name: '외부반송유량계2', checked: !isMbr }
        );
    } else {
        items.push(
            { name: '내부반송유량계', checked: true },
            { name: '외부반송유량계', checked: !isMbr }
        );
    }

    items.push(
        { name: '전력량계', checked: true },
        { name: '슬러지', checked: true }
    );

    return items;
};

/** 2계열에서 계열별 엑셀 적산·누계를 따로 매핑하는 반송 유량계 (일지 flowOption과 짝을 이룸) */
const TWO_SERIES_RECIRC_NAMES = ['내부반송유량계1', '내부반송유량계2', '외부반송유량계1', '외부반송유량계2'];

/** 저장된 flow 항목 이름 집합이 현장 계열·공법 기본 스키마와 다르면 true (1계열↔2계열 전환 등) */
const needsResyncFlowItemsForSite = (items, series, method) => {
    if (!Array.isArray(items) || items.length === 0) return true;
    const expected = createDefaultFlowItems(series, method);
    const a = expected.map((i) => i.name).slice().sort().join('\t');
    const b = items.map((i) => i.name).slice().sort().join('\t');
    return a !== b;
};

const DEFAULT_MEDICINE_ITEMS = [
    { name: '중탄산나트륨', checked: true },
    { name: '포도당', checked: true },
    { name: '팩(PAC)', checked: true }
];

const DEFAULT_WATER_ITEMS = [
    { name: '암모니아성질소', checked: true },
    { name: '질산성질소', checked: true },
    { name: '인산염인', checked: true },
    { name: '알칼리도', checked: true }
];

const DEFAULT_KIT_ITEMS = [
    { name: '암모니아성질소(NH3-N)', checked: true },
    { name: '질산성질소(NO3-N)', checked: true },
    { name: '인산염인(PO4-P)', checked: true },
    { name: '알칼리도(ALK)', checked: true }
];

const DEFAULT_LOCATION_ITEMS = [
    { name: '유량조정조', checked: true },
    { name: '무산소조', checked: true },
    { name: '포기조', checked: true },
    { name: '침전조', checked: true },
    { name: '방류조', checked: true }
];

const cloneItems = (items) => items.map((item) => ({ ...item }));

const createDefaultLocationItems = (method = 'A2O') => {
    const isMbr = String(method || '').toUpperCase() === 'MBR';
    return DEFAULT_LOCATION_ITEMS.map((item) => ({
        ...item,
        checked: item.name === '침전조' ? !isMbr : true
    }));
};

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

    const [flowItems, setFlowItems] = useState(createDefaultFlowItems('1계열', 'A2O'));
    const [medicineItems, setMedicineItems] = useState(cloneItems(DEFAULT_MEDICINE_ITEMS));
    const [waterItems, setWaterItems] = useState(cloneItems(DEFAULT_WATER_ITEMS));
    const [kitItems, setKitItems] = useState(cloneItems(DEFAULT_KIT_ITEMS));
    const [locationItems, setLocationItems] = useState(createDefaultLocationItems('A2O'));

    const [newFlowItem, setNewFlowItem] = useState('');
    const [newMedicineItem, setNewMedicineItem] = useState('');
    const [newLocationItem, setNewLocationItem] = useState('');
    const [excelFileName, setExcelFileName] = useState('');
    const [templateFileNames, setTemplateFileNames] = useState('');
    const [templateFiles, setTemplateFiles] = useState([]);

    const [flowConfig, setFlowConfig] = useState({ sheet: '', startRow: 1, endRow: 31, dateCol: 'A' });
    const [flowMapping, setFlowMapping] = useState({});
    const [excelSheets, setExcelSheets] = useState([]);
    const [sampleRowData, setSampleRowData] = useState({});

    const [medicineConfig, setMedicineConfig] = useState({ sheet: '', startRow: 1, endRow: 31, dateCol: 'A' });
    const [medicineMapping, setMedicineMapping] = useState({});

    const [kitConfig, setKitConfig] = useState({ sheet: '', startRow: 1, endRow: 31, dateCol: 'A' });
    const [kitMapping, setKitMapping] = useState({});

    const [waterConfig, setWaterConfig] = useState({ sheet: '', startRow: 1, endRow: 31, dateCol: 'A' });
    const [waterMapping, setWaterMapping] = useState({});

    const [webAppCredentials, setWebAppCredentials] = useState({
        roadWeb: { serviceUrl: DEFAULT_ROAD_WEB_URL, userId: '', password: '' },
        waterAnalysisApp: { serviceUrl: DEFAULT_WATER_ANALYSIS_URL, userId: '', password: '' }
    });

    const [qntechImportSettings, setQntechImportSettings] = useState({
        photoRoot: '사진관리/수질분석',
        sampleMappings: []
    });

    const [passwordVisibility, setPasswordVisibility] = useState({
        roadWeb: false,
        waterAnalysisApp: false
    });

    const [urlEditability, setUrlEditability] = useState({
        roadWeb: false,
        waterAnalysisApp: false
    });

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
    const [logMappings, setLogMappings] = useState([]);
    const [dbColumns, setDbColumns] = useState({});
    const [isLogMappingLoading, setIsLogMappingLoading] = useState(false);

    // --- Gemini API Key State ---
    const [geminiApiKey, setGeminiApiKey] = useState('');
    const [geminiKeyVisible, setGeminiKeyVisible] = useState(false);

    const [importProgress, setImportProgress] = useState({ current: 0, total: 0, status: 'idle', isVisible: false });
    const [importedData, setImportedData] = useState(null);
    const [showDataModal, setShowDataModal] = useState(false);
    const [excelStatus, setExcelStatus] = useState({ status: 'idle', fileName: null, sheets: [] });
    const [isMetadataLoading, setIsMetadataLoading] = useState(false);
    const [isPreviewLoading, setIsPreviewLoading] = useState(false);
    const [isUploading, setIsUploading] = useState(false);

    // 초기 설정 로드는 마운트 시 1회만 수행한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { loadSettings(); }, []);

    useEffect(() => {
        if (activeTab === 'flow' || activeTab === 'medicine' || activeTab === 'kit' || activeTab === 'water') {
            if (excelStatus.status === 'ready') {
                setExcelSheets(excelStatus.sheets);
            } else if (excelStatus.status !== 'loading') {
                checkExcelStatus();
            }
        }
        if (activeTab === 'logMapping') {
            loadLogMappings(selectedLogType);
            loadDbColumns();
        }
    }, [activeTab, excelStatus.sheets, excelStatus.status, selectedLogType]);

    useEffect(() => {
        if (activeTab === 'logMapping') {
            loadLogMappings(selectedLogType);
        }
    }, [selectedLogType, activeTab]);

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

    useEffect(() => {
        if (String(siteInfo.series || '').trim() !== '2계열') return;
        const method = siteInfo.method || 'A2O';
        const desired = createDefaultFlowItems('2계열', method);
        setFlowItems((prev) => {
            const names = new Set(prev.map((i) => i.name));
            const additions = [];
            for (const name of TWO_SERIES_RECIRC_NAMES) {
                const d = desired.find((x) => x.name === name);
                if (!d || names.has(name)) continue;
                additions.push({ name: d.name, checked: d.checked });
                names.add(name);
            }
            if (additions.length === 0) return prev;
            return [...prev, ...additions];
        });
    }, [siteInfo.series, siteInfo.method]);

    const applySiteSelection = (site, { resetDefaults = false, preserveLocation = false } = {}) => {
        if (!site) {
            setSelectedSiteId('');
            setSiteInfo(EMPTY_SITE_INFO);
            setFlowOption('single1');
            if (resetDefaults) {
                setFlowItems(createDefaultFlowItems('1계열', 'A2O'));
                setMedicineItems(cloneItems(DEFAULT_MEDICINE_ITEMS));
                setWaterItems(cloneItems(DEFAULT_WATER_ITEMS));
                setKitItems(cloneItems(DEFAULT_KIT_ITEMS));
                setLocationItems(createDefaultLocationItems('A2O'));
            }
            return;
        }

        setSelectedSiteId(String(site.id || ''));
        setSiteInfo((prev) => ({
            siteName: site.site_name || '',
            managerName: site.manager_name || '',
            method: site.method || '',
            series: site.series || '',
            targetLat: preserveLocation ? prev.targetLat : (site.target_lat ?? null),
            targetLng: preserveLocation ? prev.targetLng : (site.target_lng ?? null)
        }));
        setFlowOption(getDefaultFlowOptionBySeries(site.series || '1계열'));

        if (resetDefaults) {
            setFlowItems(createDefaultFlowItems(site.series || '1계열', site.method || 'A2O'));
            setMedicineItems(cloneItems(DEFAULT_MEDICINE_ITEMS));
            setWaterItems(cloneItems(DEFAULT_WATER_ITEMS));
            setKitItems(cloneItems(DEFAULT_KIT_ITEMS));
            setLocationItems(createDefaultLocationItems(site.method || 'A2O'));
        }
    };

    const resetBasicItemsToDefaults = (series = '1계열', method = 'A2O') => {
        setFlowItems(createDefaultFlowItems(series, method));
        setMedicineItems(cloneItems(DEFAULT_MEDICINE_ITEMS));
        setWaterItems(cloneItems(DEFAULT_WATER_ITEMS));
        setKitItems(cloneItems(DEFAULT_KIT_ITEMS));
        setLocationItems(createDefaultLocationItems(method));
        setFlowMapping({});
        setMedicineMapping({});
        setWaterMapping({});
        setKitMapping({});
    };

    const loadSettings = async () => {
        try {
            setIsSiteListLoading(true);
            const [data, sitesData] = await Promise.all([
                SettingsModel.getSettings(),
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
                        target_lat: data.settings.target_lat,
                        target_lng: data.settings.target_lng
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
                        target_lng: data.settings.target_lng
                    });
                } else {
                    applySiteSelection(null);
                }

                if (data.settings.excel_template_path) {
                    setExcelFileName(data.settings.excel_template_path.split(/[/\\]/).pop());
                }
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
                setTemplateFileNames('');
                if (data.settings.flow_sheet) setFlowConfig({ sheet: data.settings.flow_sheet, startRow: data.settings.flow_start_row || 1, endRow: data.settings.flow_end_row || 31, dateCol: data.settings.flow_date_col || 'A' });
                setFlowOption(getDefaultFlowOptionBySeries(resolvedSeries));
                if (data.settings.med_sheet) setMedicineConfig({ sheet: data.settings.med_sheet, startRow: data.settings.med_start_row || 1, endRow: data.settings.med_end_row || 31, dateCol: data.settings.med_date_col || 'A' });
                if (data.settings.kit_sheet) setKitConfig({ sheet: data.settings.kit_sheet, startRow: data.settings.kit_start_row || 1, endRow: data.settings.kit_end_row || 31, dateCol: data.settings.kit_date_col || 'A' });
                if (data.settings.water_sheet) setWaterConfig({ sheet: data.settings.water_sheet, startRow: data.settings.water_start_row || 1, endRow: data.settings.water_end_row || 31, dateCol: data.settings.water_date_col || 'A' });

                if (Array.isArray(data.credentials) && data.credentials.length > 0) {
                    const credentialMap = data.credentials.reduce((acc, item) => {
                        acc[item.service_key] = item;
                        return acc;
                    }, {});

                    setWebAppCredentials({
                        roadWeb: {
                            serviceUrl: credentialMap.road_web?.service_url || DEFAULT_ROAD_WEB_URL,
                            userId: credentialMap.road_web?.user_id || '',
                            password: credentialMap.road_web?.password || ''
                        },
                        waterAnalysisApp: {
                            serviceUrl: credentialMap.water_analysis_app?.service_url || DEFAULT_WATER_ANALYSIS_URL,
                            userId: credentialMap.water_analysis_app?.user_id || '',
                            password: credentialMap.water_analysis_app?.password || ''
                        }
                    });

                    // Gemini API Key 복원
                    if (credentialMap.gemini_api) {
                        setGeminiApiKey(credentialMap.gemini_api.password || '');
                    }
                }

                let restoredQntechMappings = [];
                if (data.settings.qntech_sample_mappings) {
                    try {
                        const parsed = JSON.parse(data.settings.qntech_sample_mappings);
                        restoredQntechMappings = Array.isArray(parsed) ? parsed : [];
                    } catch {
                        restoredQntechMappings = [];
                    }
                }

                setQntechImportSettings({
                    photoRoot: data.settings.qntech_photo_root || '사진관리/수질분석',
                    sampleMappings: restoredQntechMappings
                });

                if (!hasSavedSiteIdentity) {
                    resetBasicItemsToDefaults();
                } else if (data.configItems?.length > 0) {
                    const flows = data.configItems.filter(i => i.category === 'flow');
                    if (flows.length > 0) {
                        const baseFlows = flows.filter(i => !i.item_name.includes('_raw') && !i.item_name.includes('_flow'));
                        const restoredList = baseFlows.map(i => ({ name: i.item_name, checked: !!i.is_active }));
                        if (needsResyncFlowItemsForSite(restoredList, resolvedSeries, resolvedMethod)) {
                            const fresh = createDefaultFlowItems(resolvedSeries, resolvedMethod);
                            const checkedByName = Object.fromEntries(restoredList.map((i) => [i.name, i.checked]));
                            setFlowItems(fresh.map((i) => ({
                                ...i,
                                checked: Object.prototype.hasOwnProperty.call(checkedByName, i.name)
                                    ? checkedByName[i.name]
                                    : i.checked
                            })));
                            setFlowMapping({});
                        } else {
                            setFlowItems(restoredList);
                            const restored = {};
                            flows.forEach(i => {
                                if (i.excel_cell && (i.item_name.endsWith('_raw') || i.item_name.endsWith('_flow'))) {
                                    restored[i.item_name] = i.excel_cell;
                                }
                            });
                            if (Object.keys(restored).length > 0) setFlowMapping(restored);
                        }
                    } else {
                        setFlowItems(createDefaultFlowItems(resolvedSeries, resolvedMethod));
                        setFlowMapping({});
                    }
                    const meds = data.configItems.filter(i => i.category === 'medicine');
                    if (meds.length > 0) {
                        const baseMeds = meds.filter(i => !i.item_name.endsWith('_purchase') && !i.item_name.endsWith('_usage') && !i.item_name.endsWith('_inventory'));
                        if (baseMeds.length > 0) {
                            setMedicineItems(baseMeds.map(i => ({ name: i.item_name, checked: !!i.is_active })));
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

                    // 매핑 정보 복원: 'water_mapping' 카테고리와 'water' 카테고리의 레거시 매핑 데이터 병합
                    const waterMappings = data.configItems.filter(i => i.category === 'water_mapping');
                    const legacyWaterMappings = data.configItems.filter(i => i.category === 'water' && i.item_name.includes('_'));

                    const restoredWaterMapping = {};
                    legacyWaterMappings.forEach(i => { if (i.excel_cell) restoredWaterMapping[i.item_name] = i.excel_cell; });
                    waterMappings.forEach(i => { if (i.excel_cell) restoredWaterMapping[i.item_name] = i.excel_cell; });

                    if (Object.keys(restoredWaterMapping).length > 0) {
                        setWaterMapping(restoredWaterMapping);
                    }
                    const kits = data.configItems.filter(i => i.category === 'kit');
                    if (kits.length > 0) {
                        const baseKits = kits.filter(i => !i.item_name.endsWith('_purchase') && !i.item_name.endsWith('_usage') && !i.item_name.endsWith('_inventory'));
                        setKitItems(baseKits.map(i => ({ name: i.item_name, checked: !!i.is_active })));

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
                        setLocationItems(locations.map(i => ({ name: i.item_name, checked: !!i.is_active })));
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

    const checkExcelStatus = async () => {
        setIsMetadataLoading(true);
        try {
            const result = await SettingsModel.getExcelStatus();
            setExcelStatus({ status: result.status, fileName: result.fileName || null, sheets: result.sheets || [] });
            if (result.sheets) setExcelSheets(result.sheets);
        } catch {
            setExcelStatus({ status: 'error', fileName: null, sheets: [] });
        } finally {
            setIsMetadataLoading(false);
        }
    };

    const loadExcelPreview = async (sheet, row) => {
        setIsPreviewLoading(true);
        try {
            const res = await SettingsModel.getExcelPreview(sheet, row);
            setSampleRowData(res.success ? res.data : {});
        } catch { setSampleRowData({}); }
        finally { setIsPreviewLoading(false); }
    };

    const handleSeriesChange = (newSeries) => {
        setSiteInfo({ ...siteInfo, series: newSeries });
        setFlowItems(createDefaultFlowItems(newSeries, siteInfo.method || 'A2O'));
        setFlowOption(getDefaultFlowOptionBySeries(newSeries));
    };

    const handleCaptureSiteLocation = async () => {
        if (!selectedSiteId || !siteInfo.siteName) {
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
            setSiteInfo(prev => ({
                ...prev,
                targetLat: response.targetLat,
                targetLng: response.targetLng
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

        const selectedSite = availableSites.find((site) => String(site.id) === nextSiteId);
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
                    series: response.site.series
                }
                : selectedSite;

            applySiteSelection(boundSite, { resetDefaults: true });
        } catch (err) {
            console.error('Site selection error:', err);
            showAlert?.('현장 선택 중 오류가 발생했습니다: ' + err.message);
            await loadSettings();
        }
    };

    const addItem = async (type) => {
        try {
            if (type === 'flow' && newFlowItem.trim()) {
                const name = newFlowItem.trim();
                await SettingsModel.addConfigItem('flow', name);
                setFlowItems([...flowItems, { name, checked: true }]);
                setNewFlowItem('');
            } else if (type === 'medicine' && newMedicineItem.trim()) {
                const name = newMedicineItem.trim();
                await SettingsModel.addConfigItem('medicine', name);
                setMedicineItems([...medicineItems, { name, checked: true }]);
                setNewMedicineItem('');
            } else if (type === 'location' && newLocationItem.trim()) {
                const name = newLocationItem.trim();
                await SettingsModel.addConfigItem('location', name);
                setLocationItems([...locationItems, { name, checked: true }]);
                setNewLocationItem('');
            }
        } catch (err) {
            console.error('항목 추가 실패:', err);
            showAlert?.('항목 추가에 실패했습니다: ' + err.message);
        }
    };

    const toggleItem = async (type, index) => {
        try {
            if (type === 'flow') {
                const n = [...flowItems]; n[index].checked = !n[index].checked; setFlowItems(n);
                await SettingsModel.toggleConfigItem('flow', n[index].name, n[index].checked);
            } else if (type === 'medicine') {
                const n = [...medicineItems]; n[index].checked = !n[index].checked; setMedicineItems(n);
                await SettingsModel.toggleConfigItem('medicine', n[index].name, n[index].checked);
            } else if (type === 'kit') {
                const n = [...kitItems]; n[index].checked = !n[index].checked; setKitItems(n);
                await SettingsModel.toggleConfigItem('kit', n[index].name, n[index].checked);
            } else if (type === 'location') {
                const n = [...locationItems]; n[index].checked = !n[index].checked; setLocationItems(n);
                await SettingsModel.toggleConfigItem('location', n[index].name, n[index].checked);
            }
        } catch (err) {
            console.error('항목 토글 실패:', err);
        }
    };

    const handleSaveFlowMapping = async () => {
        try {
            setImportProgress({ current: 0, total: flowConfig.endRow - flowConfig.startRow + 1, status: 'processing', isVisible: true });
            const res = await SettingsModel.saveFlowMapping({ config: flowConfig, mapping: flowMapping });
            if (res.success) {
                const prog = await SettingsModel.getImportProgress();
                setImportedData(prog.result);
                setImportProgress({ current: prog.total, total: prog.total, status: 'completed', isVisible: true });
                loadSettings();
            } else {
                throw new Error(res.message);
            }
        } catch (err) {
            setImportProgress({ current: 0, total: 0, status: 'error', isVisible: true, result: err.message });
        }
    };

    const handleSaveMedicineMapping = async () => {
        try {
            setImportProgress({ current: 0, total: medicineConfig.endRow - medicineConfig.startRow + 1, status: 'processing', isVisible: true });
            const res = await SettingsModel.saveMedicineMapping({ config: medicineConfig, mapping: medicineMapping });
            if (res.success) {
                const prog = await SettingsModel.getImportProgress();
                setImportedData(prog.result);
                setImportProgress({ current: prog.total, total: prog.total, status: 'completed', isVisible: true });
                loadSettings();
            } else {
                throw new Error(res.message);
            }
        } catch (err) {
            setImportProgress({ current: 0, total: 0, status: 'error', isVisible: true, result: err.message });
        }
    };

    const handleSaveWaterMapping = async () => {
        try {
            setImportProgress({ current: 0, total: waterConfig.endRow - waterConfig.startRow + 1, status: 'processing', isVisible: true });
            const res = await SettingsModel.saveWaterMapping({ config: waterConfig, mapping: waterMapping });
            if (res.success) {
                const prog = await SettingsModel.getImportProgress();
                setImportedData(prog.result);
                setImportProgress({ current: prog.total, total: prog.total, status: 'completed', isVisible: true });
                loadSettings();
            } else {
                throw new Error(res.message);
            }
        } catch (err) {
            setImportProgress({ current: 0, total: 0, status: 'error', isVisible: true, result: err.message });
        }
    };

    const handleSaveKitMapping = async () => {
        try {
            setImportProgress({ current: 0, total: kitConfig.endRow - kitConfig.startRow + 1, status: 'processing', isVisible: true });
            const res = await SettingsModel.saveKitMapping({ config: kitConfig, mapping: kitMapping });
            if (res.success) {
                const prog = await SettingsModel.getImportProgress();
                setImportedData(prog.result);
                setImportProgress({ current: prog.total, total: prog.total, status: 'completed', isVisible: true });
                loadSettings();
            } else {
                throw new Error(res.message);
            }
        } catch (err) {
            setImportProgress({ current: 0, total: 0, status: 'error', isVisible: true, result: err.message });
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
                ...waterItems.map(i => ({ ...i, category: 'water' })),
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

    const updateWebAppCredentialField = (section, field, value) => {
        setWebAppCredentials(prev => ({
            ...prev,
            [section]: {
                ...prev[section],
                [field]: value
            }
        }));
    };

    const togglePasswordVisibility = (section) => {
        setPasswordVisibility(prev => ({
            ...prev,
            [section]: !prev[section]
        }));
    };

    const toggleUrlEditability = (section) => {
        setUrlEditability(prev => ({
            ...prev,
            [section]: !prev[section]
        }));
    };

    const handleSaveWebAppCredentials = async (section) => {
        const serviceKey = section === 'roadWeb' ? 'road_web' : 'water_analysis_app';
        const target = webAppCredentials[section];

        try {
            const response = await SettingsModel.saveWebAppCredentials({
                serviceKey,
                serviceUrl: target.serviceUrl || '',
                userId: target.userId,
                password: target.password
            });

            if (!response?.success) {
                throw new Error(response?.message || '저장에 실패했습니다.');
            }

            setUrlEditability(prev => ({
                ...prev,
                [section]: false
            }));
            showAlert?.('웹/앱 설정이 저장되었습니다.');
            loadSettings();
        } catch (err) {
            console.error('Web/App settings save error:', err);
            showAlert?.('웹/앱 설정 저장 중 오류가 발생했습니다: ' + err.message);
        }
    };

    const updateQntechImportSettingField = (field, value) => {
        setQntechImportSettings(prev => ({
            ...prev,
            [field]: value
        }));
    };

    const updateQntechSampleMapping = (index, field, value) => {
        setQntechImportSettings(prev => ({
            ...prev,
            sampleMappings: prev.sampleMappings.map((item, itemIndex) => (
                itemIndex === index ? { ...item, [field]: value } : item
            ))
        }));
    };

    const addQntechSampleMapping = () => {
        setQntechImportSettings(prev => ({
            ...prev,
            sampleMappings: [...prev.sampleMappings, { sourceName: '', targetLocation: '' }]
        }));
    };

    const removeQntechSampleMapping = (index) => {
        setQntechImportSettings(prev => ({
            ...prev,
            sampleMappings: prev.sampleMappings.filter((_, itemIndex) => itemIndex !== index)
        }));
    };

    const handleSaveQntechImportSettings = async () => {
        try {
            const cleanedMappings = qntechImportSettings.sampleMappings
                .map((item) => ({
                    sourceName: String(item?.sourceName || '').trim(),
                    targetLocation: String(item?.targetLocation || '').trim()
                }))
                .filter((item) => item.sourceName && item.targetLocation);

            const response = await SettingsModel.saveQntechImportSettings({
                photoRoot: qntechImportSettings.photoRoot || '사진관리/수질분석',
                sampleMappings: cleanedMappings
            });

            if (!response?.success) {
                throw new Error(response?.message || '저장에 실패했습니다.');
            }

            showAlert?.('QnTECH 불러오기 설정이 저장되었습니다.');
            loadSettings();
        } catch (err) {
            console.error('QnTECH import settings save error:', err);
            showAlert?.('QnTECH 불러오기 설정 저장 중 오류가 발생했습니다: ' + err.message);
        }
    };

    // --- Log Mapping Handlers ---
    const loadLogMappings = async (logType) => {
        setIsLogMappingLoading(true);
        try {
            const res = await SettingsModel.getLogMappings(logType);
            if (res.success) {
                setLogMappings(res.mappings.map(m => ({
                    fieldName: m.field_name,
                    mappingType: m.mapping_type || 'column',
                    mappingValue: m.mapping_value || ''
                })));
            }
        } catch (err) {
            console.error('Log mappings load failed:', err);
            setLogMappings([]);
        } finally {
            setIsLogMappingLoading(false);
        }
    };

    const loadDbColumns = async () => {
        try {
            const res = await SettingsModel.getDbColumns();
            if (res.success) setDbColumns(res.tables);
        } catch (err) {
            console.error('DB columns load failed:', err);
        }
    };

    const addLogMapping = () => {
        setLogMappings(prev => [...prev, { fieldName: '', mappingType: 'column', mappingValue: '' }]);
    };

    const removeLogMapping = (index) => {
        setLogMappings(prev => prev.filter((_, i) => i !== index));
    };

    const updateLogMapping = (index, field, value) => {
        setLogMappings(prev => prev.map((m, i) => i === index ? { ...m, [field]: value } : m));
    };

    const toggleMappingType = (index) => {
        setLogMappings(prev => prev.map((m, i) => {
            if (i !== index) return m;
            return { ...m, mappingType: m.mappingType === 'column' ? 'formula' : 'column', mappingValue: '' };
        }));
    };

    const handleSaveLogMappings = async () => {
        try {
            const cleaned = logMappings.filter(m => m.fieldName.trim());
            const res = await SettingsModel.saveLogMappings(selectedLogType, cleaned);
            if (res.success) {
                showAlert?.('일지 매핑이 저장되었습니다.');
            } else {
                throw new Error(res.message);
            }
        } catch (err) {
            showAlert?.('일지 매핑 저장 실패: ' + err.message);
        }
    };

    // --- Gemini API Key Handler ---
    const handleSaveGeminiApiKey = async () => {
        try {
            const response = await SettingsModel.saveWebAppCredentials({
                serviceKey: 'gemini_api',
                serviceUrl: '',
                userId: '',
                password: geminiApiKey
            });
            if (!response?.success) throw new Error(response?.message || '저장에 실패했습니다.');
            showAlert?.('Gemini API 키가 저장되었습니다.');
        } catch (err) {
            console.error('Gemini API key save error:', err);
            showAlert?.('Gemini API 키 저장 실패: ' + err.message);
        }
    };

    const handleExcelFileUpload = async (file) => {
        if (!file) return;
        setIsUploading(true);
        setExcelFileName(file.name);
        setExcelStatus({ status: 'uploading', fileName: file.name, sheets: [] });
        try {
            const formData = new FormData();
            formData.append('excel_original', file);
            const result = await SettingsModel.uploadFiles(formData);
            if (result.success && result.sheets) {
                setExcelStatus({ status: 'ready', fileName: file.name, sheets: result.sheets });
                setExcelSheets(result.sheets);
            } else {
                throw new Error(result.message || '업로드 실패');
            }
        } catch (err) {
            setExcelStatus({ status: 'error', fileName: file.name, sheets: [] });
            showAlert?.('엑셀 파일 처리 실패: ' + err.message);
        } finally {
            setIsUploading(false);
        }
    };

    const handleTemplateFileChange = async (files) => {
        setTemplateFiles(files);
        setTemplateFileNames(files.map((file) => file.name).join(', '));

        if (files.length === 0) {
            return;
        }

        setIsUploading(true);
        try {
            const formData = new FormData();
            files.forEach((file) => formData.append('report_templates', file));
            await SettingsModel.uploadFiles(formData);
            setTemplateFiles([]);
            setTemplateFileNames(files.map((file) => file.name).join(', '));
            showAlert?.('선택한 양식 파일을 앱 로컬 폴더에 복사했습니다.');
        } catch (err) {
            console.error('Template upload error:', err);
            showAlert?.('양식 파일 복사 중 오류가 발생했습니다: ' + err.message);
            loadSettings();
        } finally {
            setIsUploading(false);
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

    /** 유량설정 탭 엑셀 매핑: 2계열이면 내부/외부 반송 1·2는 위젯에서 체크 해제돼 있어도 적산·누계 행을 항상 노출 */
    const getFlowRowsForExcelMapping = useCallback(() => {
        const active = flowItems.filter((i) => i.checked);
        if (String(siteInfo.series || '').trim() !== '2계열') {
            return active;
        }
        const method = siteInfo.method || 'A2O';
        const defaults = createDefaultFlowItems('2계열', method);
        const byName = new Map(flowItems.map((i) => [i.name, i]));
        const out = [];
        const seen = new Set();

        for (const d of defaults) {
            if (TWO_SERIES_RECIRC_NAMES.includes(d.name)) {
                const ex = byName.get(d.name);
                out.push(ex ? { ...ex, checked: true } : { name: d.name, checked: true });
                seen.add(d.name);
                continue;
            }
            const ex = byName.get(d.name);
            if (ex?.checked) {
                out.push(ex);
                seen.add(d.name);
            }
        }
        for (const f of active) {
            if (!seen.has(f.name)) {
                out.push(f);
                seen.add(f.name);
            }
        }
        return out;
    }, [flowItems, siteInfo.series, siteInfo.method]);

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

    // ── 약품 기본 입고량 모달 ──
    const [showDefaultAmountModal, setShowDefaultAmountModal] = useState(false);
    const [defaultAmountItems, setDefaultAmountItems] = useState([]);
    const [isSavingDefaultAmounts, setIsSavingDefaultAmounts] = useState(false);

    const handleOpenDefaultAmountModal = async () => {
        const checkedList = medicineItems.filter((i) => i.checked);
        const byAmount = new Map();
        try {
            const res = await SettingsModel.getMedicineDefaults();
            if (res.success && Array.isArray(res.items)) {
                for (const row of res.items) {
                    const key = String(row.item_name ?? row.itemName ?? '').trim();
                    if (!key) continue;
                    const raw = row.default_amount ?? row.defaultAmount ?? 0;
                    const amt = Number(raw);
                    byAmount.set(key, Number.isFinite(amt) ? amt : 0);
                }
            }
        } catch {
            /* API 실패 시 금액 맵 없이 체크 항목만 표시 */
        }
        setDefaultAmountItems(
            checkedList.map((i) => {
                const key = String(i.name ?? '').trim();
                return {
                    name: i.name,
                    defaultAmount: byAmount.get(key) ?? 0,
                };
            })
        );
        setShowDefaultAmountModal(true);
    };

    const handleSaveDefaultAmounts = async () => {
        setIsSavingDefaultAmounts(true);
        try {
            const res = await SettingsModel.saveMedicineDefaults(defaultAmountItems);
            if (!res?.success) {
                throw new Error(res?.message || '저장 실패');
            }
            const msg = res.warning
                ? `기본 입고량이 저장되었습니다.\n\n${res.warning}`
                : '기본 입고량이 저장되었습니다.';
            showAlert?.(msg);
            setShowDefaultAmountModal(false);
        } catch (err) {
            showAlert?.('기본 입고량 저장 중 오류: ' + err.message);
        } finally {
            setIsSavingDefaultAmounts(false);
        }
    };

    // ── 키트 기본 입고량 모달 ──
    const BASE_KIT_NAMES = ['암모니아성질소(NH3-N)', '질산성질소(NO3-N)', '인산염인(PO4-P)', '알칼리도(ALK)'];
    const [showKitDefaultModal, setShowKitDefaultModal] = useState(false);
    const [kitDefaultItems, setKitDefaultItems] = useState([]);
    const [isSavingKitDefaults, setIsSavingKitDefaults] = useState(false);

    const handleOpenKitDefaultModal = async () => {
        const byAmount = new Map();
        try {
            const res = await SettingsModel.getKitDefaults();
            if (res.success && Array.isArray(res.items)) {
                for (const row of res.items) {
                    const key = String(row.item_name ?? row.itemName ?? '').trim();
                    if (!key) continue;
                    const raw = row.default_amount ?? row.defaultAmount ?? 0;
                    const amt = Number(raw);
                    byAmount.set(key, Number.isFinite(amt) ? amt : 0);
                }
            }
        } catch {
            /* 금액 맵 없이 고정 4종만 표시 */
        }
        setKitDefaultItems(
            BASE_KIT_NAMES.map((name) => ({
                name,
                defaultAmount: byAmount.get(name) ?? 0,
            }))
        );
        setShowKitDefaultModal(true);
    };

    const handleSaveKitDefaults = async () => {
        setIsSavingKitDefaults(true);
        try {
            const res = await SettingsModel.saveKitDefaults(kitDefaultItems);
            if (!res?.success) {
                throw new Error(res?.message || '저장 실패');
            }
            const msg = res.warning
                ? `키트 기본 입고량이 저장되었습니다.\n\n${res.warning}`
                : '키트 기본 입고량이 저장되었습니다.';
            showAlert?.(msg);
            setShowKitDefaultModal(false);
        } catch (err) {
            showAlert?.('키트 기본 입고량 저장 중 오류: ' + err.message);
        } finally {
            setIsSavingKitDefaults(false);
        }
    };

    return {
        activeTab, setActiveTab, isLoading, hasLoadedSettings, isAppSiteConfigured,
        siteInfo, setSiteInfo, handleSeriesChange,
        handleCaptureSiteLocation,
        availableSites, selectedSiteId, isSiteListLoading, handleSiteSelection,
        flowItems, medicineItems, waterItems, kitItems, locationItems,
        newFlowItem, setNewFlowItem, newMedicineItem, setNewMedicineItem, newLocationItem, setNewLocationItem,
        addItem, toggleItem,
        excelFileName, templateFileNames,
        templateFiles,
        handleExcelFileUpload, handleTemplateFileChange,
        flowConfig, setFlowConfig, flowMapping, setFlowMapping,
        medicineConfig, setMedicineConfig, medicineMapping, setMedicineMapping,
        kitConfig, setKitConfig, kitMapping, setKitMapping,
        waterConfig, setWaterConfig, waterMapping, setWaterMapping,
        webAppCredentials, setWebAppCredentials,
        qntechImportSettings, setQntechImportSettings,
        passwordVisibility,
        urlEditability,
        excelSheets, sampleRowData,
        excelStatus, isMetadataLoading, isPreviewLoading, isUploading,
        importProgress, setImportProgress, importedData, showDataModal, setShowDataModal,
        handleSaveFlowMapping, handleSaveMedicineMapping, handleSaveKitMapping, handleSaveWaterMapping,
        updateWebAppCredentialField, togglePasswordVisibility, toggleUrlEditability, handleSaveWebAppCredentials,
        updateQntechImportSettingField, updateQntechSampleMapping, addQntechSampleMapping, removeQntechSampleMapping, handleSaveQntechImportSettings,
        handleApply,
        alphabet: ALPHABET,
        // Log Mapping
        LOG_TYPES, selectedLogType, setSelectedLogType,
        logMappings, dbColumns, isLogMappingLoading,
        addLogMapping, removeLogMapping, updateLogMapping, toggleMappingType, handleSaveLogMappings,
        // Gemini API
        geminiApiKey, setGeminiApiKey, geminiKeyVisible, setGeminiKeyVisible, handleSaveGeminiApiKey,
        // Flow Option
        flowOption, setFlowOption, handleSaveFlowOption, getFlowRowsForExcelMapping,
        // Sludge Export Ledger Settings
        sludgeExportSettings, setSludgeExportSettings,
        isSavingSludgeExportSettings, handleSaveSludgeExportSettings,
        // 약품 기본 입고량 모달
        showDefaultAmountModal, setShowDefaultAmountModal,
        defaultAmountItems, setDefaultAmountItems,
        isSavingDefaultAmounts,
        handleOpenDefaultAmountModal, handleSaveDefaultAmounts,
        // 키트 기본 입고량 모달
        showKitDefaultModal, setShowKitDefaultModal,
        kitDefaultItems, setKitDefaultItems,
        isSavingKitDefaults,
        handleOpenKitDefaultModal, handleSaveKitDefaults,
    };
};
