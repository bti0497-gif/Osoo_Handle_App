import { useState, useEffect } from 'react';
import { SettingsModel } from './SettingsModel';

const ALPHABET = (() => {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const res = [...letters];
    letters.forEach(l => res.push('A' + l));
    return res;
})();

export const useSettingsViewModel = (currentUser) => {
    const [activeTab, setActiveTab] = useState('basic');
    const [isLoading, setIsLoading] = useState(true);
    const [hasLoadedSettings, setHasLoadedSettings] = useState(false);

    const [siteInfo, setSiteInfo] = useState({
        siteName: '오수처리장',
        managerName: currentUser?.name || '관리자',
        method: 'A2O',
        series: '1계열'
    });

    const [flowItems, setFlowItems] = useState([
        { name: '유입유량계', checked: true }, { name: '방류유량계', checked: true },
        { name: '내부반송유량계', checked: true }, { name: '외부반송유량계', checked: true },
        { name: '전력량계', checked: true }, { name: '슬러지', checked: true }
    ]);
    const [medicineItems, setMedicineItems] = useState([
        { name: '중탄산나트륨', checked: true }, { name: '포도당', checked: true },
        { name: '팩(PAC)', checked: true }, { name: '차염산나트륨', checked: false },
        { name: '알민산나트륨', checked: false }
    ]);
    const [waterItems, setWaterItems] = useState([
        { name: '암모니아성질소', checked: true }, { name: '질산성질소', checked: true },
        { name: '인산염인', checked: true }, { name: '알칼리도', checked: true }
    ]);

    const [newFlowItem, setNewFlowItem] = useState('');
    const [newMedicineItem, setNewMedicineItem] = useState('');
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

    const [importProgress, setImportProgress] = useState({ current: 0, total: 0, status: 'idle', isVisible: false });
    const [importedData, setImportedData] = useState(null);
    const [showDataModal, setShowDataModal] = useState(false);
    const [excelStatus, setExcelStatus] = useState({ status: 'idle', fileName: null, sheets: [] });
    const [isMetadataLoading, setIsMetadataLoading] = useState(false);
    const [isPreviewLoading, setIsPreviewLoading] = useState(false);
    const [isUploading, setIsUploading] = useState(false);

    useEffect(() => { loadSettings(); }, []);

    useEffect(() => {
        if (activeTab === 'flow' || activeTab === 'medicine' || activeTab === 'kit') {
            if (excelStatus.status === 'ready') {
                setExcelSheets(excelStatus.sheets);
            } else if (excelStatus.status !== 'loading') {
                checkExcelStatus();
            }
        }
    }, [activeTab]);

    useEffect(() => {
        if (activeTab === 'flow' && flowConfig.sheet && flowConfig.startRow)
            loadExcelPreview(flowConfig.sheet, flowConfig.startRow);
        else if (activeTab === 'medicine' && medicineConfig.sheet && medicineConfig.startRow)
            loadExcelPreview(medicineConfig.sheet, medicineConfig.startRow);
        else if (activeTab === 'kit' && kitConfig.sheet && kitConfig.startRow)
            loadExcelPreview(kitConfig.sheet, kitConfig.startRow);
    }, [activeTab, flowConfig.sheet, flowConfig.startRow, medicineConfig.sheet, medicineConfig.startRow, kitConfig.sheet, kitConfig.startRow]);

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
                if (data.settings.flow_sheet) setFlowConfig({ sheet: data.settings.flow_sheet, startRow: data.settings.flow_start_row || 1, endRow: data.settings.flow_end_row || 31, dateCol: data.settings.flow_date_col || 'A' });
                if (data.settings.med_sheet) setMedicineConfig({ sheet: data.settings.med_sheet, startRow: data.settings.med_start_row || 1, endRow: data.settings.med_end_row || 31, dateCol: data.settings.med_date_col || 'A' });
                if (data.settings.kit_sheet) setKitConfig({ sheet: data.settings.kit_sheet, startRow: data.settings.kit_start_row || 1, endRow: data.settings.kit_end_row || 31, dateCol: data.settings.kit_date_col || 'A' });

                if (data.configItems?.length > 0) {
                    const flows = data.configItems.filter(i => i.category === 'flow');
                    if (flows.length > 0) {
                        setFlowItems(flows.map(i => ({ name: i.item_name, checked: !!i.is_active })));
                        const restored = {}; flows.forEach(i => { if (i.excel_cell) restored[i.item_name] = i.excel_cell; });
                        if (Object.keys(restored).length > 0) setFlowMapping(restored);
                    }
                    const meds = data.configItems.filter(i => i.category === 'medicine');
                    if (meds.length > 0) {
                        setMedicineItems(meds.map(i => ({ name: i.item_name, checked: !!i.is_active })));
                        const restored = {}; meds.forEach(i => { if (i.excel_cell) restored[i.item_name] = i.excel_cell; });
                        if (Object.keys(restored).length > 0) setMedicineMapping(restored);
                    }
                    const water = data.configItems.filter(i => i.category === 'water');
                    if (water.length > 0) setWaterItems(water.map(i => ({ name: i.item_name, checked: !!i.is_active })));
                    const kits = data.configItems.filter(i => i.category === 'kit');
                    if (kits.length > 0) {
                        const restored = {}; kits.forEach(i => { if (i.excel_cell) restored[i.item_name] = i.excel_cell; });
                        if (Object.keys(restored).length > 0) setKitMapping(restored);
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
            }
        } catch (err) {
            console.error('항목 추가 실패:', err);
            alert('항목 추가에 실패했습니다: ' + err.message);
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
            if (hasLoadedSettings) {
                const confirmed = window.confirm("이미 기본 설정이 저장되어 있는 상태입니다. \n이 내용을 바탕으로 설정을 수정하시겠습니까?");
                if (!confirmed) return;
            }
            const configItems = [
                ...flowItems.map(i => ({ ...i, category: 'flow' })),
                ...medicineItems.map(i => ({ ...i, category: 'medicine' })),
                ...waterItems.map(i => ({ ...i, category: 'water' }))
            ];
            const response = await SettingsModel.saveSettings({ settings: siteInfo, configItems });

            if (templateFiles.length > 0) {
                const formData = new FormData();
                templateFiles.forEach(file => formData.append('report_templates', file));
                await SettingsModel.uploadFiles(formData);
            }

            if (response.success) {
                alert('설정이 성공적으로 저장되었습니다.');
                setTemplateFiles([]);
                loadSettings();
            } else {
                throw new Error(response.message || '알 수 없는 오류가 발생했습니다.');
            }
        } catch (err) {
            console.error('Settings Apply Error:', err);
            alert('저장 중 오류가 발생했습니다: ' + err.message);
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
            alert('엑셀 파일 처리 실패: ' + err.message);
        } finally {
            setIsUploading(false);
        }
    };

    const handleTemplateFileChange = (files) => {
        setTemplateFiles(files);
        setTemplateFileNames(files.length > 0 ? files.map(f => f.name).join(', ') : '');
    };

    return {
        activeTab, setActiveTab, isLoading, hasLoadedSettings,
        siteInfo, setSiteInfo, handleSeriesChange,
        flowItems, medicineItems, waterItems,
        newFlowItem, setNewFlowItem, newMedicineItem, setNewMedicineItem,
        addItem, toggleItem,
        excelFileName, templateFileNames,
        templateFiles,
        handleExcelFileUpload, handleTemplateFileChange,
        flowConfig, setFlowConfig, flowMapping, setFlowMapping,
        medicineConfig, setMedicineConfig, medicineMapping, setMedicineMapping,
        kitConfig, setKitConfig, kitMapping, setKitMapping,
        excelSheets, sampleRowData,
        excelStatus, isMetadataLoading, isPreviewLoading, isUploading,
        importProgress, setImportProgress, importedData, showDataModal, setShowDataModal,
        handleSaveFlowMapping, handleSaveMedicineMapping, handleSaveKitMapping,
        handleApply,
        alphabet: ALPHABET,
    };
};
