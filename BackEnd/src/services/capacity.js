import { badRequest } from '../utils/http.js';
import { dateKey, isCalendarDate, weekRange } from '../utils/dates.js';

/** Calendar keys are shared across profiles; DATE storage never shifts a Monday through UTC. */
export function capacityWeek(value) {
  if (!isCalendarDate(value) || new Date(`${value}T00:00:00.000Z`).getUTCDay() !== 1) {
    throw badRequest('Tuần phải là ngày thứ Hai hợp lệ (YYYY-MM-DD)');
  }
  return new Date(`${value}T00:00:00.000Z`);
}

export function currentCapacityWeek(now = new Date()) {
  return dateKey(weekRange(now).start);
}
