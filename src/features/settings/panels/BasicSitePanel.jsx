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
  handleCaptureSiteLocation,
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
  handleClearBigQueryOperationalData,
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
                handleCaptureSiteLocation={handleCaptureSiteLocation}
            />
            <div style={{
                display: 'flex',
                justifyContent: 'flex-end',
                marginTop: '-1.5rem',
            }}>
                <button
                    type="button"
                    onClick={handleClearBigQueryOperationalData}
                    disabled={!isSiteSelected}
                    title="현재 현장의 BigQuery 운영 데이터(유량·약품·수질·키트)를 삭제합니다. 출결은 삭제하지 않습니다."
                    style={{
                        border: '1px solid #fecaca',
                        background: isSiteSelected ? '#fff1f2' : '#f8fafc',
                        color: isSiteSelected ? '#be123c' : '#94a3b8',
                        borderRadius: 10,
                        padding: '0.7rem 1rem',
                        fontWeight: 800,
                        cursor: isSiteSelected ? 'pointer' : 'not-allowed',
                    }}
                >
                    BigQuery 운영데이터 초기화
                </button>
            </div>

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
