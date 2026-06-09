import { useCallback, useEffect, useState } from 'react';
import { SettingsModel } from '../SettingsModel';
import {
    DEFAULT_MEDICINE_ITEMS,
    DEFAULT_WATER_ITEMS,
    DEFAULT_KIT_ITEMS,
    TWO_SERIES_RECIRC_NAMES,
    cloneItems,
    createDefaultFlowItems,
    getDefaultFlowOptionBySeries,
} from '../settingsDefaults';

export const useItemSettings = ({ siteInfo, setSiteInfo, setFlowOption, showAlert } = {}) => {
    const [flowItems, setFlowItems] = useState(createDefaultFlowItems('1계열', 'A2O'));
    const [medicineItems, setMedicineItems] = useState(cloneItems(DEFAULT_MEDICINE_ITEMS));
    const [waterItems, setWaterItems] = useState(cloneItems(DEFAULT_WATER_ITEMS));
    const [kitItems, setKitItems] = useState(cloneItems(DEFAULT_KIT_ITEMS));

    const [newFlowItem, setNewFlowItem] = useState('');
    const [newMedicineItem, setNewMedicineItem] = useState('');

    useEffect(() => {
        if (String(siteInfo?.series || '').trim() !== '2계열') return;
        const method = siteInfo?.method || 'A2O';
        const desired = createDefaultFlowItems('2계열', method);
        setFlowItems((prev) => {
            const names = new Set(prev.map((item) => item.name));
            const additions = [];
            for (const name of TWO_SERIES_RECIRC_NAMES) {
                const defaultItem = desired.find((item) => item.name === name);
                if (!defaultItem || names.has(name)) continue;
                additions.push({ name: defaultItem.name, checked: defaultItem.checked });
                names.add(name);
            }
            if (additions.length === 0) return prev;
            return [...prev, ...additions];
        });
    }, [siteInfo?.series, siteInfo?.method]);

    const resetItemListsToDefaults = (series = '1계열', method = 'A2O') => {
        setFlowItems(createDefaultFlowItems(series, method));
        setMedicineItems(cloneItems(DEFAULT_MEDICINE_ITEMS));
        setWaterItems(cloneItems(DEFAULT_WATER_ITEMS));
        setKitItems(cloneItems(DEFAULT_KIT_ITEMS));
    };

    const handleSeriesChange = (newSeries) => {
        setSiteInfo?.((prev) => ({ ...prev, series: newSeries }));
        setFlowItems(createDefaultFlowItems(newSeries, siteInfo?.method || 'A2O'));
        setFlowOption?.(getDefaultFlowOptionBySeries(newSeries));
    };

    const addItem = async (type) => {
        try {
            if (type === 'flow' && newFlowItem.trim()) {
                const name = newFlowItem.trim();
                await SettingsModel.addConfigItem('flow', name);
                setFlowItems((prev) => [...prev, { name, checked: true }]);
                setNewFlowItem('');
            } else if (type === 'medicine' && newMedicineItem.trim()) {
                const name = newMedicineItem.trim();
                await SettingsModel.addConfigItem('medicine', name);
                setMedicineItems((prev) => [...prev, { name, checked: true }]);
                setNewMedicineItem('');
            }
        } catch (err) {
            console.error('항목 추가 실패:', err);
            showAlert?.('항목 추가에 실패했습니다: ' + err.message);
        }
    };

    const toggleItem = async (type, index) => {
        const toggle = async (category, setter) => {
            let changedItem = null;
            setter((prev) => {
                const next = [...prev];
                next[index] = { ...next[index], checked: !next[index].checked };
                changedItem = next[index];
                return next;
            });
            if (changedItem) {
                await SettingsModel.toggleConfigItem(category, changedItem.name, changedItem.checked);
            }
        };

        try {
            if (type === 'flow') await toggle('flow', setFlowItems);
            else if (type === 'medicine') await toggle('medicine', setMedicineItems);
            else if (type === 'kit') await toggle('kit', setKitItems);
        } catch (err) {
            console.error('항목 토글 실패:', err);
        }
    };

    const getFlowRowsForExcelMapping = useCallback(() => {
        const active = flowItems.filter((item) => item.checked);
        if (String(siteInfo?.series || '').trim() !== '2계열') {
            return active;
        }
        const method = siteInfo?.method || 'A2O';
        const defaults = createDefaultFlowItems('2계열', method);
        const byName = new Map(flowItems.map((item) => [item.name, item]));
        const out = [];
        const seen = new Set();

        for (const defaultItem of defaults) {
            if (TWO_SERIES_RECIRC_NAMES.includes(defaultItem.name)) {
                if (!defaultItem.checked) continue;
                const existing = byName.get(defaultItem.name);
                out.push(existing ? { ...existing, checked: true } : { name: defaultItem.name, checked: true });
                seen.add(defaultItem.name);
                continue;
            }
            const existing = byName.get(defaultItem.name);
            if (existing?.checked) {
                out.push(existing);
                seen.add(defaultItem.name);
            }
        }

        for (const item of active) {
            if (!seen.has(item.name)) {
                out.push(item);
                seen.add(item.name);
            }
        }

        return out;
    }, [flowItems, siteInfo?.series, siteInfo?.method]);

    return {
        flowItems,
        setFlowItems,
        medicineItems,
        setMedicineItems,
        waterItems,
        setWaterItems,
        kitItems,
        setKitItems,
        newFlowItem,
        setNewFlowItem,
        newMedicineItem,
        setNewMedicineItem,
        resetItemListsToDefaults,
        handleSeriesChange,
        addItem,
        toggleItem,
        getFlowRowsForExcelMapping,
    };
};
