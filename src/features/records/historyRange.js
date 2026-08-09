const toDateString = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

export const getRecentHistoryStart = () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 2, now.getDate(), 12);
    return toDateString(start);
};

export const getOlderHistoryRange = (beforeDate) => {
    const end = new Date(`${beforeDate}T12:00:00`);
    end.setDate(end.getDate() - 1);
    const start = new Date(end);
    start.setMonth(start.getMonth() - 2);
    return { fromDate: toDateString(start), toDate: toDateString(end) };
};
