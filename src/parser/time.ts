// Timezone helpers built on Intl, so results never depend on the host's local zone.

export type WallClock = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock reading in `tz` at instant `at`. */
export function wallClock(at: number, tz: string): WallClock {
  const parts: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(new Date(at))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  return {
    year: parts.year!,
    month: parts.month!,
    day: parts.day!,
    hour: parts.hour!,
    minute: parts.minute!,
    second: parts.second!,
  };
}

function wallAsUtc(w: WallClock): number {
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
}

/** UTC offset of `tz` at instant `at`, in minutes (east positive, e.g. Asia/Dhaka = 360). */
export function offsetMinutes(tz: string, at: number): number {
  const wholeSeconds = Math.floor(at / 1000) * 1000;
  return (wallAsUtc(wallClock(wholeSeconds, tz)) - wholeSeconds) / 60000;
}

function sameWall(a: WallClock, b: WallClock): boolean {
  return wallAsUtc(a) === wallAsUtc(b);
}

/**
 * The instant at which `tz` shows wall time `w`.
 * - Ambiguous times (clocks going back) resolve to the earlier instant.
 * - Nonexistent times (clocks going forward) shift forward by the gap,
 *   e.g. 02:30 on a spring-forward night becomes 03:30.
 */
export function zonedWallToInstant(w: WallClock, tz: string): number {
  const asUtc = wallAsUtc(w);
  const day = 24 * 60 * 60 * 1000;
  const before = asUtc - offsetMinutes(tz, asUtc - day) * 60000;
  const after = asUtc - offsetMinutes(tz, asUtc + day) * 60000;
  const valid = [before, after].filter((c) => sameWall(wallClock(c, tz), w));
  if (valid.length > 0) return Math.min(...valid);
  return before;
}

const pad = (n: number, len = 2) => String(n).padStart(len, '0');

export function formatDate(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** The calendar date ('YYYY-MM-DD') in `tz` at instant `at`. */
export function dateIn(at: number, tz: string): string {
  const w = wallClock(at, tz);
  return formatDate(w.year, w.month, w.day);
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const TIME_RE = /^(\d{2}):(\d{2})$/u;

/** A real calendar date in 'YYYY-MM-DD' form (rejects e.g. 2026-02-31, month 13). */
export function isCalendarDate(x: unknown): x is string {
  if (typeof x !== 'string') return false;
  const m = DATE_RE.exec(x);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/** 'HH:mm' on a 24-hour clock (rejects hour 24+, minute 60+), as [hour, minute]. */
export function parseClockTime(x: string): [number, number] | null {
  const m = TIME_RE.exec(x);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  return hour <= 23 && minute <= 59 ? [hour, minute] : null;
}

/**
 * A validated local date and time in `tz` as an instant, or null if either
 * part doesn't exist on the calendar or clock. Never lets Date normalise an
 * impossible value (Feb 31, hour 25) into a different one. DST follows
 * zonedWallToInstant: gap times shift forward, repeated times take the earlier.
 */
export function localToInstant(date: string, time: string, tz: string): number | null {
  if (!isCalendarDate(date)) return null;
  const t = parseClockTime(time);
  if (!t) return null;
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return zonedWallToInstant({ year, month, day, hour: t[0], minute: t[1], second: 0 }, tz);
}

export function currentTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
