import { useState } from 'react';
import { SettingsModel } from '../SettingsModel';

export const useTemplateSettings = ({ showAlert, reloadSettings } = {}) => {
    const [excelFileName, setExcelFileName] = useState('');
    const [templateFileNames, setTemplateFileNames] = useState('');
    const [templateFiles, setTemplateFiles] = useState([]);
    const [excelSheets, setExcelSheets] = useState([]);
    const [sampleRowData, setSampleRowData] = useState({});
    const [excelStatus, setExcelStatus] = useState({ status: 'idle', fileName: null, sheets: [] });
    const [isMetadataLoading, setIsMetadataLoading] = useState(false);
    const [isPreviewLoading, setIsPreviewLoading] = useState(false);
    const [isUploading, setIsUploading] = useState(false);

    const hydrateTemplateSettings = (settings = {}) => {
        if (settings.excel_template_path) {
            setExcelFileName(settings.excel_template_path.split(/[/\\]/).pop());
        }
        setTemplateFileNames('');
    };

    const checkExcelStatus = async () => {
        setIsMetadataLoading(true);
        try {
            const result = await SettingsModel.getExcelStatus();
            const nextStatus = {
                status: result.status,
                fileName: result.fileName || null,
                sheets: result.sheets || []
            };
            setExcelStatus(nextStatus);
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
        } catch {
            setSampleRowData({});
        } finally {
            setIsPreviewLoading(false);
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
            reloadSettings?.();
        } finally {
            setIsUploading(false);
        }
    };

    const handleOpenLocalFolder = async (target) => {
        try {
            await SettingsModel.openLocalFolder(target);
        } catch (err) {
            showAlert?.('로컬 폴더를 열 수 없습니다: ' + err.message);
        }
    };

    return {
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
    };
};
