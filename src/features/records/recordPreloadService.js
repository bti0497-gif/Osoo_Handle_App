import { FlowModel } from '../flow/FlowModel';
import { MedicineModel } from '../medicine/MedicineModel';
import { WaterQualityModel } from '../water/WaterQualityModel';
import { KitModel } from '../kit/KitModel';
import { SettingsModel } from '../settings/SettingsModel';
import { OperationStatusModel } from '../operation/OperationStatusModel';
import { CertificateModel } from '../certificate/CertificateModel';

const PRELOAD_TASKS = [
    { key: 'settings', label: '설정 데이터', load: (options) => SettingsModel.getSettings(options) },
    { key: 'flow', label: '유량 데이터', load: (options) => FlowModel.fetchHistory(options) },
    { key: 'medicine', label: '약품 데이터', load: (options) => MedicineModel.fetchHistory(options) },
    { key: 'water', label: '수질분석 데이터', load: (options) => WaterQualityModel.fetchHistory(options) },
    { key: 'kit', label: '키트 데이터', load: (options) => KitModel.fetchHistory(options) },
    { key: 'operationStatus', label: '운전상태 데이터', load: (options) => OperationStatusModel.fetchHistory(options) },
];

export async function preloadRecordGridData({ onProgress, force = false, concurrency = 2 } = {}) {
    const results = {};
    const total = PRELOAD_TASKS.length;

    // 저사양 PC에서 한꺼번에 여섯 개의 큰 그리드를 읽으면 렌더링과 SQLite가
    // 함께 밀린다. 두 개씩만 예열해 메뉴 진입은 빠르게 하고, 서버/DB 부하는 제한한다.
    const workerCount = Math.max(1, Math.min(Number(concurrency) || 2, total));
    let nextIndex = 0;
    let completed = 0;

    const runWorker = async () => {
        while (nextIndex < total) {
            const index = nextIndex;
            nextIndex += 1;
            const task = PRELOAD_TASKS[index];
            onProgress?.({
                percent: Math.round((completed / total) * 100),
                label: `${task.label} 로드 중...`,
            });

            try {
                results[task.key] = await task.load({ force });
            } catch (err) {
                results[task.key] = { success: false, error: err.message };
                console.warn(`[record-preload] ${task.key} failed:`, err);
            }

            completed += 1;
            onProgress?.({
                percent: Math.round((completed / total) * 100),
                label: `${task.label} 로드 완료`,
            });
        }
    };

    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

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
