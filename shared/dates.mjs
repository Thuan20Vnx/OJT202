// Calendar policy shared by API and UI. Project reports/quota use one team zone;
// personal deadlines and calendar views use the user's validated profile zone.
export const BUSINESS_TIMEZONE = 'Asia/Ho_Chi_Minh';
export const isTimeZone = (zone) => {
  try {
    if (typeof zone !== 'string' || !zone || /^[+-]/.test(zone)) return false;
    new Intl.DateTimeFormat('en', { timeZone: zone }).format(0);
    return true;
  } catch {
    return false;
  }
};
export const isCalendarDate = (s) =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number(s.slice(0, 4)) >= 1000 && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
export const isDateInput = (s) =>
  isCalendarDate(s) ||
  (typeof s === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(s) &&
    isCalendarDate(s.slice(0, 10)) &&
    !Number.isNaN(Date.parse(s)));

// Dependency injection keeps the same rules testable without coupling the two apps.
export function createDateTools(TZDate) {
  const zoned = (d = new Date(), zone = BUSINESS_TIMEZONE) => {
    if (!isTimeZone(zone)) throw new RangeError('Múi giờ không hợp lệ');
    if (isCalendarDate(d)) {
      const [y, m, day] = d.split('-').map(Number);
      return new TZDate(y, m - 1, day, zone);
    }
    return new TZDate(new Date(d).getTime(), zone);
  };
  const dateKey = (d, zone = BUSINESS_TIMEZONE) => {
    if (isCalendarDate(d)) return d;
    const x = zoned(d, zone);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  };
  const startOfDay = (d = new Date(), zone = BUSINESS_TIMEZONE) => {
    const x = zoned(d, zone);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const addDays = (d, count, zone = BUSINESS_TIMEZONE) => {
    const x = zoned(d, zone);
    x.setDate(x.getDate() + count);
    return x;
  };
  const endOfDay = (d, zone = BUSINESS_TIMEZONE) => new Date(addDays(startOfDay(d, zone), 1, zone).getTime() - 1);
  const weekRange = (d = new Date(), zone = BUSINESS_TIMEZONE) => {
    const s = startOfDay(d, zone);
    const start = addDays(s, -((s.getDay() + 6) % 7), zone);
    return { start, end: addDays(start, 7, zone) };
  };
  const parseDate = (s, zone = BUSINESS_TIMEZONE, end = false) => {
    if (!isDateInput(s)) throw new RangeError('Ngày không hợp lệ; thời điểm phải có múi giờ');
    return isCalendarDate(s) ? (end ? endOfDay(s, zone) : startOfDay(s, zone)) : new Date(s);
  };
  return { zoned, dateKey, startOfDay, addDays, endOfDay, weekRange, parseDate };
}
