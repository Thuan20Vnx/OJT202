import { addDays, BUSINESS_TIMEZONE, isCalendarDate, isDateInput, parseDate } from '../../utils/dates.js';
import { badRequest } from '../../utils/http.js';

/** All stored/new report intervals are [from, to). Legacy date-picker inputs
 * keep their inclusive final calendar day by advancing to the next midnight. */
export function reportPeriod(body, timezone = BUSINESS_TIMEZONE) {
  const canonical = body.period_start !== undefined || body.period_end !== undefined;
  const start = canonical ? body.period_start : body.from;
  const end = canonical ? body.period_end : body.to;
  if (!isDateInput(start) || !isDateInput(end)) throw badRequest('Khoảng ngày không hợp lệ');
  const from = parseDate(start, timezone);
  const to = !canonical && isCalendarDate(end) ? addDays(parseDate(end, timezone), 1, timezone) : parseDate(end, timezone);
  if (to <= from) throw badRequest('Thời điểm kết thúc phải sau thời điểm bắt đầu');
  return { from: new Date(from.getTime()), to: new Date(to.getTime()), timezone, periodConvention: 'exclusive-end' };
}
