import { useState } from 'react';
import { SettingsModel } from '../SettingsModel';
import {
    DEFAULT_ROAD_WEB_URL,
    DEFAULT_WATER_ANALYSIS_URL,
} from '../settingsDefaults';

export const useExternalServiceSettings = ({ showAlert, reloadSettings } = {}) => {
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

    const [geminiApiKey, setGeminiApiKey] = useState('');
    const [geminiKeyVisible, setGeminiKeyVisible] = useState(false);

    const hydrateExternalSettings = (credentials, settings = {}) => {
        if (Array.isArray(credentials) && credentials.length > 0) {
            const credentialMap = credentials.reduce((acc, item) => {
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

            if (credentialMap.gemini_api) {
                setGeminiApiKey(credentialMap.gemini_api.password || '');
            }
        }

        let restoredQntechMappings = [];
        if (settings.qntech_sample_mappings) {
            try {
                const parsed = JSON.parse(settings.qntech_sample_mappings);
                restoredQntechMappings = Array.isArray(parsed) ? parsed : [];
            } catch {
                restoredQntechMappings = [];
            }
        }

        setQntechImportSettings({
            photoRoot: settings.qntech_photo_root || '사진관리/수질분석',
            sampleMappings: restoredQntechMappings
        });
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
            reloadSettings?.();
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
            reloadSettings?.();
        } catch (err) {
            console.error('QnTECH import settings save error:', err);
            showAlert?.('QnTECH 불러오기 설정 저장 중 오류가 발생했습니다: ' + err.message);
        }
    };

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
            showAlert?.('Gemini API 키 저장 중 오류가 발생했습니다: ' + err.message);
        }
    };

    return {
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
    };
};
