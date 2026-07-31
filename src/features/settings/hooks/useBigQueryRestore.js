import { useMemo, useState } from 'react';
import { SettingsModel } from '../SettingsModel';

const TABLES = [
    { id: 'flow_readings', label: '유량 및 슬러지 반출' },
    { id: 'medicine_logs', label: '약품 입고·사용량' },
    { id: 'kit_logs', label: '키트 입고·사용량' },
    { id: 'qntech_water_quality', label: '수질분석' },
    { id: 'operation_status_logs', label: 'pH·DO·SVI 운전상태' },
];

function todayText() {
    return new Date().toLocaleDateString('sv-SE');
}

export function useBigQueryRestore({ showAlert, showConfirm } = {}) {
    const today = todayText();
    const [startDate, setStartDate] = useState(`${today.slice(0, 8)}01`);
    const [endDate, setEndDate] = useState(today);
    const [selectedTables, setSelectedTables] = useState(TABLES.map((table) => table.id));
    const [preview, setPreview] = useState(null);
    const [isInspecting, setIsInspecting] = useState(false);
    const [isRestoring, setIsRestoring] = useState(false);

    const totalCount = useMemo(
        () => Object.values(preview?.result || {}).reduce(
            (sum, item) => sum + Number(item?.count || 0),
            0
        ),
        [preview]
    );

    const toggleTable = (tableId) => {
        setPreview(null);
        setSelectedTables((current) => (
            current.includes(tableId)
                ? current.filter((id) => id !== tableId)
                : [...current, tableId]
        ));
    };

    const makePayload = () => ({ startDate, endDate, tables: selectedTables });

    const inspect = async () => {
        setIsInspecting(true);
        try {
            const result = await SettingsModel.inspectBigQueryRestore(makePayload());
            setPreview(result);
        } catch (error) {
            setPreview(null);
            await showAlert?.(error?.message || 'BigQuery 자료를 조회하지 못했습니다.');
        } finally {
            setIsInspecting(false);
        }
    };

    const restore = async () => {
        if (!preview) {
            await showAlert?.('먼저 복원할 자료를 조회해 주세요.');
            return;
        }
        const confirmed = await showConfirm?.(
            `${preview.siteName || '현재 현장'}의 ${startDate} ~ ${endDate} 자료 ${totalCount}건을 로컬 DB에 복원합니다.\n`
            + '실행 전에 현재 DB가 자동 백업되며, 미동기화 로컬 자료는 덮어쓰지 않습니다.'
        );
        if (!confirmed) return;

        setIsRestoring(true);
        try {
            const result = await SettingsModel.applyBigQueryRestore({
                ...makePayload(),
                confirmation: 'BIGQUERY_RESTORE',
            });
            setPreview(result);
            await showAlert?.(`BigQuery 자료 복원이 완료됐습니다.\nDB 백업: ${result.backupPath}`);
        } catch (error) {
            await showAlert?.(error?.message || 'BigQuery 자료 복원에 실패했습니다.');
        } finally {
            setIsRestoring(false);
        }
    };

    return {
        tables: TABLES,
        startDate,
        setStartDate,
        endDate,
        setEndDate,
        selectedTables,
        toggleTable,
        preview,
        totalCount,
        isInspecting,
        isRestoring,
        inspect,
        restore,
    };
}
