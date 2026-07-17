import { useState, useCallback } from 'react';

const waitForNextPaint = () => new Promise((resolve) => {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
        setTimeout(resolve, 0);
        return;
    }
    window.requestAnimationFrame(() => {
        window.requestAnimationFrame(resolve);
    });
});

const getTaskProgressUnits = (task) => {
    const detailedTotal = Number(task.totalUnits);
    if (Number.isFinite(detailedTotal) && detailedTotal > 0) {
        const total = detailedTotal;
        const completed = task.status === 'success'
            ? total
            : Math.min(total, Math.max(0, Number(task.completedUnits) || 0));
        const errors = task.status === 'error'
            ? Math.max(1, Number(task.errorUnits) || 0)
            : Math.max(0, Number(task.errorUnits) || 0);
        return { completed, errors, total };
    }

    return {
        completed: task.status === 'success' ? 1 : 0,
        errors: task.status === 'error' ? 1 : 0,
        total: 1,
    };
};

/**
 * 일괄 작업(Batch)의 진행 상태를 관리하는 커스텀 훅
 * 
 * @returns {Object} 
 *  - tasks: 현재 작업 목록 [{ id, title, status: 'pending'|'processing'|'success'|'error', message: '' }]
 *  - progress: 전체 진행률 (0~100)
 *  - isProcessing: 일부분이라도 작업 중인지 여부
 *  - isFinished: 모든 작업이 끝났는지 여부
 *  - executeBatch: 작업을 실행하는 함수 (배열, 개별 처리 콜백)
 *  - resetBatch: 상태 초기화
 */
export const useBatchProcess = () => {
    const [tasks, setTasks] = useState([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isFinished, setIsFinished] = useState(false);

    // 전체 진행률 계산 (완료 또는 에러인 항목 비율)
    const progressUnits = tasks.reduce((summary, task) => {
        const units = getTaskProgressUnits(task);
        return {
            completed: summary.completed + units.completed,
            errors: summary.errors + units.errors,
            total: summary.total + units.total,
        };
    }, { completed: 0, errors: 0, total: 0 });
    const progress = progressUnits.total === 0
        ? 0
        : Math.min(100, Math.round(((progressUnits.completed + progressUnits.errors) / progressUnits.total) * 100));

    const resetBatch = useCallback(() => {
        setTasks([]);
        setIsProcessing(false);
        setIsFinished(false);
    }, []);

    const updateTaskStatus = useCallback((taskId, status, message = '', details = {}) => {
        setTasks(prev => prev.map(task => 
            task.id === taskId 
                ? { ...task, ...details, status, message: message || task.message }
                : task
        ));
    }, []);

    /**
     * 일괄 작업을 실행합니다.
     * @param {Array} items 처리할 데이터 배열
     * @param {Function} getTaskInfo item을 받아 { id, title }을 반환하는 함수 (UI 표시용)
     * @param {Function} processItemAsync (item, updateTask) => Promise 개별 항목을 처리하는 비동기 함수
     * @param {Object} options 중단 시점 제어 등 (예: stopOnError)
     */
    const executeBatch = useCallback(async (items, getTaskInfo, processItemAsync, options = {}) => {
        const { stopOnError = false } = options;
        
        // 초기 작업 목록 설정
        const initialTasks = items.map(item => {
            const info = getTaskInfo(item);
            return {
                id: info.id,
                title: info.title,
                status: 'pending', // 'pending', 'processing', 'success', 'error'
                message: ''
            };
        });
        
        setTasks(initialTasks);
        setIsProcessing(true);
        setIsFinished(false);

        // 진행창이 화면에 먼저 그려진 뒤 실제 네트워크/파일 작업을 시작한다.
        // QnTECH처럼 응답이 오래 걸리는 작업에서 "눌렀는데 아무 반응 없음"으로 보이지 않게 한다.
        await waitForNextPaint();

        let hasError = false;

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const taskId = initialTasks[i].id;

            // 처리 시작
            updateTaskStatus(taskId, 'processing', '처리 중...');
            await waitForNextPaint();

            try {
                // 개별 항목 처리 대기
                await processItemAsync(item, (msg, details = {}) => updateTaskStatus(taskId, 'processing', msg, details));
                // 성공
                updateTaskStatus(taskId, 'success', '완료');
            } catch (error) {
                // 에러
                hasError = true;
                updateTaskStatus(taskId, 'error', error.message || '오류 발생');
                
                if (stopOnError) {
                    break; 
                }
            }
        }

        setIsProcessing(false);
        setIsFinished(true);
        return !hasError; // 전체 성공 여부
    }, [updateTaskStatus]);

    return {
        tasks,
        progress,
        isProcessing,
        isFinished,
        executeBatch,
        resetBatch
    };
};
