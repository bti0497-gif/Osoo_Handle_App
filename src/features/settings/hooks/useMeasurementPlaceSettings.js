import { useState } from 'react';
import { SettingsModel } from '../SettingsModel';
import { createDefaultLocationItems } from '../settingsDefaults';

export const useMeasurementPlaceSettings = ({ showAlert } = {}) => {
    const [locationItems, setLocationItems] = useState(createDefaultLocationItems('A2O'));
    const [newLocationItem, setNewLocationItem] = useState('');

    const resetLocationItemsToDefaults = (method = 'A2O') => {
        setLocationItems(createDefaultLocationItems(method));
    };

    const addLocationItem = async () => {
        const name = newLocationItem.trim();
        if (!name) return;

        try {
            await SettingsModel.addConfigItem('location', name);
            setLocationItems((prev) => [...prev, { name, checked: true }]);
            setNewLocationItem('');
        } catch (err) {
            console.error('측정장소 추가 실패:', err);
            showAlert?.('측정장소 추가에 실패했습니다: ' + err.message);
        }
    };

    const toggleLocationItem = async (index) => {
        let changedItem = null;
        setLocationItems((prev) => {
            const next = [...prev];
            next[index] = { ...next[index], checked: !next[index].checked };
            changedItem = next[index];
            return next;
        });

        if (!changedItem) return;

        try {
            await SettingsModel.toggleConfigItem('location', changedItem.name, changedItem.checked);
        } catch (err) {
            console.error('측정장소 토글 실패:', err);
        }
    };

    const moveLocationItem = (index, direction) => {
        setLocationItems((prev) => {
            const nextIndex = index + direction;
            if (nextIndex < 0 || nextIndex >= prev.length) return prev;
            const next = [...prev];
            const [item] = next.splice(index, 1);
            next.splice(nextIndex, 0, item);
            return next;
        });
    };

    return {
        locationItems,
        setLocationItems,
        newLocationItem,
        setNewLocationItem,
        resetLocationItemsToDefaults,
        addLocationItem,
        toggleLocationItem,
        moveLocationItem,
    };
};
