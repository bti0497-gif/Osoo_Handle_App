const avg = (rows, key) => {
    const values = rows.map((row) => Number(row[key])).filter(Number.isFinite);
    if (values.length === 0) return '-';
    return (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1);
};

export function buildWaterSummary(rows) {
    const recent = rows.slice(0, 7);
    return {
        nh3_n: avg(recent, 'nh3_n'),
        no3_n: avg(recent, 'no3_n'),
        po4_p: avg(recent, 'po4_p'),
        alkalinity: avg(recent, 'alkalinity'),
    };
}
