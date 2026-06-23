import { useState, useEffect, useCallback, useMemo } from 'react';
import { MedicineInModel } from './MedicineInModel';
import { useDialog } from '../../components/common/DialogContext';
import { getApiBase } from '../../core/api/serverConfig.js';

const currentYear = new Date().getFullYear();
const currentMonth = new Date().getMonth() + 1;
const BASE_MED_NAMES = ['중탄산나트륨', '포도당', '팩(PAC)'];

const todayStr = () => {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
};

const toMonthStart = (year, month) => `${year}-${String(month).padStart(2, '0')}-01`;

const getFilePath = (file) => (file?.path && file.path !== '') ? file.path : null;

export function useMedicineInViewModel(currentUser) {
  const { showToast, showConfirm } = useDialog();

  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(currentMonth);
  const [tab, setTab] = useState('medicine');
  const [medicineDate, setMedicineDate] = useState(todayStr());
  const [kitDate, setKitDate] = useState(todayStr());
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [siteName, setSiteName] = useState('');
  const [medicineItems, setMedicineItems] = useState([]);
  const [kitItems, setKitItems] = useState([]);
  const [tradePhotoFile, setTradePhotoFile] = useState(null);
  const [tradePreviewUrl, setTradePreviewUrl] = useState(null);

  const requestContext = useMemo(() => ({
    siteId: currentUser?.site_id || '',
    siteName: currentUser?.site_name1 || '',
    author: currentUser?.name || '',
  }), [currentUser?.site_id, currentUser?.site_name1, currentUser?.name]);

  const loadDefaults = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await MedicineInModel.fetchDefaults(year, month, requestContext);
      if (!result?.success) throw new Error(result?.error || '데이터 로드 실패');

      setSiteName(result.siteName || '');

      const fallbackDate = toMonthStart(year, month);
      setMedicineDate(result.latestMedicineDate || fallbackDate);
      setKitDate(result.latestKitDate || fallbackDate);

      const apiBase = getApiBase();
      const toAbsUrl = (url) => (url ? `${apiBase}${url}` : null);

      setMedicineItems((result.medicines || []).map((item) => ({
        name: item.name,
        purchase: item.currPurchase != null ? item.currPurchase : (item.prevPurchase || item.defaultAmount || 0),
        photoFile: null,
        previewUrl: toAbsUrl(item.photoUrl),
      })));

      setKitItems((result.kits || []).map((item) => ({
        name: item.name,
        purchase: item.currPurchase != null ? item.currPurchase : (item.prevPurchase || item.defaultAmount || 0),
        photoFile: null,
        previewUrl: toAbsUrl(item.photoUrl),
      })));

      setTradePhotoFile(null);
      setTradePreviewUrl(toAbsUrl(result.tradePhotoUrl));

      const maybeRestore = async ({ targetTab, date, items }) => {
        const missingNames = items
          .filter((item) => !item.previewUrl)
          .map((item) => item.name)
          .filter(Boolean);
        if (!missingNames.length || !date) return;
        const check = await MedicineInModel.checkRemotePhotos({ date, itemNames: missingNames });
        if (!check?.success || !check.count) return;
        const confirmed = await showConfirm?.('사진이 서버에 있습니다. 내려받을까요?');
        if (!confirmed) return;
        const restored = await MedicineInModel.restoreRemotePhotos({
          date,
          itemNames: check.items.map((item) => item.name),
          tab: targetTab,
        });
        if (restored?.success && restored.count > 0) {
          showToast(`${restored.count}개 사진을 내려받았습니다.`);
          await loadDefaults();
        }
      };

      setTimeout(() => {
        maybeRestore({
          targetTab: 'medicine',
          date: result.latestMedicineDate || fallbackDate,
          items: result.medicines || [],
        }).catch((err) => console.warn('[medicine-in] 약품 사진 복구 확인 실패:', err.message));
        maybeRestore({
          targetTab: 'kit',
          date: result.latestKitDate || fallbackDate,
          items: result.kits || [],
        }).catch((err) => console.warn('[medicine-in] 키트 사진 복구 확인 실패:', err.message));
      }, 0);
    } catch (err) {
      showToast(err.message || '데이터를 불러오지 못했습니다.', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [year, month, showToast, showConfirm, requestContext]);

  useEffect(() => {
    loadDefaults();
  }, [loadDefaults]);

  const updateMedicinePurchase = useCallback((name, value) => {
    setMedicineItems((prev) => prev.map((item) => (
      item.name === name ? { ...item, purchase: value } : item
    )));
  }, []);

  const updateMedicinePhoto = useCallback((name, file) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setMedicineItems((prev) => prev.map((item) => (
      item.name === name ? { ...item, photoFile: file, previewUrl: url } : item
    )));
  }, []);

  const updateKitPurchase = useCallback((name, value) => {
    setKitItems((prev) => prev.map((item) => (
      item.name === name ? { ...item, purchase: value } : item
    )));
  }, []);

  const updateKitPhoto = useCallback((name, file) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setKitItems((prev) => prev.map((item) => (
      item.name === name ? { ...item, photoFile: file, previewUrl: url } : item
    )));
  }, []);

  const updateTradePhoto = useCallback((file) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setTradePhotoFile(file);
    setTradePreviewUrl(url);
  }, []);

  const uploadBrowserOnlyPhotos = async (date, entries = []) => {
    let driveUploadFailureCount = 0;
    for (const { name, file } of entries) {
      const res = await MedicineInModel.uploadPhoto(date, name, file);
      if (!res?.success) {
        console.warn(`[medicine-in] 사진 업로드 실패 ${name}:`, res?.error);
      } else if (res.driveUploaded === false) {
        driveUploadFailureCount += 1;
      }
    }
    return driveUploadFailureCount;
  };

  const collectPhotoPathsByName = (targetTab) => {
    const photoPathsByName = {};
    const uploadTargets = [];
    const sourceItems = targetTab === 'medicine' ? medicineItems : kitItems;

    sourceItems.forEach((item) => {
      if (!item.photoFile) return;
      const fp = getFilePath(item.photoFile);
      if (fp) {
        photoPathsByName[item.name] = fp;
      } else {
        uploadTargets.push({ name: item.name, file: item.photoFile });
      }
    });

    if (targetTab === 'medicine' && tradePhotoFile) {
      const fp = getFilePath(tradePhotoFile);
      if (fp) {
        photoPathsByName['거래명세서'] = fp;
      } else {
        uploadTargets.push({ name: '거래명세서', file: tradePhotoFile });
      }
    }

    return { photoPathsByName, uploadTargets };
  };

  const handleSave = useCallback(async () => {
    const targetItems = tab === 'medicine' ? medicineItems : kitItems;
    const allZero = targetItems.every((item) => Number(item.purchase) === 0);
    if (allZero) {
      showToast('입고량이 입력된 항목이 없습니다.', 'error');
      return;
    }

    setIsSaving(true);
    try {
      const date = tab === 'medicine' ? medicineDate : kitDate;
      const { photoPathsByName, uploadTargets } = collectPhotoPathsByName(tab);

      const browserDriveFailures = await uploadBrowserOnlyPhotos(date, uploadTargets);

      const items = targetItems.map((item) => ({ name: item.name, purchase: Number(item.purchase) || 0 }));
      const result = await MedicineInModel.saveItems({
        tab,
        date,
        items,
        ...requestContext,
        ...(Object.keys(photoPathsByName).length > 0 && { photoPaths: photoPathsByName }),
      });

      if (!result?.success) throw new Error(result?.error || '저장 실패');
      const driveFailureCount = browserDriveFailures + Number(result.driveUploadFailureCount || 0);
      const successMessage = tab === 'medicine'
        ? '약품 입고량이 저장되었습니다.'
        : '키트 입고량이 저장되었습니다.';
      showToast(
        driveFailureCount > 0
          ? `${successMessage} 로컬 사진은 저장됐지만 Drive 업로드 ${driveFailureCount}건은 실패했습니다.`
          : successMessage,
        driveFailureCount > 0 ? 'warning' : 'success'
      );
    } catch (err) {
      showToast(err.message || '저장에 실패했습니다.', 'error');
    } finally {
      setIsSaving(false);
    }
  }, [tab, medicineItems, kitItems, medicineDate, kitDate, tradePhotoFile, showToast, requestContext]);

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      const medItems = medicineItems.map((item) => ({ name: item.name, purchase: Number(item.purchase) || 0 }));
      const kitSaveItems = kitItems.map((item) => ({ name: item.name, purchase: Number(item.purchase) || 0 }));

      const medPhotos = collectPhotoPathsByName('medicine');
      const kitPhotos = collectPhotoPathsByName('kit');

      let driveUploadFailureCount = 0;
      driveUploadFailureCount += await uploadBrowserOnlyPhotos(medicineDate, medPhotos.uploadTargets);
      driveUploadFailureCount += await uploadBrowserOnlyPhotos(kitDate, kitPhotos.uploadTargets);

      const medicineSaveResult = await MedicineInModel.saveItems({
        tab: 'medicine',
        date: medicineDate,
        items: medItems,
        ...requestContext,
        ...(Object.keys(medPhotos.photoPathsByName).length > 0 && { photoPaths: medPhotos.photoPathsByName }),
      });
      const kitSaveResult = await MedicineInModel.saveItems({
        tab: 'kit',
        date: kitDate,
        items: kitSaveItems,
        ...requestContext,
        ...(Object.keys(kitPhotos.photoPathsByName).length > 0 && { photoPaths: kitPhotos.photoPathsByName }),
      });
      if (!medicineSaveResult?.success) {
        throw new Error(medicineSaveResult?.error || '약품 입고 데이터 저장 실패');
      }
      if (!kitSaveResult?.success) {
        throw new Error(kitSaveResult?.error || '키트 입고 데이터 저장 실패');
      }
      driveUploadFailureCount += Number(medicineSaveResult?.driveUploadFailureCount || 0);
      driveUploadFailureCount += Number(kitSaveResult?.driveUploadFailureCount || 0);

      const photoPaths = {};
      medicineItems.forEach((item) => {
        const fp = getFilePath(item.photoFile);
        if (!fp) return;
        const baseIndex = BASE_MED_NAMES.indexOf(item.name);
        if (baseIndex >= 0) {
          photoPaths[`{{기본${baseIndex + 1}사진}}`] = fp;
        }
      });

      medicineItems
        .filter((item) => !BASE_MED_NAMES.includes(item.name))
        .slice(0, 2)
        .forEach((item, idx) => {
          const fp = getFilePath(item.photoFile);
          if (fp) photoPaths[`{{추가${idx + 1}사진}}`] = fp;
        });

      const tradeFp = getFilePath(tradePhotoFile);
      if (tradeFp) photoPaths['{{거래사진}}'] = tradeFp;

      kitItems.slice(0, 2).forEach((item, idx) => {
        const fp = getFilePath(item.photoFile);
        if (fp) photoPaths[`{{키트${idx + 1}사진}}`] = fp;
      });

      const result = await MedicineInModel.exportExcel({
        year,
        month,
        medicineDate,
        kitDate,
        medicineItems: medItems,
        kitItems: kitSaveItems,
        ...requestContext,
        photoPaths: Object.keys(photoPaths).length > 0 ? photoPaths : undefined,
      });

      if (!result?.success) throw new Error(result?.userMessage || result?.error || '생성 실패');
      showToast(
        driveUploadFailureCount > 0
          ? `약품입고일지가 생성됐습니다. 로컬 사진은 저장됐지만 Drive 업로드 ${driveUploadFailureCount}건은 실패했습니다.`
          : '약품입고일지가 생성되었습니다.',
        driveUploadFailureCount > 0 ? 'warning' : 'success'
      );
    } catch (err) {
      showToast(err.message || '약품입고일지 생성에 실패했습니다.', 'error');
    } finally {
      setIsExporting(false);
    }
  }, [year, month, medicineDate, kitDate, medicineItems, kitItems, tradePhotoFile, showToast, requestContext]);

  const yearOptions = Array.from({ length: 4 }, (_, i) => currentYear - 2 + i);
  const monthOptions = Array.from({ length: 12 }, (_, i) => i + 1);

  return {
    year,
    setYear,
    month,
    setMonth,
    tab,
    setTab,
    medicineDate,
    setMedicineDate,
    kitDate,
    setKitDate,
    siteName,
    medicineItems,
    kitItems,
    tradePhotoFile,
    tradePreviewUrl,
    isLoading,
    isSaving,
    isExporting,
    yearOptions,
    monthOptions,
    updateMedicinePurchase,
    updateMedicinePhoto,
    updateKitPurchase,
    updateKitPhoto,
    updateTradePhoto,
    handleSave,
    handleExport,
  };
}
