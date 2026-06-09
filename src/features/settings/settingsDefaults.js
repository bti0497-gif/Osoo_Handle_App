export const DEFAULT_ROAD_WEB_URL = 'https://nwpo.ex.co.kr:5002//security/login.do';
export const DEFAULT_WATER_ANALYSIS_URL = 'https://eco.qntech.co.kr';

export const ALPHABET = (() => {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const res = [...letters];
    letters.forEach((letter) => res.push('A' + letter));
    return res;
})();

export const EMPTY_SITE_INFO = {
    siteId: '',
    siteName: '',
    managerName: '',
    method: '',
    series: '',
    targetLat: null,
    targetLng: null,
    radiusM: 500
};

export const getDefaultFlowOptionBySeries = (series) => (
    String(series || '').trim() === '2계열' ? 'combined' : 'single1'
);

export const createDefaultFlowItems = (series = '1계열', method = 'A2O') => {
    const normalizedSeries = String(series || '1계열').trim();
    const isMbr = String(method || '').toUpperCase() === 'MBR';
    const items = [
        { name: '유입유량계', checked: true },
        { name: '방류유량계', checked: true }
    ];

    if (normalizedSeries === '2계열') {
        items.push(
            { name: '내부반송유량계1', checked: true },
            { name: '내부반송유량계2', checked: true }
        );
        if (!isMbr) {
            items.push(
                { name: '외부반송유량계1', checked: true },
                { name: '외부반송유량계2', checked: true }
            );
        }
    } else {
        items.push({ name: '내부반송유량계', checked: true });
        if (!isMbr) items.push({ name: '외부반송유량계', checked: true });
    }

    items.push(
        { name: '전력량계', checked: true },
        { name: '슬러지', checked: true }
    );

    return items;
};

export const TWO_SERIES_RECIRC_NAMES = [
    '내부반송유량계1',
    '내부반송유량계2',
    '외부반송유량계1',
    '외부반송유량계2'
];

export const needsResyncFlowItemsForSite = (items, series, method) => {
    if (!Array.isArray(items) || items.length === 0) return true;
    const expected = createDefaultFlowItems(series, method);
    const a = expected.map((item) => item.name).slice().sort().join('\t');
    const b = items.map((item) => item.name).slice().sort().join('\t');
    return a !== b;
};

export const DEFAULT_MEDICINE_ITEMS = [
    { name: '중탄산나트륨', checked: true },
    { name: '포도당', checked: true },
    { name: '팩(PAC)', checked: true }
];

export const DEFAULT_WATER_ITEMS = [
    { name: '암모니아성질소', checked: true },
    { name: '질산성질소', checked: true },
    { name: '인산염인', checked: true },
    { name: '알칼리도', checked: true }
];

export const DEFAULT_KIT_ITEMS = [
    { name: '암모니아성질소(NH3-N)', checked: true },
    { name: '질산성질소(NO3-N)', checked: true },
    { name: '인산염인(PO4-P)', checked: true },
    { name: '알칼리도(ALK)', checked: true }
];

export const DEFAULT_LOCATION_ITEMS = [
    { name: '유량조정조', checked: true },
    { name: '무산소조', checked: true },
    { name: '포기조', checked: true },
    { name: '침전조', checked: true },
    { name: '방류조', checked: true }
];

export const cloneItems = (items) => items.map((item) => ({ ...item }));

export const createDefaultLocationItems = (method = 'A2O') => {
    const isMbr = String(method || '').toUpperCase() === 'MBR';
    return DEFAULT_LOCATION_ITEMS.map((item) => ({
        ...item,
        checked: item.name === '침전조' ? !isMbr : true
    }));
};
