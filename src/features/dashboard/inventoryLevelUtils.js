const INVENTORY_SUFFIX_PATTERN = /_(purchase|usage|inventory)$/i;

function normalizeConfigName(value) {
    return String(value || '').trim();
}

function medicineGroupKey(name) {
    const compact = normalizeConfigName(name)
        .replace(/[\s()_-]/g, '')
        .toUpperCase();

    if (compact.includes('중탄산') || compact.includes('탄산수소나트륨') || compact.includes('NAHCO3')) {
        return 'medicine:bicarbonate';
    }
    if (compact.includes('고분자') || compact.includes('폴리머') || compact.includes('POLYMER')) {
        return 'medicine:polymer';
    }
    if (compact === '응집제' || compact.includes('PAC') || compact === '팩') {
        return 'medicine:pac';
    }
    if (compact.includes('차아염소') || compact.includes('차염소산')) {
        return 'medicine:hypochlorite';
    }
    return `medicine:${compact}`;
}

function preferredMedicineName(groupKey) {
    if (groupKey === 'medicine:bicarbonate') return '중탄산나트륨';
    if (groupKey === 'medicine:pac') return '팩(PAC)';
    if (groupKey === 'medicine:polymer') return '폴리머';
    if (groupKey === 'medicine:hypochlorite') return '차아염소산나트륨';
    return '';
}

export function getActiveConfiguredInventoryNames(configItems = [], category) {
    const groupByKey = new Map();

    configItems.forEach((item, rowIndex) => {
        if (String(item?.category || '') !== category || Number(item?.is_active) !== 1) return;
        const name = normalizeConfigName(item?.item_name);
        if (!name || INVENTORY_SUFFIX_PATTERN.test(name)) return;

        const groupKey = category === 'medicine' ? medicineGroupKey(name) : `${category}:${name}`;
        const preferredName = category === 'medicine' ? preferredMedicineName(groupKey) : '';
        const current = groupByKey.get(groupKey);
        const candidate = {
            name,
            order: Number.isFinite(Number(item?.display_order)) ? Number(item.display_order) : rowIndex,
            preferred: Boolean(preferredName && name === preferredName),
        };

        if (!current || (candidate.preferred && !current.preferred)) {
            groupByKey.set(groupKey, candidate);
        }
    });

    return Array.from(groupByKey.values())
        .sort((a, b) => a.order - b.order)
        .map((item) => item.name);
}

export function normalizeLatestInventory(historyRows = [], nameKey, configuredNames) {
    const hasConfiguredFilter = Array.isArray(configuredNames);
    const allowedNames = hasConfiguredFilter ? new Set(configuredNames) : null;
    const byName = new Map();

    historyRows.forEach((row, rowIndex) => {
        const name = String(row?.[nameKey] || '').trim();
        if (!name || (allowedNames && !allowedNames.has(name))) return;

        const date = String(row?.date || '');
        const inventory = Number(row?.current_inventory);
        const purchase = Number(row?.purchase_amount);
        const current = byName.get(name) || { latest: null, latestPurchase: null };

        if (!current.latest || date > current.latest.date
            || (date === current.latest.date && rowIndex > current.latest.rowIndex)) {
            current.latest = {
                name,
                date,
                rowIndex,
                inventory: Number.isFinite(inventory) ? inventory : 0,
            };
        }

        if (Number.isFinite(purchase) && purchase > 0
            && (!current.latestPurchase || date > current.latestPurchase.date
                || (date === current.latestPurchase.date && rowIndex > current.latestPurchase.rowIndex))) {
            current.latestPurchase = { date, rowIndex, amount: purchase };
        }

        byName.set(name, current);
    });

    const normalizedByName = new Map(Array.from(byName.values())
        .filter((entry) => entry.latest)
        .map((entry) => ({
            name: entry.latest.name,
            date: entry.latest.date,
            inventory: entry.latest.inventory,
            referenceAmount: entry.latestPurchase?.amount || 0,
        }))
        .map((item) => [item.name, item]));

    if (hasConfiguredFilter) {
        return configuredNames.map((name) => normalizedByName.get(name) || {
            name,
            date: '',
            inventory: 0,
            referenceAmount: 0,
        });
    }

    return Array.from(normalizedByName.values()).sort((a, b) => b.inventory - a.inventory);
}
