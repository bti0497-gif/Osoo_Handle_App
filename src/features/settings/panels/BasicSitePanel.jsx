import React from 'react';
import TemplateFilePanel from './TemplateFilePanel';
import BasicSiteHeaderPanel from './BasicSiteHeaderPanel';
import ItemManagementPanel from './ItemManagementPanel';
import MeasurementPlacePanel from './MeasurementPlacePanel';

export default function BasicSitePanel({
  availableSites,
  selectedSiteId,
  isSiteListLoading,
  handleSiteSelection,
  siteInfo,
  isSiteSelected,
  flowItems,
  medicineItems,
  locationItems,
  moveLocationItem,
  toggleItem,
  renderItemGrid,
  newFlowItem,
  setNewFlowItem,
  newMedicineItem,
  setNewMedicineItem,
  newLocationItem,
  setNewLocationItem,
  addItem,
  handleOpenDefaultAmountModal,
  handleOpenKitDefaultModal,
  excelFileName,
  templateFileNames,
  handleExcelFileUpload,
  handleTemplateFileChange,
  excelStatus,
  handleApply,
}) {
    const renderBasicSettings = () => (
        <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>
            {/* 상단 섹션: 2x2 Grid */}
            <BasicSiteHeaderPanel
                availableSites={availableSites}
                selectedSiteId={selectedSiteId}
                isSiteListLoading={isSiteListLoading}
                handleSiteSelection={handleSiteSelection}
                siteInfo={siteInfo}
                isSiteSelected={isSiteSelected}
            />

            {/* 중간 섹션: 항목 관리 위젯 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                <ItemManagementPanel
                    title="검침항목 위젯"
                    items={flowItems}
                    type="flow"
                    value={newFlowItem}
                    onValueChange={setNewFlowItem}
                    placeholder="검침 항목 추가..."
                    addTitle="검침 항목 추가"
                    renderItemGrid={renderItemGrid}
                    addItem={addItem}
                />
                <ItemManagementPanel
                    title="약품항목 위젯"
                    items={medicineItems}
                    type="medicine"
                    value={newMedicineItem}
                    onValueChange={setNewMedicineItem}
                    placeholder="약품 항목 추가..."
                    addTitle="약품 항목 추가"
                    renderItemGrid={renderItemGrid}
                    addItem={addItem}
                    actionLabel="입고량지정"
                    onAction={handleOpenDefaultAmountModal}
                />
                <MeasurementPlacePanel
                    items={locationItems}
                    isSiteSelected={isSiteSelected}
                    value={newLocationItem}
                    onValueChange={setNewLocationItem}
                    onToggle={toggleItem}
                    onMove={moveLocationItem}
                    addItem={addItem}
                    onOpenKitDefaultModal={handleOpenKitDefaultModal}
                />
            </div>

            {/* 하단 버튼 및 파일 관리 섹션 */}
            <TemplateFilePanel
                excelFileName={excelFileName}
                templateFileNames={templateFileNames}
                handleExcelFileUpload={handleExcelFileUpload}
                handleTemplateFileChange={handleTemplateFileChange}
                excelStatus={excelStatus}
                handleApply={handleApply}
                isSiteSelected={isSiteSelected}
            />
        </div>
    );


    return renderBasicSettings();
}
