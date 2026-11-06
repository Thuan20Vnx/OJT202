import { badRequest } from '../utils/http.js';
import { dateKey, isCalendarDate, weekRange } from '../utils/dates.js';

/** A configured default (schema default 20h) is distinct from absent data.
 * Zero is a real capacity. Never invent a denominator for missing inputs. */
export function effectiveCapacity(weeklyHours, defaultHours) {
  const valid = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  if (valid(weeklyHours)) return { available: weeklyHours, capacitySource: 'week', missingCapacity: false };
  if (valid(defaultHours)) return { available: defaultHours, capacitySource: 'default', missingCapacity: false };
  return { available: null, capacitySource: 'missing', missingCapacity: true };
}

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
