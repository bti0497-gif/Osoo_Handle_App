import React from 'react';
import { useSettingsViewModel } from './useSettingsViewModel';
import { useDialog } from '../../components/common/DialogContext';
import DefaultAmountModal from './components/DefaultAmountModal';
import SettingsShell from './components/SettingsShell';
import ItemActiveGrid from './widgets/ItemActiveGrid';
import MedicinePanel from './panels/MedicinePanel';
import KitPanel from './panels/KitPanel';
import FlowMappingPanel from './panels/FlowMappingPanel';
import WaterMappingPanel from './panels/WaterMappingPanel';
import WebAppPanel from './panels/WebAppPanel';
import LogMappingPanel from './panels/LogMappingPanel';
import BasicSitePanel from './panels/BasicSitePanel';

const SettingsView = ({ currentUser }) => {
    const { showAlert, showConfirm } = useDialog();
    const vm = useSettingsViewModel(currentUser, { showAlert, showConfirm });
    const {
        shellState,
        basicSiteState,
        itemState,
        templateState,
        mappingState,
        webAppState,
        logMappingState,
        defaultAmountState,
        alphabet,
    } = vm;
    const {
        activeTab, setActiveTab, isLoading, isAppSiteConfigured,
        importProgress, setImportProgress, importedData, showDataModal, setShowDataModal,
    } = shellState;
    const {
        siteInfo, availableSites, selectedSiteId, isSiteListLoading, handleSiteSelection, handleCaptureSiteLocation,
        handleApply, handleClearBigQueryOperationalData,
    } = basicSiteState;
    const {
        flowItems, medicineItems, kitItems, locationItems,
        newFlowItem, setNewFlowItem, newMedicineItem, setNewMedicineItem, newLocationItem, setNewLocationItem,
        addItem, toggleItem, moveLocationItem, getFlowRowsForExcelMapping,
    } = itemState;
    const {
        excelFileName, templateFileNames, handleExcelFileUpload, handleTemplateFileChange, handleOpenLocalFolder,
        excelSheets, sampleRowData, excelStatus, isMetadataLoading, isPreviewLoading,
    } = templateState;
    const {
        flow: flowMappingSettings,
        medicine: medicineMappingSettings,
        kit: kitMappingSettings,
        water: waterMappingSettings,
    } = mappingState;
    const {
        webAppCredentials, qntechImportSettings, passwordVisibility, urlEditability,
        updateWebAppCredentialField, togglePasswordVisibility, toggleUrlEditability, handleSaveWebAppCredentials,
        updateQntechImportSettingField, updateQntechSampleMapping, addQntechSampleMapping, removeQntechSampleMapping, handleSaveQntechImportSettings,
        geminiApiKey, setGeminiApiKey, geminiKeyVisible, setGeminiKeyVisible, handleSaveGeminiApiKey,
    } = webAppState;
    const {
        LOG_TYPES, selectedLogType, setSelectedLogType,
        flowOption, setFlowOption, handleSaveFlowOption,
        sludgeExportSettings, setSludgeExportSettings,
        isSavingSludgeExportSettings, handleSaveSludgeExportSettings,
    } = logMappingState;
    const {
        showDefaultAmountModal, setShowDefaultAmountModal,
        defaultAmountItems, setDefaultAmountItems,
        isSavingDefaultAmounts,
        handleOpenDefaultAmountModal, handleSaveDefaultAmounts,
        showKitDefaultModal, setShowKitDefaultModal,
        kitDefaultItems, setKitDefaultItems,
        isSavingKitDefaults,
        handleOpenKitDefaultModal, handleSaveKitDefaults,
    } = defaultAmountState;
    const { config: flowConfig, setConfig: setFlowConfig, mapping: flowMapping, setMapping: setFlowMapping, onSave: handleSaveFlowMapping } = flowMappingSettings;
    const { config: medicineConfig, setConfig: setMedicineConfig, mapping: medicineMapping, setMapping: setMedicineMapping, onSave: handleSaveMedicineMapping } = medicineMappingSettings;
    const { config: kitConfig, setConfig: setKitConfig, mapping: kitMapping, setMapping: setKitMapping, onSave: handleSaveKitMapping } = kitMappingSettings;
    const { config: waterConfig, setConfig: setWaterConfig, mapping: waterMapping, setMapping: setWaterMapping, onSave: handleSaveWaterMapping } = waterMappingSettings;

    const isSiteSelected = Boolean(selectedSiteId && siteInfo?.siteName);

    React.useEffect(() => {
        if (!isAppSiteConfigured && activeTab !== 'basic') {
            setActiveTab('basic');
        }
    }, [isAppSiteConfigured, activeTab, setActiveTab]);

    const renderFlowSettings = () => (
        <FlowMappingPanel
            flowConfig={flowConfig}
            setFlowConfig={setFlowConfig}
            medicineConfig={medicineConfig}
            setMedicineConfig={setMedicineConfig}
            kitConfig={kitConfig}
            setKitConfig={setKitConfig}
            waterConfig={waterConfig}
            setWaterConfig={setWaterConfig}
            flowMapping={flowMapping}
            setFlowMapping={setFlowMapping}
            excelSheets={excelSheets}
            sampleRowData={sampleRowData}
            alphabet={alphabet}
            isMetadataLoading={isMetadataLoading}
            isPreviewLoading={isPreviewLoading}
            importedData={importedData}
            setShowDataModal={setShowDataModal}
            showAlert={showAlert}
            showConfirm={showConfirm}
            handleSaveFlowMapping={handleSaveFlowMapping}
            getFlowRowsForExcelMapping={getFlowRowsForExcelMapping}
        />
    );

    // handleSaveFlowMapping, handleSaveKitMapping → moved to useSettingsViewModel

    // handleSaveMedicineMapping → moved to useSettingsViewModel

    const renderMedicineSettings = () => (
        <MedicinePanel
            items={medicineItems}
            config={medicineConfig}
            setConfig={setMedicineConfig}
            mapping={medicineMapping}
            setMapping={setMedicineMapping}
            excelSheets={excelSheets}
            sampleRowData={sampleRowData}
            alphabet={alphabet}
            isMetadataLoading={isMetadataLoading}
            isPreviewLoading={isPreviewLoading}
            importedData={importedData}
            setShowDataModal={setShowDataModal}
            showAlert={showAlert}
            showConfirm={showConfirm}
            onSave={handleSaveMedicineMapping}
        />
    );

    const renderKitSettings = () => (
        <KitPanel
            items={kitItems}
            config={kitConfig}
            setConfig={setKitConfig}
            mapping={kitMapping}
            setMapping={setKitMapping}
            excelSheets={excelSheets}
            sampleRowData={sampleRowData}
            alphabet={alphabet}
            isMetadataLoading={isMetadataLoading}
            isPreviewLoading={isPreviewLoading}
            importedData={importedData}
            setShowDataModal={setShowDataModal}
            showAlert={showAlert}
            showConfirm={showConfirm}
            onSave={handleSaveKitMapping}
        />
    );

    const renderWaterSettings = () => (
        <WaterMappingPanel
            locationItems={locationItems}
            waterConfig={waterConfig}
            setWaterConfig={setWaterConfig}
            waterMapping={waterMapping}
            setWaterMapping={setWaterMapping}
            excelSheets={excelSheets}
            sampleRowData={sampleRowData}
            alphabet={alphabet}
            isMetadataLoading={isMetadataLoading}
            isPreviewLoading={isPreviewLoading}
            siteInfo={siteInfo}
            showAlert={showAlert}
            showConfirm={showConfirm}
            handleSaveWaterMapping={handleSaveWaterMapping}
        />
    );

    // handleApply → moved to useSettingsViewModel

    const renderItemGrid = (items, type) => (
        <ItemActiveGrid
            items={items}
            type={type}
            isSiteSelected={isSiteSelected}
            onToggle={toggleItem}
        />
    );

    const renderLogMappingSettings = () => (
        <LogMappingPanel
            LOG_TYPES={LOG_TYPES}
            selectedLogType={selectedLogType}
            setSelectedLogType={setSelectedLogType}
            siteInfo={siteInfo}
            flowOption={flowOption}
            setFlowOption={setFlowOption}
            handleSaveFlowOption={handleSaveFlowOption}
            sludgeExportSettings={sludgeExportSettings}
            setSludgeExportSettings={setSludgeExportSettings}
            isSavingSludgeExportSettings={isSavingSludgeExportSettings}
            handleSaveSludgeExportSettings={handleSaveSludgeExportSettings}
        />
    );

    const renderWebAppSettings = () => (
        <WebAppPanel
            webAppCredentials={webAppCredentials}
            passwordVisibility={passwordVisibility}
            urlEditability={urlEditability}
            updateWebAppCredentialField={updateWebAppCredentialField}
            togglePasswordVisibility={togglePasswordVisibility}
            toggleUrlEditability={toggleUrlEditability}
            handleSaveWebAppCredentials={handleSaveWebAppCredentials}
            geminiApiKey={geminiApiKey}
            setGeminiApiKey={setGeminiApiKey}
            geminiKeyVisible={geminiKeyVisible}
            setGeminiKeyVisible={setGeminiKeyVisible}
            handleSaveGeminiApiKey={handleSaveGeminiApiKey}
            locationItems={locationItems}
            qntechImportSettings={qntechImportSettings}
            updateQntechImportSettingField={updateQntechImportSettingField}
            updateQntechSampleMapping={updateQntechSampleMapping}
            addQntechSampleMapping={addQntechSampleMapping}
            removeQntechSampleMapping={removeQntechSampleMapping}
            handleSaveQntechImportSettings={handleSaveQntechImportSettings}
        />
    );

    const renderBasicSettings = () => (
        <BasicSitePanel
            availableSites={availableSites}
            selectedSiteId={selectedSiteId}
            isSiteListLoading={isSiteListLoading}
            handleSiteSelection={handleSiteSelection}
            siteInfo={siteInfo}
            isSiteSelected={isSiteSelected}
            handleCaptureSiteLocation={handleCaptureSiteLocation}
            flowItems={flowItems}
            medicineItems={medicineItems}
            locationItems={locationItems}
            moveLocationItem={moveLocationItem}
            toggleItem={toggleItem}
            renderItemGrid={renderItemGrid}
            newFlowItem={newFlowItem}
            setNewFlowItem={setNewFlowItem}
            newMedicineItem={newMedicineItem}
            setNewMedicineItem={setNewMedicineItem}
            newLocationItem={newLocationItem}
            setNewLocationItem={setNewLocationItem}
            addItem={addItem}
            handleOpenDefaultAmountModal={handleOpenDefaultAmountModal}
            handleOpenKitDefaultModal={handleOpenKitDefaultModal}
            excelFileName={excelFileName}
            templateFileNames={templateFileNames}
            handleExcelFileUpload={handleExcelFileUpload}
            handleTemplateFileChange={handleTemplateFileChange}
            handleOpenLocalFolder={handleOpenLocalFolder}
            excelStatus={excelStatus}
            handleApply={handleApply}
            handleClearBigQueryOperationalData={handleClearBigQueryOperationalData}
        />
    );

    const renderActivePanel = () => {
        const panels = {
            basic: renderBasicSettings,
            flow: renderFlowSettings,
            medicine: renderMedicineSettings,
            water: renderWaterSettings,
            kit: renderKitSettings,
            logMapping: renderLogMappingSettings,
            webapp: renderWebAppSettings,
        };
        return panels[activeTab]?.() || null;
    };

    return (
        <SettingsShell
            isLoading={isLoading}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            isAppSiteConfigured={isAppSiteConfigured}
            importProgress={importProgress}
            setImportProgress={setImportProgress}
            showDataModal={showDataModal}
            importedData={importedData}
            setShowDataModal={setShowDataModal}
        >
            {renderActivePanel()}
            {/* 키트 기본 입고량 모달 */}
            <DefaultAmountModal
                isOpen={showKitDefaultModal}
                title="키트 기본 입고량 지정"
                items={kitDefaultItems}
                setItems={setKitDefaultItems}
                unit="개"
                emptyMessage="키트 항목이 없습니다."
                isSaving={isSavingKitDefaults}
                onClose={() => setShowKitDefaultModal(false)}
                onSave={handleSaveKitDefaults}
            />

            <DefaultAmountModal
                isOpen={showDefaultAmountModal}
                title="약품 기본 입고량 지정"
                items={defaultAmountItems}
                setItems={setDefaultAmountItems}
                unit="kg"
                emptyMessage="약품 항목이 없습니다."
                isSaving={isSavingDefaultAmounts}
                onClose={() => setShowDefaultAmountModal(false)}
                onSave={handleSaveDefaultAmounts}
                maxHeight="280px"
            />
        </SettingsShell>
    );
};

export default SettingsView;
