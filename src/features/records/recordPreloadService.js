import { FlowModel } from '../flow/FlowModel';
import { MedicineModel } from '../medicine/MedicineModel';
import { WaterQualityModel } from '../water/WaterQualityModel';
import { KitModel } from '../kit/KitModel';
import { SettingsModel } from '../settings/SettingsModel';
import { OperationStatusModel } from '../operation/OperationStatusModel';
import { CertificateModel } from '../certificate/CertificateModel';

const PRELOAD_TASKS = [
    { key: 'settings', label: '설정 데이터', load: () => SettingsModel.getSettings() },
    { key: 'flow', label: '유량 데이터', load: () => FlowModel.fetchHistory() },
    { key: 'medicine', label: '약품 데이터', load: () => MedicineModel.fetchHistory() },
    { key: 'water', label: '수질분석 데이터', load: () => WaterQualityModel.fetchHistory() },
    { key: 'kit', label: '키트 데이터', load: () => KitModel.fetchHistory() },
    { key: 'operationStatus', label: '운전상태 데이터', load: () => OperationStatusModel.fetchHistory() },
];

export async function preloadRecordGridData({ onProgress } = {}) {
    const results = {};
    const total = PRELOAD_TASKS.length;

    for (let index = 0; index < PRELOAD_TASKS.length; index += 1) {
        const task = PRELOAD_TASKS[index];
        const percent = Math.round((index / total) * 100);
        onProgress?.({ percent, label: `${task.label} 로드 중...` });

        try {
            results[task.key] = await task.load();
        } catch (err) {
            results[task.key] = { success: false, error: err.message };
            console.warn(`[record-preload] ${task.key} failed:`, err);
        }

        onProgress?.({
            percent: Math.round(((index + 1) / total) * 100),
            label: `${task.label} 로드 완료`,
        });
    }

    return results;
}

export function clearRecordGridHistoryCache() {
    SettingsModel.clearSettingsCache?.();
    FlowModel.clearHistoryCache?.();
    MedicineModel.clearHistoryCache?.();
    WaterQualityModel.clearHistoryCache?.();
    KitModel.clearHistoryCache?.();
    OperationStatusModel.clearHistoryCache?.();
    CertificateModel.clearListCache?.();
}
