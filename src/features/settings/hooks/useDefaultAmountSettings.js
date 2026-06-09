import { useState } from 'react';
import { SettingsModel } from '../SettingsModel';

const BASE_KIT_NAMES = ['암모니아성질소(NH3-N)', '질산성질소(NO3-N)', '인산염인(PO4-P)', '알칼리도(ALK)'];

function buildDefaultAmountItems(checkedList, rows) {
    const byAmount = new Map();
    for (const row of rows || []) {
        const key = String(row.item_name ?? row.itemName ?? '').trim();
        if (!key) continue;
        const raw = row.default_amount ?? row.defaultAmount ?? 0;
        const amt = Number(raw);
        byAmount.set(key, Number.isFinite(amt) ? amt : 0);
    }

    return checkedList.map((item) => {
        const key = String(item.name ?? '').trim();
        return {
            name: item.name,
            defaultAmount: byAmount.get(key) ?? 0,
        };
    });
}

export const useDefaultAmountSettings = ({ medicineItems, showAlert } = {}) => {
    const [showDefaultAmountModal, setShowDefaultAmountModal] = useState(false);
    const [defaultAmountItems, setDefaultAmountItems] = useState([]);
    const [isSavingDefaultAmounts, setIsSavingDefaultAmounts] = useState(false);

    const [showKitDefaultModal, setShowKitDefaultModal] = useState(false);
    const [kitDefaultItems, setKitDefaultItems] = useState([]);
    const [isSavingKitDefaults, setIsSavingKitDefaults] = useState(false);

    const handleOpenDefaultAmountModal = async () => {
        const checkedList = (medicineItems || []).filter((item) => item.checked);
        let rows = [];
        try {
            const res = await SettingsModel.getMedicineDefaults();
            if (res.success && Array.isArray(res.items)) {
                rows = res.items;
            }
        } catch {
            // API 실패 시 체크 항목만 표시한다.
        }
        setDefaultAmountItems(buildDefaultAmountItems(checkedList, rows));
        setShowDefaultAmountModal(true);
    };

    const handleSaveDefaultAmounts = async () => {
        setIsSavingDefaultAmounts(true);
        try {
            const payload = defaultAmountItems.map((item) => ({
                name: item.name,
                defaultAmount: item.defaultAmount,
            }));
            const response = await SettingsModel.saveMedicineDefaults(payload);
            if (!response?.success) throw new Error(response?.message || '저장 실패');
            const updated = response.updatedCount ?? payload.length;
            const msg = response.warning
                ? `약품 기본 입고량이 저장되었습니다. 반영 ${updated}건. ${response.warning}`
                : `약품 기본 입고량이 저장되었습니다. 반영 ${updated}건.`;
            showAlert?.(msg);
            setShowDefaultAmountModal(false);
        } catch (err) {
            showAlert?.('약품 기본 입고량 저장 중 오류: ' + err.message);
        } finally {
            setIsSavingDefaultAmounts(false);
        }
    };

    const handleOpenKitDefaultModal = async () => {
        let rows = [];
        try {
            const res = await SettingsModel.getKitDefaults();
            if (res.success && Array.isArray(res.items)) {
                rows = res.items;
            }
        } catch {
            // API 실패 시 체크 항목만 표시한다.
        }
        setKitDefaultItems(buildDefaultAmountItems(BASE_KIT_NAMES.map((name) => ({ name, checked: true })), rows));
        setShowKitDefaultModal(true);
    };

    const handleSaveKitDefaults = async () => {
        setIsSavingKitDefaults(true);
        try {
            const payload = kitDefaultItems.map((item) => ({
                name: item.name,
                defaultAmount: item.defaultAmount,
            }));
            const response = await SettingsModel.saveKitDefaults(payload);
            if (!response?.success) throw new Error(response?.message || '저장 실패');
            const updated = response.updatedCount ?? payload.length;
            const msg = response.warning
                ? `키트 기본 입고량이 저장되었습니다. 반영 ${updated}건. ${response.warning}`
                : `키트 기본 입고량이 저장되었습니다. 반영 ${updated}건.`;
            showAlert?.(msg);
            setShowKitDefaultModal(false);
        } catch (err) {
            showAlert?.('키트 기본 입고량 저장 중 오류: ' + err.message);
        } finally {
            setIsSavingKitDefaults(false);
        }
    };

    return {
        showDefaultAmountModal,
        setShowDefaultAmountModal,
        defaultAmountItems,
        setDefaultAmountItems,
        isSavingDefaultAmounts,
        handleOpenDefaultAmountModal,
        handleSaveDefaultAmounts,
        showKitDefaultModal,
        setShowKitDefaultModal,
        kitDefaultItems,
        setKitDefaultItems,
        isSavingKitDefaults,
        handleOpenKitDefaultModal,
        handleSaveKitDefaults,
    };
};
