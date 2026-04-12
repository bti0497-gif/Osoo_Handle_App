import { useState, useEffect } from 'react';
import { SettingsModel } from './SettingsModel';

const DEFAULT_ROAD_WEB_URL = 'https://nwpo.ex.co.kr:5002//security/login.do';
const DEFAULT_WATER_ANALYSIS_URL = 'https://eco.qntech.co.kr';

const ALPHABET = (() => {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const res = [...letters];
    letters.forEach(l => res.push('A' + l));
    return res;
})();

export const useSettingsViewModel = (currentUser, { showAlert, showConfirm } = {}) => {
    const [activeTab, setActiveTab] = useState('basic');
    const [isLoading, setIsLoading] = useState(true);
    const [hasLoadedSettings, setHasLoadedSettings] = useState(false);

    const [siteInfo, setSiteInfo] = useState({
        siteName: '오수처리장',
        managerName: currentUser?.name || '관리자',
        method: 'A2O',
        series: '1계열'
    });
    // flowOption state: 'single1' (default), 'single2', or 'combined'
    const [flowOption, setFlowOption] = useState('single1');
    const [sludgeExportSettings, setSludgeExportSettings] = useState({
        companyName: '',
        defaultAmount: 0
    });
    const [isSavingSludgeExportSettings, setIsSavingSludgeExportSettings] = useState(false);

    const [flowItems, setFlowItems] = useState([
        { name: '유입유량계', checked: true }, { name: '방류유량계', checked: true },
        { name: '내부반송유량계', checked: true }, { name: '외부반송유량계', checked: true },
        { name: '전력량계', checked: true }, { name: '슬러지', checked: true }
    ]);
    const [medicineItems, setMedicineItems] = useState([
        { name: '중탄산나트륨', checked: true }, { name: '포도당', checked: true },
        { name: '팩(PAC)', checked: true }
    ]);
    const [waterItems, setWaterItems] = useState([
        { name: '암모니아성질소', checked: true }, { name: '질산성질소', checked: true },
        { name: '인산염인', checked: true }, { name: '알칼리도', checked: true }
    ]);
    const [kitItems, setKitItems] = useState([
        { name: '암모니아성질소(NH3-N)', checked: true }, { name: '질산성질소(NO3-N)', checked: true },
        { name: '인산염인(PO4-P)', checked: true }, { name: '알칼리도(ALK)', checked: true }
    ]);
    const [locationItems, setLocationItems] = useState([
        { name: '유량조정조', checked: true }, { name: '무산소조', checked: true },
        { name: '포기조', checked: true }, { name: '침전조', checked: true },
        { name: '방류조', checked: true }
    ]);

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
    }, [activeTab]);

    useEffect(() => {
        if (activeTab === 'logMapping') {
            loadLogMappings(selectedLogType);
        }
    }, [selectedLogType]);

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

    const loadSettings = async () => {
        try {
            const data = await SettingsModel.getSettings();
            if (data?.success && data.settings) {
                if (data.settings.site_name || data.settings.excel_template_path) setHasLoadedSettings(true);
                setSiteInfo({
                    siteName: data.settings.site_name || '오수처리장',
                    managerName: data.settings.manager_name || (currentUser?.name || '관리자'),
                    method: data.settings.method || 'A2O',
                    series: data.settings.series || '1계열'
                });
                if (data.settings.excel_template_path) {
                    setExcelFileName(data.settings.excel_template_path.split(/[/\\]/).pop());
                }
                if (data.sludgeExportSettings) {
                    setSludgeExportSettings({
                        companyName: data.sludgeExportSettings.company_name || '',
                        defaultAmount: Number(data.sludgeExportSettings.default_amount) || 0
                    });
                }
                setTemplateFileNames('');
                if (data.settings.flow_sheet) setFlowConfig({ sheet: data.settings.flow_sheet, startRow: data.settings.flow_start_row || 1, endRow: data.settings.flow_end_row || 31, dateCol: data.settings.flow_date_col || 'A' });
          // Ensure flowOption is set even if not present in DB
          if (!data.settings.flow_option) {
            const defaultFlowOption = data.settings.series === '2계열' ? 'combined' : 'single1';
            setFlowOption(defaultFlowOption);
          }
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
                    } catch (error) {
                        restoredQntechMappings = [];
                    }
                }

                setQntechImportSettings({
                    photoRoot: data.settings.qntech_photo_root || '사진관리/수질분석',
                    sampleMappings: restoredQntechMappings
                });

                if (data.configItems?.length > 0) {
                    const flows = data.configItems.filter(i => i.category === 'flow');
                    if (flows.length > 0) {
                        const baseFlows = flows.filter(i => !i.item_name.includes('_raw') && !i.item_name.includes('_flow'));
                        setFlowItems(baseFlows.map(i => ({ name: i.item_name, checked: !!i.is_active })));
                        const restored = {};
                        flows.forEach(i => {
                            // _raw, _flow 접미사가 있는 매핑 항목만 flowMapping에 복원
                            if (i.excel_cell && (i.item_name.endsWith('_raw') || i.item_name.endsWith('_flow'))) {
                                restored[i.item_name] = i.excel_cell;
                            }
                        });
                        if (Object.keys(restored).length > 0) setFlowMapping(restored);
                    }
                    const meds = data.configItems.filter(i => i.category === 'medicine');
                    if (meds.length > 0) {
                        const baseMeds = meds.filter(i => !i.item_name.endsWith('_purchase') && !i.item_name.endsWith('_usage') && !i.item_name.endsWith('_inventory'));
                        setMedicineItems(baseMeds.map(i => ({ name: i.item_name, checked: !!i.is_active })));
                        const restored = {};
                        meds.forEach(i => {
                            if (i.excel_cell && (i.item_name.endsWith('_purchase') || i.item_name.endsWith('_usage') || i.item_name.endsWith('_inventory'))) {
                                restored[i.item_name] = i.excel_cell;
                            }
                        });
                        if (Object.keys(restored).length > 0) setMedicineMapping(restored);
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
                }
            }
        } catch (err) { console.warn('Settings load failed, using defaults:', err); }
        finally { setIsLoading(false); }
    };

    const checkExcelStatus = async () => {
        setIsMetadataLoading(true);
        try {
            const result = await SettingsModel.getExcelStatus();
            setExcelStatus({ status: result.status, fileName: result.fileName || null, sheets: result.sheets || [] });
            if (result.sheets) setExcelSheets(result.sheets);
        } catch (err) {
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
        } catch (err) { setSampleRowData({}); }
        finally { setIsPreviewLoading(false); }
    };

    const handleSeriesChange = (newSeries) => {
        setSiteInfo({ ...siteInfo, series: newSeries });
        let items = [{ name: '유입유량계', checked: true }, { name: '방류유량계', checked: true }];
        if (newSeries === '2계열') {
            items.push({ name: '내부반송유량계1', checked: true }, { name: '내부반송유량계2', checked: true }, { name: '외부반송유량계1', checked: true }, { name: '외부반송유량계2', checked: true });
        } else {
            items.push({ name: '내부반송유량계', checked: true }, { name: '외부반송유량계', checked: true });
        }
        items.push({ name: '전력량계', checked: true }, { name: '슬러지', checked: true });
        setFlowItems(items);
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
                await SettingsModel.syncSettingsToSupabase();
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
                await SettingsModel.syncSettingsToSupabase();
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
                await SettingsModel.syncSettingsToSupabase();
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
                await SettingsModel.syncSettingsToSupabase();
            } else {
                throw new Error(res.message);
            }
        } catch (err) {
            setImportProgress({ current: 0, total: 0, status: 'error', isVisible: true, result: err.message });
        }
    };

    const handleApply = async () => {
        try {
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
                showAlert?.('설정이 성공적으로 저장되었습니다. (서버 동기화 포함)');
                setTemplateFiles([]);
                loadSettings();
                await SettingsModel.syncSettingsToSupabase();
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
        setTemplateFileNames('');

        if (files.length === 0) {
            return;
        }

        setIsUploading(true);
        try {
            const formData = new FormData();
            files.forEach((file) => formData.append('report_templates', file));
            const result = await SettingsModel.uploadFiles(formData);
            setTemplateFiles([]);
            setTemplateFileNames('');
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

    // ── 약품 기본 입고량 모달 ──
    const [showDefaultAmountModal, setShowDefaultAmountModal] = useState(false);
    const [defaultAmountItems, setDefaultAmountItems] = useState([]);
    const [isSavingDefaultAmounts, setIsSavingDefaultAmounts] = useState(false);

    const handleOpenDefaultAmountModal = async () => {
        try {
            const res = await SettingsModel.getMedicineDefaults();
            if (res.success) {
                setDefaultAmountItems(res.items.map(i => ({ name: i.item_name, defaultAmount: i.default_amount ?? 0 })));
            } else {
                setDefaultAmountItems(medicineItems.filter(i => i.checked).map(i => ({ name: i.name, defaultAmount: 0 })));
            }
        } catch {
            setDefaultAmountItems(medicineItems.filter(i => i.checked).map(i => ({ name: i.name, defaultAmount: 0 })));
        }
        setShowDefaultAmountModal(true);
    };

    const handleSaveDefaultAmounts = async () => {
        setIsSavingDefaultAmounts(true);
        try {
            const res = await SettingsModel.saveMedicineDefaults(defaultAmountItems);
            if (res.success) {
                showAlert?.('기본 입고량이 저장되었습니다.');
                setShowDefaultAmountModal(false);
            } else {
                throw new Error(res.message || '저장 실패');
            }
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
        try {
            const res = await SettingsModel.getKitDefaults();
            if (res.success) {
                setKitDefaultItems(res.items.map(i => ({ name: i.item_name, defaultAmount: i.default_amount ?? 0 })));
            } else {
                setKitDefaultItems(BASE_KIT_NAMES.map(name => ({ name, defaultAmount: 0 })));
            }
        } catch {
            setKitDefaultItems(BASE_KIT_NAMES.map(name => ({ name, defaultAmount: 0 })));
        }
        setShowKitDefaultModal(true);
    };

    const handleSaveKitDefaults = async () => {
        setIsSavingKitDefaults(true);
        try {
            const res = await SettingsModel.saveKitDefaults(kitDefaultItems);
            if (res.success) {
                showAlert?.('키트 기본 입고량이 저장되었습니다.');
                setShowKitDefaultModal(false);
            } else {
                throw new Error(res.message || '저장 실패');
            }
        } catch (err) {
            showAlert?.('키트 기본 입고량 저장 중 오류: ' + err.message);
        } finally {
            setIsSavingKitDefaults(false);
        }
    };

    return {
        activeTab, setActiveTab, isLoading, hasLoadedSettings,
        siteInfo, setSiteInfo, handleSeriesChange,
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
        flowOption, setFlowOption, handleSaveFlowOption,
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
