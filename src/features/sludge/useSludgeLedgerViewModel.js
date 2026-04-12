import { useState, useEffect, useCallback, useMemo } from 'react';
import { SludgePhotoModel } from './SludgePhotoModel';
import { useDialog } from '../../components/common/DialogContext';

const currentYear = new Date().getFullYear();
const currentMonth = new Date().getMonth() + 1;

function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function useSludgeLedgerViewModel() {
  const { showToast } = useDialog();

  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(currentMonth);
  const [selectedDate, setSelectedDate] = useState(toDateStr(new Date()));

  const [items, setItems] = useState([]);
  const [siteName, setSiteName] = useState('');
  const [companyName, setCompanyName] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const loadMonth = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await SludgePhotoModel.fetchLedgerByMonth(year, month);
      if (!result?.success) throw new Error(result?.error || '데이터 로드 실패');

      setItems(Array.isArray(result.items) ? result.items : []);
      setSiteName(result.siteName || '');
      setCompanyName(result.companyName || '');
    } catch (err) {
      showToast(err.message || '데이터를 불러오지 못했습니다.', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [year, month, showToast]);

  useEffect(() => {
    loadMonth();
  }, [loadMonth]);

  const handleCalendarMonthChange = useCallback(({ activeStartDate }) => {
    if (!activeStartDate) return;
    setYear(activeStartDate.getFullYear());
    setMonth(activeStartDate.getMonth() + 1);
  }, []);

  const handleCalendarDayClick = useCallback((dateStr) => {
    setSelectedDate(dateStr);
  }, []);

  const activeDates = useMemo(() => new Set(items.map((it) => it.date)), [items]);

  const summary = useMemo(() => {
    const recordCount = items.filter((item) => item?.sludge_amount != null && item?.sludge_amount !== '').length;
    const totalAmount = items.reduce((sum, item) => {
      const n = Number(item?.sludge_amount);
      return Number.isFinite(n) ? sum + n : sum;
    }, 0);
    return { recordCount, totalAmount };
  }, [items]);

  const handleExport = useCallback(async () => {
    if (items.length === 0) {
      showToast('해당 월에 반출 데이터가 없습니다.', 'warning');
      return;
    }
    setIsExporting(true);
    try {
      const result = await SludgePhotoModel.exportLedger(year, month);
      if (!result?.success) throw new Error(result?.error || '반출관리대장 출력 실패');
      showToast('반출관리대장을 열었습니다.', 'success');
    } catch (err) {
      showToast(err.message || '반출관리대장 출력 실패', 'error');
    } finally {
      setIsExporting(false);
    }
  }, [items.length, showToast, year, month]);

  return {
    year,
    month,
    selectedDate,
    siteName,
    companyName,
    items,
    activeDates,
    summary,
    isLoading,
    isExporting,
    handleCalendarMonthChange,
    handleCalendarDayClick,
    handleExport,
  };
}
