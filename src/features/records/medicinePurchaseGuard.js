const toPositiveNumber = (value) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
};

const median = (values = []) => {
    const sorted = values
        .map(toPositiveNumber)
        .filter((value) => value > 0)
        .sort((a, b) => a - b);
    if (sorted.length === 0) return 0;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle];
};

export const buildMedicinePurchaseProfile = ({
    history = [],
    date = '',
    medicineName = '',
    defaultAmount = 0,
} = {}) => {
    const targetMonth = String(date).slice(0, 7);
    const matchingRows = history.filter((row) => (
        String(row?.medicine_name || '').trim() === String(medicineName).trim()
    ));
    const otherMonthlyPurchaseDates = matchingRows
        .filter((row) => (
            String(row?.date || '').slice(0, 7) === targetMonth
            && String(row?.date || '') !== String(date)
            && toPositiveNumber(row?.purchase_amount) > 0
        ))
        .map((row) => String(row.date))
        .sort();
    const previousPurchaseAmounts = matchingRows
        .filter((row) => String(row?.date || '') < String(date))
        .map((row) => toPositiveNumber(row?.purchase_amount))
        .filter((value) => value > 0);
    const configuredAmount = toPositiveNumber(defaultAmount);
    const historicalMedian = median(previousPurchaseAmounts);

    return {
        otherMonthlyPurchaseDates,
        usualPurchaseAmount: configuredAmount || historicalMedian,
        usualPurchaseSource: configuredAmount > 0 ? '설정 기준량' : (historicalMedian > 0 ? '최근 입고 중앙값' : ''),
    };
};

export const assessMedicinePurchase = ({
    medicineName = '',
    purchaseAmount = 0,
    purchaseEdited = false,
    profile = {},
} = {}) => {
    const purchase = toPositiveNumber(purchaseAmount);
    if (!purchaseEdited || purchase <= 0) return [];

    const warnings = [];
    const otherDates = Array.isArray(profile.otherMonthlyPurchaseDates)
        ? profile.otherMonthlyPurchaseDates
        : [];
    if (otherDates.length > 0) {
        warnings.push({
            code: 'additional-monthly-purchase',
            medicineName,
            purchaseAmount: purchase,
            message: `${medicineName}: 이번 달에 이미 입고 기록이 있습니다 (${otherDates.join(', ')}). 두 번째 입고가 맞나요?`,
        });
    }

    const usual = toPositiveNumber(profile.usualPurchaseAmount);
    if (usual > 0 && purchase < usual * 0.5) {
        warnings.push({
            code: 'unusually-low-purchase',
            medicineName,
            purchaseAmount: purchase,
            usualPurchaseAmount: usual,
            usualPurchaseSource: profile.usualPurchaseSource || '',
            message: `${medicineName}: 입고량 ${purchase.toLocaleString()}은 평소 입고량 ${usual.toLocaleString()}의 절반보다 적습니다. 사용량을 입고란에 넣은 것은 아닌지 확인해 주세요.`,
        });
    }

    return warnings;
};
