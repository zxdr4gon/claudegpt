// Bringing stored or imported records up to the current schema, and checking
// that a record really is an Item before it reaches the database.
//
// Schema changes are migrated here (shape), separately from parser changes
// (PARSER_VERSION → reparse). Shape migration must cover user-owned values
// too, since reparse never touches those.

import { isValidTimeZone } from '../parser/time';
import type { Item } from './item';

type Json = Record<string, unknown>;

const isObject = (x: unknown): x is Json => typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * Upgrade a record's shape to the current schema. Returns a new object when
 * something changed; unrecognised input is returned as-is (validation rejects it).
 *
 * Changes so far:
 * - Timed due dates: `{ type: 'instant', at, tz }` → `{ type: 'instant', at, zone: { type: 'iana', tz } }`.
 */
export function upgradeShape(raw: unknown): unknown {
  if (!isObject(raw) || !isObject(raw.due) || !isObject(raw.due.value)) return raw;
  const value = raw.due.value;
  if (value.type === 'instant' && typeof value.tz === 'string' && value.zone === undefined) {
    const { tz, ...rest } = value;
    return { ...raw, due: { ...raw.due, value: { ...rest, zone: { type: 'iana', tz } } } };
  }
  return raw;
}

// --- Validation --------------------------------------------------------------

const isNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isOptionalNumber = (x: unknown) => x === undefined || isNumber(x);
const isSource = (x: unknown) => x === 'parsed' || x === 'user';
const isTz = (x: unknown) => typeof x === 'string' && isValidTimeZone(x);
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/u;

/** A real calendar date in 'YYYY-MM-DD' form (rejects e.g. 2026-02-31). */
export function isCalendarDate(x: unknown): boolean {
  if (typeof x !== 'string') return false;
  const m = DATE_RE.exec(x);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/** Real-world UTC offsets run from -12:00 to +14:00. */
export const MIN_OFFSET_MINUTES = -12 * 60;
export const MAX_OFFSET_MINUTES = 14 * 60;

function isParseRef(x: unknown): boolean {
  return isObject(x) && isNumber(x.at) && isTz(x.tz);
}

/** A Field<T>: `{ value: T | null, source }`; null only when user-owned. */
function isField(x: unknown, isValue: (v: unknown) => boolean): x is Json {
  if (!isObject(x) || !isSource(x.source)) return false;
  if (x.value === null) return x.source === 'user';
  return isValue(x.value);
}

function isZone(x: unknown): boolean {
  if (!isObject(x)) return false;
  if (x.type === 'iana') return isTz(x.tz);
  if (x.type === 'offset') {
    return (
      Number.isInteger(x.minutes) &&
      (x.minutes as number) >= MIN_OFFSET_MINUTES &&
      (x.minutes as number) <= MAX_OFFSET_MINUTES &&
      typeof x.label === 'string' &&
      x.label.trim().length > 0
    );
  }
  return false;
}

function isDue(x: unknown): boolean {
  if (!isObject(x)) return false;
  if (x.type === 'date') return isCalendarDate(x.date);
  if (x.type === 'instant') return isNumber(x.at) && isZone(x.zone);
  return false;
}

function isTag(x: unknown): boolean {
  return (
    isObject(x) &&
    typeof x.value === 'string' &&
    x.value.length > 0 &&
    isSource(x.source) &&
    (x.dismissed === undefined || typeof x.dismissed === 'boolean')
  );
}

function isSpan(x: unknown, textLength: number): boolean {
  return (
    isObject(x) &&
    Number.isInteger(x.start) &&
    Number.isInteger(x.end) &&
    (x.start as number) >= 0 &&
    (x.start as number) <= (x.end as number) &&
    (x.end as number) <= textLength &&
    ['due', 'tag', 'priority', 'url'].includes(x.field as string)
  );
}

/** Full structural check of a current-schema Item, nested values included. */
export function isValidItem(x: unknown): x is Item {
  if (!isObject(x)) return false;
  if (typeof x.id !== 'string' || x.id.length === 0) return false;
  if (typeof x.rawText !== 'string' || typeof x.text !== 'string') return false;
  if (!isParseRef(x.textRef)) return false;

  if (!isField(x.kind, (v) => v === 'task' || v === 'note' || v === 'link') || x.kind.value === null) return false;
  if (x.due !== undefined) {
    if (!isField(x.due, isDue)) return false;
    if (x.due.ref !== undefined && !isParseRef(x.due.ref)) return false;
  }
  if (x.priority !== undefined && !isField(x.priority, (v) => v === 1 || v === 2 || v === 3)) return false;
  if (x.url !== undefined && !isField(x.url, (v) => typeof v === 'string')) return false;
  if (!Array.isArray(x.tags) || !x.tags.every(isTag)) return false;
  const textLength = x.text.length;
  if (!Array.isArray(x.spans) || !x.spans.every((s) => isSpan(s, textLength))) return false;
  if (!Number.isInteger(x.parserVersion) || (x.parserVersion as number) < 0) return false;

  if (!['open', 'done', 'archived'].includes(x.status as string)) return false;
  if (!isNumber(x.capturedAt) || !isNumber(x.createdAt) || !isNumber(x.updatedAt)) return false;
  return isOptionalNumber(x.completedAt) && isOptionalNumber(x.snoozedUntil) && isOptionalNumber(x.deletedAt);
}
