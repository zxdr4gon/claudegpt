// Snooze presets (DECISIONS #17). Each returns the instant the snooze ends,
// computed in the viewer's zone. Snoozing never touches the due date.

import { dateIn, wallClock, zonedWallToInstant } from '../parser/time';
import type { Clock } from './items';

export type SnoozePreset = 'laterToday' | 'tomorrow' | 'nextWeek';

/** Mornings start at 09:00. */
const MORNING_HOUR = 9;
const HOUR = 60 * 60 * 1000;

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function morningOf(date: string, tz: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return zonedWallToInstant({ year, month, day, hour: MORNING_HOUR, minute: 0, second: 0 }, tz);
}

export function snoozeUntil(preset: SnoozePreset, clock: Clock): number {
  const today = dateIn(clock.now, clock.tz);
  switch (preset) {
    case 'laterToday': {
      // At least three elapsed hours from now, rounded up to the next full
      // local hour. Rounding stays in instants: going back through wall time
      // would be ambiguous in a repeated (fall-back) hour.
      const threshold = clock.now + 3 * HOUR;
      const w = wallClock(threshold, clock.tz);
      const startOfHour = threshold - (threshold % 1000) - (w.minute * 60 + w.second) * 1000;
      return startOfHour === threshold ? threshold : startOfHour + HOUR;
    }
    case 'tomorrow':
      return morningOf(addDays(today, 1), clock.tz);
    case 'nextWeek': {
      // The coming Monday morning (a week ahead if today is Monday).
      const weekday = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
      const days = ((8 - weekday) % 7) || 7;
      return morningOf(addDays(today, days), clock.tz);
    }
  }
}
