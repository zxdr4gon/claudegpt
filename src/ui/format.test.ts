import { describe, expect, it } from 'vitest';
import type { Due } from '../model/item';
import { formatDay, formatDue } from './format';

const utc = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);
// Tuesday 3 Nov 2026, 10:00 in Dhaka.
const NOW = { now: utc(2026, 11, 3, 4), tz: 'Asia/Dhaka' };
const L = 'en-GB';

describe('formatDay', () => {
  it.each([
    ['2026-11-03', 'Today'],
    ['2026-11-04', 'Tomorrow'],
    ['2026-11-02', 'Yesterday'],
    ['2026-11-06', 'Fri'],
    ['2026-11-10', 'Tue 10 Nov'],
    ['2026-10-20', 'Tue 20 Oct'],
    ['2027-01-05', 'Tue, 5 Jan 2027'], // the locale adds the comma when a year is shown
  ])('%s → %s', (day, expected) => {
    expect(formatDay(day, NOW, L)).toBe(expected);
  });
});

describe('formatDue', () => {
  it.each<[string, Due, string]>([
    ['all-day', { type: 'date', date: '2026-11-04' }, 'Tomorrow'],
    ['timed, local zone', { type: 'instant', at: utc(2026, 11, 4, 9), zone: { type: 'iana', tz: 'Asia/Dhaka' } }, 'Tomorrow, 15:00'],
    [
      'explicit fixed zone shows what was typed',
      { type: 'instant', at: utc(2026, 11, 3, 22), zone: { type: 'offset', minutes: -300, label: 'EST' } },
      'Tomorrow, 4:00 (17:00 EST)',
    ],
    [
      'named zone different from the viewer',
      { type: 'instant', at: utc(2026, 11, 3, 17), zone: { type: 'iana', tz: 'America/New_York' } },
      'Today, 23:00 (12:00 GMT-5)', // en-GB's short name for New York in winter
    ],
    [
      'entered elsewhere with the same offset: no hint',
      { type: 'instant', at: utc(2026, 11, 4, 9), zone: { type: 'iana', tz: 'Asia/Thimphu' } },
      'Tomorrow, 15:00',
    ],
  ])('%s', (_name, due, expected) => {
    expect(formatDue(due, NOW, L)).toBe(expected);
  });
});
