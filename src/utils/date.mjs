export function normalizeDateForId(value, fallbackDate = new Date()) {
    const fallback = fallbackDate.toISOString().slice(0, 10);
    if (!value) return fallback;
    const match = String(value).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    if (!match) return fallback;
    const [, year, month, day] = match;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

