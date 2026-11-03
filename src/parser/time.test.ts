import { describe, expect, it } from 'vitest';
import { dateIn, offsetMinutes, wallClock, zonedWallToInstant } from './time';

const utc = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);

describe('offsetMinutes', () => {
  it.each([
    ['Asia/Dhaka', utc(2026, 11, 3), 360],
    ['Asia/Kathmandu', utc(2026, 11, 3), 345],
    ['America/New_York', utc(2026, 7, 1), -240],
    ['America/New_York', utc(2026, 12, 1), -300],
    ['UTC', utc(2026, 11, 3), 0],
  ])('%s at %s → %i', (tz, at, expected) => {
    expect(offsetMinutes(tz, at)).toBe(expected);
  });
});

describe('zonedWallToInstant', () => {
  const wall = (y: number, mo: number, d: number, h: number, mi = 0) =>
    ({ year: y, month: mo, day: d, hour: h, minute: mi, second: 0 });

  it.each([
    ['ordinary time', wall(2026, 11, 4, 15), 'Asia/Dhaka', utc(2026, 11, 4, 9)],
    ['before spring-forward', wall(2026, 3, 8, 1, 30), 'America/New_York', utc(2026, 3, 8, 6, 30)],
    ['inside spring-forward gap shifts forward', wall(2026, 3, 8, 2, 30), 'America/New_York', utc(2026, 3, 8, 7, 30)],
    ['ambiguous fall-back time takes the earlier instant', wall(2026, 11, 1, 1, 30), 'America/New_York', utc(2026, 11, 1, 5, 30)],
    ['after fall-back', wall(2026, 11, 1, 9), 'America/New_York', utc(2026, 11, 1, 14)],
  ])('%s', (_name, w, tz, expected) => {
    expect(zonedWallToInstant(w, tz)).toBe(expected);
  });

  it('round-trips through wallClock', () => {
    const at = utc(2026, 6, 15, 12, 34);
    expect(zonedWallToInstant(wallClock(at, 'Asia/Kathmandu'), 'Asia/Kathmandu')).toBe(at);
  });
});

describe('dateIn', () => {
  it('uses the zone, not UTC or the host', () => {
    // 20:30 UTC on Nov 3 is already Nov 4 in Dhaka.
    expect(dateIn(utc(2026, 11, 3, 20, 30), 'Asia/Dhaka')).toBe('2026-11-04');
    expect(dateIn(utc(2026, 11, 3, 20, 30), 'America/New_York')).toBe('2026-11-03');
  });
});
