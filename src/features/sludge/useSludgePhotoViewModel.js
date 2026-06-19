import { useState, useEffect, useCallback } from 'react';
import { SludgePhotoModel } from './SludgePhotoModel';
import { useDialog } from '../../components/common/DialogContext';

const currentYear = new Date().getFullYear();
const currentMonth = new Date().getMonth() + 1;

const todayStr = (() => {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${dd}`;
})();

function makeEmptyEntry(date) {
  return {
    date: date || '',
    sludge_amount: '',
    sludge_photo_taken_at: null,
    sludgePhotoFile: null,
    sludgePhotoUrl: null,
    certPhotoFile: null,
    certPhotoUrl: null,
    savedAt: null,
    isSaved: false,
  };
}

function getFilePath(file) {
  return file?.path && file.path !== '' ? file.path : null;
}

function itemToEntry(item) {
  return {
    date: item.date,
    sludge_amount: item.sludge_amount != null ? String(item.sludge_amount) : '',
    sludge_photo_taken_at: item.sludge_photo_taken_at || null,
    sludgePhotoFile: null,
    sludgePhotoUrl: item.sludge_photo_url || null,
    certPhotoFile: null,
    certPhotoUrl: item.certificate_photo_url || null,
    savedAt: item.last_modified || item.created_at || null,
    isSaved: true,
  };
}

export function useSludgePhotoViewModel() {
  const { showToast, showConfirm } = useDialog();
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(currentMonth);
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [editEntry, setEditEntry] = useState(makeEmptyEntry(todayStr));
  const [savedItems, setSavedItems] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isLedgerExporting, setIsLedgerExporting] = useState(false);

  const activeDates = new Set(savedItems.map((item) => item.date));
  const exportDates = new Set(
    savedItems
      .filter((item) => item?.sludge_amount != null && item.sludge_amount !== '')
      .map((item) => item.date)
  );

  useEffect(() => {
    const found = savedItems.find((item) => item.date === selectedDate);
    setEditEntry(found ? itemToEntry(found) : makeEmptyEntry(selectedDate));
  }, [selectedDate, savedItems]);

  const checkRemotePhotoRestore = useCallback(async (items) => {
    for (const item of items) {
      const types = [
        !item.sludge_photo_url ? 'sludge' : '',
        !item.certificate_photo_url ? 'certificate' : '',
      ].filter(Boolean);
      if (!item.date || types.length === 0) continue;
      const check = await SludgePhotoModel.checkRemotePhotos({ date: item.date, types });
      if (!check?.success || !check.count) continue;
      const ok = await showConfirm?.('사진이 서버에 있습니다. 내려받을까요?');
      if (!ok) return false;
      const restored = await SludgePhotoModel.restoreRemotePhotos({
        date: item.date,
        types: check.items.map((row) => row.type),
      });
      if (restored?.success && restored.count > 0) {
        showToast(`${restored.count}개 사진을 내려받았습니다.`, 'success');
        return true;
      }
    }
    return false;
  }, [showConfirm, showToast]);

  const loadMonth = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await SludgePhotoModel.fetchByMonth(year, month);
      if (!result?.success) throw new Error(result?.error || '데이터 로드 실패');
      const items = result.items || [];
      setSavedItems(items);
      const restored = await checkRemotePhotoRestore(items);
      if (restored) {
        const refreshed = await SludgePhotoModel.fetchByMonth(year, month);
        if (refreshed?.success) setSavedItems(refreshed.items || []);
      }
    } catch (err) {
      showToast(err.message || '데이터를 불러오지 못했습니다.', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [year, month, showToast, checkRemotePhotoRestore]);

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

  const handleRowClick = useCallback((date) => {
    setSelectedDate(date);
  }, []);

  const handleAmountChange = useCallback((value) => {
    setEditEntry((prev) => ({ ...prev, sludge_amount: value, isSaved: false }));
  }, []);

  const handleSludgePhoto = useCallback((file) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setEditEntry((prev) => ({ ...prev, sludgePhotoFile: file, sludgePhotoUrl: url, isSaved: false }));
  }, []);

  const handleCertPhoto = useCallback((file) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setEditEntry((prev) => ({ ...prev, certPhotoFile: file, certPhotoUrl: url, isSaved: false }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!editEntry.date) {
      showToast('날짜를 선택해 주세요.', 'warning');
      return;
    }
    const hasData = editEntry.sludge_amount !== '' || editEntry.sludgePhotoFile != null || editEntry.certPhotoFile != null;
    if (!hasData) {
      showToast('저장할 내용이 없습니다.', 'info');
      return;
    }
    setIsSaving(true);
    try {
      const payload = {
        date: editEntry.date,
        sludge_amount: editEntry.sludge_amount !== '' ? editEntry.sludge_amount : null,
        sludge_photo_path: getFilePath(editEntry.sludgePhotoFile),
        certificate_photo_path: getFilePath(editEntry.certPhotoFile),
        note: null,
      };
      if (!payload.sludge_photo_path && editEntry.sludgePhotoFile) {
        const r = await SludgePhotoModel.uploadPhoto(editEntry.date, 'sludge', editEntry.sludgePhotoFile);
        if (!r?.success) throw new Error(r?.error || '반출사진 업로드 실패');
      }
      if (!payload.certificate_photo_path && editEntry.certPhotoFile) {
        const r = await SludgePhotoModel.uploadPhoto(editEntry.date, 'certificate', editEntry.certPhotoFile);
        if (!r?.success) throw new Error(r?.error || '청소필증 업로드 실패');
      }
      const result = await SludgePhotoModel.save(payload);
      if (!result?.success) throw new Error(result?.error || '저장 실패');
      showToast('저장되었습니다.', 'success');
      await loadMonth();
    } catch (err) {
      showToast(err.message || '저장 실패', 'error');
    } finally {
      setIsSaving(false);
    }
  }, [editEntry, showToast, loadMonth]);

  const handleDelete = useCallback(async () => {
    if (!editEntry.isSaved || !editEntry.date) return;
    const ok = await showConfirm(`${editEntry.date} 반출 기록을 삭제하시겠습니까?`);
    if (!ok) return;
    try {
      const deletedDate = editEntry.date;
      const result = await SludgePhotoModel.deleteByDate(deletedDate);
      if (!result?.success) throw new Error(result?.error || '삭제 실패');
      setSavedItems((items) => items.filter((item) => item.date !== deletedDate));
      setEditEntry(makeEmptyEntry(deletedDate));
      showToast('삭제되었습니다.', 'success');
      await loadMonth();
    } catch (err) {
      showToast(err.message || '삭제 실패', 'error');
    }
  }, [editEntry, showConfirm, showToast, loadMonth]);

  const handleExport = useCallback(async () => {
    if (savedItems.length === 0) {
      showToast('저장된 반출 기록이 없습니다.', 'warning');
      return;
    }
    setIsExporting(true);
    try {
      const result = await SludgePhotoModel.export(year, month);
      if (!result?.success) throw new Error(result?.error || '사진대지 출력 실패');
      showToast(`사진대지 ${result.itemCount || 0}건을 열었습니다.`, 'success');
    } catch (err) {
      showToast(err.message || '사진대지 출력 실패', 'error');
    } finally {
      setIsExporting(false);
    }
  }, [year, month, savedItems, showToast]);

  const handleLedgerExport = useCallback(async () => {
    if (savedItems.length === 0) {
      showToast('저장된 반출 기록이 없습니다.', 'warning');
      return;
    }
    setIsLedgerExporting(true);
    try {
      const result = await SludgePhotoModel.exportLedger(year, month);
      if (!result?.success) throw new Error(result?.error || '반출관리대장 출력 실패');
      showToast('반출관리대장을 열었습니다.', 'success');
    } catch (err) {
      showToast(err.message || '반출관리대장 출력 실패', 'error');
    } finally {
      setIsLedgerExporting(false);
    }
  }, [year, month, savedItems, showToast]);

  const hasChanges = !editEntry.isSaved && (
    editEntry.sludge_amount !== '' ||
    editEntry.sludgePhotoFile != null ||
    editEntry.certPhotoFile != null
  );

  return {
    year,
    month,
    selectedDate,
    editEntry,
    savedItems,
    activeDates,
    exportDates,
    isLoading,
    isSaving,
    isExporting,
    isLedgerExporting,
    hasChanges,
    handleCalendarMonthChange,
    handleCalendarDayClick,
    handleRowClick,
    handleAmountChange,
    handleSludgePhoto,
    handleCertPhoto,
    handleSave,
    handleDelete,
    handleExport,
    handleLedgerExport,
  };
}
