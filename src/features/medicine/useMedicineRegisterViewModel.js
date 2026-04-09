import { useState, useEffect, useCallback } from 'react';
import { MedicineRegisterModel } from './MedicineRegisterModel';
import { useDialog } from '../../components/common/DialogProvider';

const currentYear = new Date().getFullYear();
const currentMonth = new Date().getMonth() + 1;

export function useMedicineRegisterViewModel() {
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(currentMonth);

  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState(null);
  const [exportError, setExportError] = useState(null);
  const { showToast } = useDialog();

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await MedicineRegisterModel.fetchMonthlyData(year, month);
      setData(result);
    } catch (err) {
      setError(err.message || '데이터를 불러오지 못했습니다.');
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [year, month]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleExportPdf = useCallback(async () => {
    setIsExporting(true);
    setExportError(null);
    try {
      const result = await MedicineRegisterModel.exportPdf(year, month);

      if (!result?.success) {
        throw new Error(result?.userMessage || result?.error || 'HWP 생성 실패');
      }

      showToast('약품관리대장이 생성되었습니다.');
    } catch (err) {
      showToast(err.message || 'HWP 내보내기에 실패했습니다.', 'error');
    } finally {
      setIsExporting(false);
    }
  }, [year, month, showToast]);

  // 연도 선택 목록 (현재 연도 - 2 ~ 현재 연도 + 1)
  const yearOptions = Array.from({ length: 4 }, (_, i) => currentYear - 2 + i);
  const monthOptions = Array.from({ length: 12 }, (_, i) => i + 1);

  const interlockEnabled = data?.interlock?.enabled ?? false;
  const interlockReason = data?.interlock?.reason ?? '';

  return {
    year, setYear,
    month, setMonth,
    yearOptions,
    monthOptions,
    data,
    isLoading,
    isExporting,
    error,
    exportError,
    setExportError,
    interlockEnabled,
    interlockReason,
    handleExportPdf,
    loadData,
  };
}
