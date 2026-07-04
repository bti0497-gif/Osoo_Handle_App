import { useState } from 'react';
import { SettingsModel } from '../SettingsModel';
import { FlowModel } from '../../flow/FlowModel';
import { MedicineModel } from '../../medicine/MedicineModel';
import { KitModel } from '../../kit/KitModel';
import { WaterQualityModel } from '../../water/WaterQualityModel';

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

    const saveMappingWithProgress = async ({ type, config, mapping, save, clearCache }) => {
        try {
            setImportProgress({
                current: 0,
                total: config.endRow - config.startRow + 1,
                status: 'processing',
                isVisible: true
            });
            const res = await save({ config, mapping });
            if (res.success) {
                const prog = await SettingsModel.getImportProgress(type);
                setImportedData(prog.result);
                setImportProgress({
                    current: prog.total,
                    total: prog.total,
                    status: 'completed',
                    isVisible: true
                });
                clearCache?.();
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
        type: 'flow',
        config: flowConfig,
        mapping: flowMapping,
        save: SettingsModel.saveFlowMapping,
        clearCache: () => FlowModel.clearHistoryCache(),
    });

    const handleSaveMedicineMapping = () => saveMappingWithProgress({
        type: 'medicine',
        config: medicineConfig,
        mapping: medicineMapping,
        save: SettingsModel.saveMedicineMapping,
        clearCache: () => MedicineModel.clearHistoryCache(),
    });

    const handleSaveWaterMapping = () => saveMappingWithProgress({
        type: 'water',
        config: waterConfig,
        mapping: waterMapping,
        save: SettingsModel.saveWaterMapping,
        clearCache: () => WaterQualityModel.clearHistoryCache(),
    });

    const handleSaveKitMapping = () => saveMappingWithProgress({
        type: 'kit',
        config: kitConfig,
        mapping: kitMapping,
        save: SettingsModel.saveKitMapping,
        clearCache: () => KitModel.clearHistoryCache(),
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
