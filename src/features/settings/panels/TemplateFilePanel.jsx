import React from 'react';
import TemplateUploadCard from '../widgets/TemplateUploadCard';

export default function TemplateFilePanel({
    excelFileName,
    templateFileNames,
    handleExcelFileUpload,
    handleTemplateFileChange,
    handleOpenLocalFolder,
    excelStatus,
    handleApply,
    isSiteSelected,
}) {
    return (
        <div style={{
            marginTop: '0.5rem',
            paddingTop: '1.5rem',
            borderTop: '1px solid #f1f5f9',
            display: 'flex',
            alignItems: 'flex-end',
            gap: '1.25rem',
        }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <TemplateUploadCard
                    label="기존 운영 엑셀 원본 불러오기"
                    value={excelFileName}
                    placeholder="기존 관리 엑셀 원본 파일을 선택해주세요..."
                    buttonLabel="파일 선택"
                    icon="file_open"
                    accept=".xlsx, .xls, .xlsm"
                    status={excelStatus}
                    onFileChange={handleExcelFileUpload}
                    onOpenFolder={() => handleOpenLocalFolder?.('excel-originals')}
                    openFolderTitle="기존 운영 엑셀 원본 저장 폴더 열기"
                    showExportPlaceholder
                />

                <TemplateUploadCard
                    label="일지 양식 불러오기"
                    value={templateFileNames}
                    title={templateFileNames}
                    placeholder="선택한 일지 양식을 로컬 템플릿 폴더로 복사합니다."
                    buttonLabel="양식 선택"
                    icon="library_add"
                    accept=".xlsx, .xls, .xlsm, .hwpx"
                    multiple
                    onFileChange={handleTemplateFileChange}
                    onOpenFolder={() => handleOpenLocalFolder?.('reports')}
                    openFolderTitle="일지 양식 저장 폴더 열기"
                />
            </div>

            <button
                onClick={handleApply}
                disabled={!isSiteSelected}
                style={{
                    width: '180px',
                    height: '112px',
                    backgroundColor: isSiteSelected ? '#1e293b' : '#94a3b8',
                    color: 'white',
                    border: 'none',
                    borderRadius: '12px',
                    fontSize: '0.9375rem',
                    fontWeight: 900,
                    cursor: isSiteSelected ? 'pointer' : 'not-allowed',
                    boxShadow: '0 4px 10px -2px rgba(30,41,59,0.2)',
                    transition: 'all 0.15s',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    flexShrink: 0,
                }}
                onMouseEnter={(e) => {
                    if (!isSiteSelected) return;
                    e.currentTarget.style.backgroundColor = '#0f172a';
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = isSiteSelected ? '#1e293b' : '#94a3b8';
                }}
            >
                <span className="material-icons" style={{ fontSize: '24px' }}>save</span>
                설정 저장하기
            </button>
        </div>
    );
}
