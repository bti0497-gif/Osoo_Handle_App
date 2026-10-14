// Request/estimate amounts remain in history but are not actual maintenance costs.
export function sumMaintenanceCost(entries = [], { startDate = '', endDate = '' } = {}) {
  return entries.reduce((sum, entry) => {
    if (String(entry.type || '').replace(/\s+/g, '') === '수리의뢰') return sum;
    const date = String(entry.date || '').slice(0, 10);
    if ((startDate && date < startDate) || (endDate && date > endDate)) return sum;
    const amount = Number(entry.price);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);
}
