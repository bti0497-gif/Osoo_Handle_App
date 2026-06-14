import { useCallback, useEffect, useMemo, useState } from 'react';
import { getTodayKST } from '../../core/constants';
import { OperationStatusModel } from './OperationStatusModel';

const EMPTY_FORM = {
    date: getTodayKST(),
    ph: '',
    do_value: '',
    svi: '',
};

const normalizeDisplayValue = (value) => {
    if (value === null || value === undefined) return '';
    return String(value);
};

const normalizeForm = (record = {}) => ({
    date: String(record.date || getTodayKST()).slice(0, 10),
    ph: normalizeDisplayValue(record.ph),
    do_value: normalizeDisplayValue(record.do_value),
    svi: normalizeDisplayValue(record.svi),
});

const isNumericOrBlank = (value) => {
    const text = String(value ?? '').trim();
    if (!text) return true;
    return Number.isFinite(Number(text));
};

export const useOperationStatusViewModel = (_currentUser, { showToast } = {}) => {
    const [history, setHistory] = useState([]);
    const [form, setForm] = useState(EMPTY_FORM);
    const [selectedDate, setSelectedDate] = useState(getTodayKST());
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    const loadHistory = useCallback(async (options = {}) => {
        setLoading(true);
        try {
            const result = await OperationStatusModel.fetchHistory(options);
            const rows = Array.isArray(result?.history) ? result.history : [];
            setHistory(rows);

            const targetDate = options.selectedDate || selectedDate || getTodayKST();
            const target = rows.find((row) => row.date === targetDate);
            setForm(target ? normalizeForm(target) : { ...EMPTY_FORM, date: targetDate });
        } catch (err) {
            showToast?.(`운전상태 조회 실패: ${err.message}`, 'error');
        } finally {
            setLoading(false);
        }
    }, [selectedDate, showToast]);

    useEffect(() => {
        loadHistory();
    }, [loadHistory]);

    const selectedRecord = useMemo(
        () => history.find((row) => row.date === selectedDate) || null,
        [history, selectedDate]
    );

    const selectDate = useCallback((date) => {
        const normalizedDate = String(date || getTodayKST()).slice(0, 10);
        setSelectedDate(normalizedDate);
        const target = history.find((row) => row.date === normalizedDate);
        setForm(target ? normalizeForm(target) : { ...EMPTY_FORM, date: normalizedDate });
    }, [history]);

    const updateField = useCallback((field, value) => {
        setForm((prev) => ({ ...prev, [field]: value }));
    }, []);

    const save = useCallback(async () => {
        if (!form.date) {
            showToast?.('날짜가 필요합니다.', 'error');
            return false;
        }
        if (!isNumericOrBlank(form.ph) || !isNumericOrBlank(form.do_value) || !isNumericOrBlank(form.svi)) {
            showToast?.('PH, DO, SVI는 숫자만 입력할 수 있습니다.', 'error');
            return false;
        }

        setSaving(true);
        try {
            const result = await OperationStatusModel.saveRecord(form);
            if (!result?.success) throw new Error(result?.error || '저장 실패');
            showToast?.('운전상태가 저장되었습니다.');
            setSelectedDate(form.date);
            await loadHistory({ force: true, selectedDate: form.date });
            return true;
        } catch (err) {
            showToast?.(`운전상태 저장 실패: ${err.message}`, 'error');
            return false;
        } finally {
            setSaving(false);
        }
    }, [form, loadHistory, showToast]);

    return {
        history,
        form,
        selectedDate,
        selectedRecord,
        loading,
        saving,
        selectDate,
        updateField,
        save,
        refresh: () => loadHistory({ force: true, selectedDate }),
    };
};
