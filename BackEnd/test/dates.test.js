import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, endOfDay, isDateInput, isTimeZone, parseDate, startOfDay, weekRange } from '../src/utils/dates.js';
import { dates, deadline, setTimeZone } from '../../FrontEnd/src/lib/dates.js';
import { fmtDate, fmtTime, isoDate } from '../../FrontEnd/src/lib/format.js';

test('date-only deadlines end at 23:59:59.999 Vietnam time, independently of host TZ', () => {
  const previous = process.env.TZ;
  try {
    for (const tz of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
      process.env.TZ = tz;
      assert.equal(parseDate('2026-10-22', undefined, true).toISOString(), '2026-10-22T16:59:59.999Z');
      assert.equal(new Date(startOfDay('2026-10-22T18:00:00Z')).toISOString(), '2026-10-22T17:00:00.000Z');
    }
  } finally {
    previous === undefined ? delete process.env.TZ : (process.env.TZ = previous);
  }
});

test('DST days are 23 or 25 hours, not fixed 24h', () => {
  const zone = 'America/New_York';
  for (const [day, hours, end] of [
    ['2026-03-08', 23, '2026-03-09T03:59:59.999Z'],
    ['2026-11-01', 25, '2026-11-02T04:59:59.999Z'],
  ]) {
    const start = startOfDay(day, zone);
    assert.equal(endOfDay(day, zone).toISOString(), end);
    assert.equal((addDays(start, 1, zone) - start) / 3600000, hours);
  }
});

test('week means Monday through Sunday, including year and DST boundaries', () => {
  const week = weekRange('2027-01-03T12:00:00Z');
  assert.equal(new Date(week.start).toISOString(), '2026-12-27T17:00:00.000Z');
  assert.equal(new Date(week.end).toISOString(), '2027-01-03T17:00:00.000Z');
  const dst = weekRange('2026-03-08T12:00:00Z', 'America/New_York');
  assert.equal((dst.end - dst.start) / 3600000, 167);
});

test('reject invalid calendar days, ambiguous timestamps and invalid timezone names', () => {
  for (const value of ['2026-02-29', '2026-02-30T10:00:00Z', '2026-10-22T17:00', '22/10/2026', 'bad', '2026-13-01']) {
    assert.equal(isDateInput(value), false, value);
    assert.throws(() => parseDate(value), RangeError);
  }
  assert.equal(isDateInput('2028-02-29'), true);
  assert.equal(isTimeZone('Mars/Olympus'), false);
  assert.equal(isTimeZone('America/New_York'), true);
  assert.equal(parseDate('2026-10-22T09:30:12.345+07:00', undefined, true).toISOString(), '2026-10-22T02:30:12.345Z');
});

test('frontend formatting and calendar arithmetic use profile timezone', () => {
  try {
    setTimeZone('America/New_York');
    assert.equal(isoDate('2026-10-22T02:00:00Z'), '2026-10-21');
    assert.equal(fmtDate('2026-10-22T02:00:00Z'), '21 Th10');
    assert.equal(fmtTime('2026-10-22T02:00:00Z'), '22:00');
    assert.equal(deadline('2026-03-08'), '2026-03-09T03:59:59.999Z');
    const start = dates.startOfDay('2026-03-08', 'America/New_York');
    assert.equal(dates.dateKey(dates.addDays(start, 1, 'America/New_York'), 'America/New_York'), '2026-03-09');
    assert.equal(isoDate('2026-10-22'), '2026-10-22', 'a literal calendar day never shifts');
  } finally {
    setTimeZone();
  }
});
