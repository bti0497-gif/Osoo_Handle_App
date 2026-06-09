import { useState } from 'react';
import { SettingsModel } from '../SettingsModel';

export const useMappingSettings = ({
    flowConfig,
    flowMapping,
    medicineConfig,
    medicineMapping,
    kitConfig,
    kitMapping,
    waterConfig,
    waterMapping,
    reloadSettings,
} = {}) => {
    const [importProgress, setImportProgress] = useState({ current: 0, total: 0, status: 'idle', isVisible: false });
    const [importedData, setImportedData] = useState(null);
    const [showDataModal, setShowDataModal] = useState(false);

    const saveMappingWithProgress = async ({ config, mapping, save }) => {
        try {
            setImportProgress({
                current: 0,
                total: config.endRow - config.startRow + 1,
                status: 'processing',
                isVisible: true
            });
            const res = await save({ config, mapping });
            if (res.success) {
                const prog = await SettingsModel.getImportProgress();
                setImportedData(prog.result);
                setImportProgress({
                    current: prog.total,
                    total: prog.total,
                    status: 'completed',
                    isVisible: true
                });
                reloadSettings?.();
            } else {
                throw new Error(res.message);
            }
        } catch (err) {
            setImportProgress({
                current: 0,
                total: 0,
                status: 'error',
                isVisible: true,
                result: err.message
            });
        }
    };

    const handleSaveFlowMapping = () => saveMappingWithProgress({
        config: flowConfig,
        mapping: flowMapping,
        save: SettingsModel.saveFlowMapping,
    });

    const handleSaveMedicineMapping = () => saveMappingWithProgress({
        config: medicineConfig,
        mapping: medicineMapping,
        save: SettingsModel.saveMedicineMapping,
    });

    const handleSaveWaterMapping = () => saveMappingWithProgress({
        config: waterConfig,
        mapping: waterMapping,
        save: SettingsModel.saveWaterMapping,
    });

    const handleSaveKitMapping = () => saveMappingWithProgress({
        config: kitConfig,
        mapping: kitMapping,
        save: SettingsModel.saveKitMapping,
    });

    return {
        importProgress,
        setImportProgress,
        importedData,
        showDataModal,
        setShowDataModal,
        handleSaveFlowMapping,
        handleSaveMedicineMapping,
        handleSaveKitMapping,
        handleSaveWaterMapping,
    };
};
