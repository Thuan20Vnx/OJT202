import { TZDate } from '@date-fns/tz';
import { BUSINESS_TIMEZONE, createDateTools, isTimeZone } from '../../../shared/dates.mjs';
export { BUSINESS_TIMEZONE };
export const dates = createDateTools(TZDate);
export const reportPeriodInput = ({ from, to, template }, zone = BUSINESS_TIMEZONE) => ({
  period_start: new Date(dates.parseDate(from, zone).getTime()).toISOString(),
  period_end: new Date(dates.addDays(dates.parseDate(to, zone), 1, zone).getTime()).toISOString(),
  template,
});
let profileZone = BUSINESS_TIMEZONE;
export const setTimeZone = (zone) => {
  profileZone = isTimeZone(zone) ? zone : BUSINESS_TIMEZONE;
};
export const timeZone = () => profileZone;
export const zoned = (d = new Date()) => dates.zoned(d, profileZone);
export const addDays = (d, n) => dates.addDays(d, n, profileZone);
export const deadline = (d) => (d ? dates.parseDate(d, profileZone, true).toISOString() : null);
