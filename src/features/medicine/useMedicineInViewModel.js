import { useState, useEffect, useCallback } from 'react';
import { MedicineInModel } from './MedicineInModel';
import { useDialog } from '../../components/common/DialogContext';
import { getApiBase } from '../../core/api/serverConfig.js';

const currentYear = new Date().getFullYear();
const currentMonth = new Date().getMonth() + 1;

const todayStr = () => {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
};

/** Electron 환경에서 실제 파일 경로, 웹 환경에서는 null 반환 */
const getFilePath = (file) => (file?.path && file.path !== '') ? file.path : null;

export function useMedicineInViewModel() {
  const { showToast } = useDialog();

  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(currentMonth);
  const [tab, setTab] = useState('medicine'); // 'medicine' | 'kit'

  // 날짜
  const [medicineDate, setMedicineDate] = useState(todayStr());
  const [kitDate, setKitDate] = useState(todayStr());

  // 로딩 상태
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // 데이터
  const [siteName, setSiteName] = useState('');
  const [medicineItems, setMedicineItems] = useState([]); // [{name, purchase, photoFile, previewUrl}]
  const [kitItems, setKitItems] = useState([]);            // [{name, purchase, photoFile, previewUrl}]
  const [tradePhotoFile, setTradePhotoFile] = useState(null);
  const [tradePreviewUrl, setTradePreviewUrl] = useState(null);

  // 해당 월 저장 데이터 로드 (월 변경 시 항상 DB 데이터로 초기화, 사진은 재선택 필요)
  const loadDefaults = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await MedicineInModel.fetchDefaults(year, month);
      if (!result?.success) throw new Error(result?.error || '데이터 로드 실패');

      setSiteName(result.siteName || '');

      const apiBase = getApiBase();
      const toAbsUrl = (url) => (url ? `${apiBase}${url}` : null);

      // 당월 저장량이 있으면 표시, 없으면 전달 기본값, 없으면 기본 입고량 설정값
      setMedicineItems(
        (result.medicines || []).map(m => ({
          name: m.name,
          purchase: m.currPurchase != null ? m.currPurchase : (m.prevPurchase || m.defaultAmount || 0),
          photoFile: null,
          previewUrl: toAbsUrl(m.photoUrl),
        }))
      );

      setKitItems(
        (result.kits || []).map(k => ({
          name: k.name,
          purchase: k.currPurchase != null ? k.currPurchase : (k.prevPurchase || k.defaultAmount || 0),
          photoFile: null,
          previewUrl: toAbsUrl(k.photoUrl),
        }))
      );

      // 거래명세서 사진도 자동 복원 (사진 선택 안했으면 서버 URL 사용)
      setTradePhotoFile(null);
      setTradePreviewUrl(toAbsUrl(result.tradePhotoUrl));
    } catch (err) {
      showToast(err.message || '데이터를 불러오지 못했습니다.', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [year, month, showToast]);

  useEffect(() => { loadDefaults(); }, [loadDefaults]);

  // 약품 입력값 변경
  const updateMedicinePurchase = useCallback((name, value) => {
    setMedicineItems(prev => prev.map(i => i.name === name ? { ...i, purchase: value } : i));
  }, []);

  // 약품 사진 선택
  const updateMedicinePhoto = useCallback((name, file) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setMedicineItems(prev => prev.map(i =>
      i.name === name ? { ...i, photoFile: file, previewUrl: url } : i
    ));
  }, []);

  // 키트 입력값 변경
  const updateKitPurchase = useCallback((name, value) => {
    setKitItems(prev => prev.map(i => i.name === name ? { ...i, purchase: value } : i));
  }, []);

  // 키트 사진 선택
  const updateKitPhoto = useCallback((name, file) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setKitItems(prev => prev.map(i =>
      i.name === name ? { ...i, photoFile: file, previewUrl: url } : i
    ));
  }, []);

  // 거래명세서 사진
  const updateTradePhoto = useCallback((file) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setTradePhotoFile(file);
    setTradePreviewUrl(url);
  }, []);

  // 저장 (현재 탭의 데이터만 DB에 저장, 전체 0이면 건너뜀)
  const handleSave = useCallback(async () => {
    const targetItems = tab === 'medicine' ? medicineItems : kitItems;

    // 전체 0이면 저장 의미 없음
    const allZero = targetItems.every(i => Number(i.purchase) === 0);
    if (allZero) {
      showToast('입고량이 입력된 항목이 없습니다.', 'error');
      return;
    }

    setIsSaving(true);
    try {
      const date = tab === 'medicine' ? medicineDate : kitDate;

      // 사진 저장: Electron이면 file.path, 웹이면 FormData 업로드
      const photoPathsByName = {};
      const uploadTargets = [];

      if (tab === 'medicine') {
        medicineItems.forEach(item => {
          if (!item.photoFile) return;
          const fp = item.photoFile.path || null;
          if (fp) { photoPathsByName[item.name] = fp; }
          else { uploadTargets.push({ name: item.name, file: item.photoFile }); }
        });
        if (tradePhotoFile) {
          const fp = tradePhotoFile.path || null;
          if (fp) { photoPathsByName['거래명세서'] = fp; }
          else { uploadTargets.push({ name: '거래명세서', file: tradePhotoFile }); }
        }
      } else {
        kitItems.forEach(item => {
          if (!item.photoFile) return;
          const fp = item.photoFile.path || null;
          if (fp) { photoPathsByName[item.name] = fp; }
          else { uploadTargets.push({ name: item.name, file: item.photoFile }); }
        });
      }

      // 웹 모드: 파일 직접 업로드
      for (const { name, file } of uploadTargets) {
        const res = await MedicineInModel.uploadPhoto(date, name, file);
        if (!res?.success) console.warn(`[사진 업로드 실패] ${name}:`, res?.error);
      }

      const items = targetItems.map(i => ({ name: i.name, purchase: Number(i.purchase) || 0 }));
      const payload = {
        tab, date, items,
        ...(Object.keys(photoPathsByName).length > 0 && { photoPaths: photoPathsByName }),
      };
      const result = await MedicineInModel.saveItems(payload);
      if (!result?.success) throw new Error(result?.error || '저장 실패');
      showToast(tab === 'medicine' ? '약품 구매량이 저장되었습니다.' : '키트 구매량이 저장되었습니다.');
    } catch (err) {
      showToast(err.message || '저장에 실패했습니다.', 'error');
    } finally {
      setIsSaving(false);
    }
  }, [tab, medicineItems, kitItems, medicineDate, kitDate, tradePhotoFile, showToast]);

  // 생성하기: 양쪽 모두 저장 + HWPX 생성
  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      // 1. 약품 구매량 저장
      const medItems = medicineItems.map(i => ({ name: i.name, purchase: Number(i.purchase) || 0 }));
      await MedicineInModel.saveItems({ tab: 'medicine', date: medicineDate, items: medItems });

      // 2. 키트 구매량 저장
      const kItems = kitItems.map(i => ({ name: i.name, purchase: Number(i.purchase) || 0 }));
      await MedicineInModel.saveItems({ tab: 'kit', date: kitDate, items: kItems });

      // 3. 사진 경로 수집 (Electron: file.path 사용)
      const photoPaths = {};
      const BASE_MED_NAMES = ['포도당', '중탄산나트륨', '팩(PAC)'];
      const extraIdx = [];
      medicineItems.forEach((item, i) => {
        if (BASE_MED_NAMES.includes(item.name)) {
          const pos = BASE_MED_NAMES.indexOf(item.name);
          const key = `{{약${pos + 1}사진}}`;
          const fp = getFilePath(item.photoFile);
          if (fp) photoPaths[key] = fp;
        } else {
          extraIdx.push(i);
        }
      });
      // 추가 약품 사진
      const extraMeds = medicineItems.filter(i => !BASE_MED_NAMES.includes(i.name));
      extraMeds.forEach((item, idx) => {
        if (idx < 2) {
          const key = `{{추${idx + 1}사진}}`;
          const fp = getFilePath(item.photoFile);
          if (fp) photoPaths[key] = fp;
        }
      });
      // 거래명세서 사진
      const tradeFp = getFilePath(tradePhotoFile);
      if (tradeFp) photoPaths['{{거래사진}}'] = tradeFp;

      // 키트 사진
      kitItems.forEach((item, idx) => {
        if (idx < 2) {
          const key = `{{키${idx + 1}사진}}`;
          const fp = getFilePath(item.photoFile);
          if (fp) photoPaths[key] = fp;
        }
      });

      // 4. HWPX 생성
      const result = await MedicineInModel.exportDoc({
        year,
        month,
        medicineDate,
        kitDate,
        medicineItems: medItems,
        kitItems: kItems,
        photoPaths: Object.keys(photoPaths).length > 0 ? photoPaths : undefined,
      });

      if (!result?.success) throw new Error(result?.userMessage || result?.error || '생성 실패');
      showToast('약품입고일지가 생성되었습니다.');
    } catch (err) {
      showToast(err.message || '약품입고일지 생성에 실패했습니다.', 'error');
    } finally {
      setIsExporting(false);
    }
  }, [year, month, medicineDate, kitDate, medicineItems, kitItems, tradePhotoFile, showToast]);

  const yearOptions = Array.from({ length: 4 }, (_, i) => currentYear - 2 + i);
  const monthOptions = Array.from({ length: 12 }, (_, i) => i + 1);

  return {
    year, setYear,
    month, setMonth,
    tab, setTab,
    medicineDate, setMedicineDate,
    kitDate, setKitDate,
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
