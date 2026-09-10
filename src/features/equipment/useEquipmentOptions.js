import { useEffect, useState } from 'react';
import EquipmentModel from './EquipmentModel';

const normalize = (item) => ({
  ...item,
  managementNo: item.managementNo || item.management_no,
  name: item.name || item.equipment_name,
  category3: item.category3 || item.category_3,
});

export function useEquipmentOptions() {
  const [state, setState] = useState({ items: [], loading: true, error: null });

  useEffect(() => {
    let active = true;
    EquipmentModel.fetchEquipment()
      .then((rows) => {
        if (active) setState({ items: (Array.isArray(rows) ? rows : []).map(normalize), loading: false, error: null });
      })
      .catch((error) => {
        if (active) setState({ items: [], loading: false, error });
      });
    return () => { active = false; };
  }, []);

  return state;
}
