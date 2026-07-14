import { useRef, useState } from 'react';
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
    const previewRequestIdRef = useRef(0);

    const hydrateTemplateSettings = (settings = {}) => {
        if (settings.excel_template_path) {
            setExcelFileName(settings.excel_template_path.split(/[/\\]/).pop());
        }
        setTemplateFileNames('');
    };

    const normalizeSheets = (rawSheets = []) => (
        rawSheets.map((s) => (typeof s === 'object' ? (s.sheet_name || s.name || '') : s))
    );

    const checkExcelStatus = async () => {
        setIsMetadataLoading(true);
        try {
            const result = await SettingsModel.getExcelStatus();
            const normalizedSheets = normalizeSheets(result.sheets || []);
            const nextStatus = {
                status: result.status,
                fileName: result.fileName || null,
                sheets: normalizedSheets,
            };
            setExcelStatus(nextStatus);
            setExcelSheets(normalizedSheets);
        } catch {
            setExcelStatus({ status: 'error', fileName: null, sheets: [] });
        } finally {
            setIsMetadataLoading(false);
        }
    };

    const loadExcelPreview = async (sheet, row) => {
        const requestId = previewRequestIdRef.current + 1;
        previewRequestIdRef.current = requestId;
        setIsPreviewLoading(true);
        try {
            const res = await SettingsModel.getExcelPreview(sheet, row);
            if (requestId !== previewRequestIdRef.current) return;
            setSampleRowData(res.success ? res.data : {});
        } catch {
            if (requestId !== previewRequestIdRef.current) return;
            setSampleRowData({});
        } finally {
            if (requestId === previewRequestIdRef.current) {
                setIsPreviewLoading(false);
            }
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
                const normalizedSheets = normalizeSheets(result.sheets || []);
                setExcelStatus({ status: 'ready', fileName: file.name, sheets: normalizedSheets });
                setExcelSheets(normalizedSheets);
            } else {
                throw new Error(result.message || '업로드 실패');
            }
        } catch (err) {
            setExcelStatus({ status: 'error', fileName: file.name, sheets: [] });
            showAlert?.('기존 운영 엑셀 원본 처리 실패: ' + err.message);
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
            showAlert?.('선택한 일지 양식을 로컬 템플릿 폴더로 복사했습니다.');
        } catch (err) {
            console.error('Template upload error:', err);
            showAlert?.('일지 양식 파일 복사 중 오류가 발생했습니다: ' + err.message);
            reloadSettings?.();
        } finally {
            setIsUploading(false);
        }
    };

    const handleOpenLocalFolder = async (target) => {
        try {
            const electronOpenFile = window.electronAPI?.openFile;
            const result = await SettingsModel.openLocalFolder(target, {
                openInServer: typeof electronOpenFile !== 'function',
            });
            const label = target === 'reports'
                ? '일지 양식 저장 폴더'
                : '기존 운영 엑셀 원본 저장 폴더';
            if (!result?.success || !result?.path) {
                throw new Error(result?.message || '폴더 경로를 확인할 수 없습니다.');
            }
            if (typeof electronOpenFile === 'function') {
                const openResult = await electronOpenFile(result.path);
                if (!openResult?.ok) {
                    throw new Error(openResult?.error || 'Windows 탐색기를 실행하지 못했습니다.');
                }
            }
            showAlert?.(`${label}를 열었습니다.\n창이 보이지 않으면 작업 표시줄 또는 앱 뒤쪽 창을 확인해주세요.\n${result?.path || ''}`);
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
