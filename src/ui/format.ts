// Human-readable due dates. Pure: the clock and locale are passed in.

import type { Due } from '../model/item';
import type { Clock } from '../model/items';
import { dueDay } from '../model/views';
import { dateIn, offsetMinutes } from '../parser/time';

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** "Today", "Tomorrow", "Fri", or "Wed 4 Nov" (with the year if it differs). */
export function formatDay(day: string, clock: Clock, locale?: string): string {
  const today = dateIn(clock.now, clock.tz);
  const diff = daysBetween(today, day);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  const date = new Date(`${day}T12:00:00Z`);
  if (diff > 1 && diff < 7) return date.toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' });
  return date.toLocaleDateString(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: day.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric',
    timeZone: 'UTC',
  });
}

function formatTime(at: number, timeZone: string, locale?: string): string {
  return new Date(at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone });
}

/**
 * e.g. "Tomorrow", "Fri, 15:00". A time typed in another zone shows that too,
 * so "5pm EST" read in Dhaka is "Wed, 04:00 (17:00 EST)".
 */
export function formatDue(due: Due, clock: Clock, locale?: string): string {
  const day = formatDay(dueDay(due, clock.tz), clock, locale);
  if (due.type === 'date') return day;
  const local = `${day}, ${formatTime(due.at, clock.tz, locale)}`;
  const zone = due.zone;
  if (zone.type === 'offset') {
    // Show the wall time in the fixed offset that was typed.
    const shifted = new Date(due.at + zone.minutes * 60_000);
    const there = shifted.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
    return zone.minutes === offsetMinutes(clock.tz, due.at) ? local : `${local} (${there} ${zone.label})`;
  }
  if (zone.tz !== clock.tz && offsetMinutes(zone.tz, due.at) !== offsetMinutes(clock.tz, due.at)) {
    const name = new Intl.DateTimeFormat(locale, { timeZone: zone.tz, timeZoneName: 'short' })
      .formatToParts(new Date(due.at))
      .find((p) => p.type === 'timeZoneName')?.value;
    return `${local} (${formatTime(due.at, zone.tz, locale)} ${name ?? zone.tz})`;
  }
  return local;
}

