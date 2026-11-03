// Pure text → detected values. No knowledge of items, provenance or history;
// merging with an existing item lives in item.ts.

import * as chrono from 'chrono-node';
import type { Due, Kind, ParseRef, Priority } from '../model/item';
import { formatDate, offsetMinutes, zonedWallToInstant } from './time';

/** Bump whenever parsing behaviour changes (DECISIONS #8). */
export const PARSER_VERSION = 1;

export type Range = { start: number; end: number };

export type DateMatch = Range & { text: string; due: Due };
export type TagMatch = Range & { value: string };
export type PriorityMatch = Range & { value: Priority };
export type UrlMatch = Range & { value: string };

export type ParseResult = {
  /** All date expressions, in text order. Only the first becomes the due date. */
  dates: DateMatch[];
  tags: TagMatch[];
  priority?: PriorityMatch;
  url?: UrlMatch;
};

const URL_RE = /https?:\/\/[^\s<>"]+/giu;
// A tag starts at the beginning or after whitespace/"(", and begins with a letter.
const TAG_RE = /(?<=^|[\s(])#(\p{L}[\p{L}\p{N}_-]*)/gu;
const PRIORITY_RE = /(?<=^|\s)(!{1,3})(?=\s|$)/gu;

function trimUrl(raw: string): string {
  let url = raw.replace(/[.,;:!?'"\]]+$/u, '');
  // Drop trailing ")" only when unbalanced, so wiki-style URLs keep theirs.
  while (url.endsWith(')') && count(url, '(') < count(url, ')')) {
    url = url.slice(0, -1).replace(/[.,;:!?'"\]]+$/u, '');
  }
  return url;
}

function count(s: string, ch: string): number {
  return s.split(ch).length - 1;
}

function overlaps(a: Range, b: Range): boolean {
  return a.start < b.end && b.start < a.end;
}

function findUrls(text: string): UrlMatch[] {
  return [...text.matchAll(URL_RE)].map((m) => {
    const value = trimUrl(m[0]);
    return { start: m.index, end: m.index + value.length, value };
  });
}

function findTags(text: string, exclude: Range[]): TagMatch[] {
  const tags: TagMatch[] = [];
  for (const m of text.matchAll(TAG_RE)) {
    const name = m[1]!.replace(/[-_]+$/u, '');
    const span = { start: m.index, end: m.index + 1 + name.length };
    if (exclude.some((r) => overlaps(r, span))) continue;
    tags.push({ ...span, value: name.toLowerCase() });
  }
  return tags;
}

function findPriority(text: string): PriorityMatch | undefined {
  const m = PRIORITY_RE.exec(text);
  PRIORITY_RE.lastIndex = 0;
  if (!m) return undefined;
  return { start: m.index, end: m.index + m[1]!.length, value: m[1]!.length as Priority };
}

function toDue(result: chrono.ParsedResult, ref: ParseRef): Due {
  const c = result.start;
  // An explicit zone ("5pm EST") or a pure duration ("in 3 hours") is already
  // an exact instant; chrono's arithmetic is correct for those.
  if (c.isCertain('timezoneOffset')) {
    return { type: 'instant', at: c.date().getTime(), tz: ref.tz };
  }
  const year = c.get('year')!;
  const month = c.get('month')!;
  const day = c.get('day')!;
  if (c.isCertain('hour')) {
    // chrono reports wall-clock components in the reference offset. Convert
    // them with the real zone rules for the target date, so DST is respected.
    const at = zonedWallToInstant(
      { year, month, day, hour: c.get('hour')!, minute: c.get('minute') ?? 0, second: c.get('second') ?? 0 },
      ref.tz,
    );
    return { type: 'instant', at, tz: ref.tz };
  }
  return { type: 'date', date: formatDate(year, month, day) };
}

function findDates(text: string, ref: ParseRef, exclude: Range[]): DateMatch[] {
  const reference = { instant: new Date(ref.at), timezone: offsetMinutes(ref.tz, ref.at) };
  const dates: DateMatch[] = [];
  for (const r of chrono.casual.parse(text, reference, { forwardDate: true })) {
    // chrono sometimes swallows trailing punctuation ("fri," → "fri").
    const matched = r.text.replace(/[\s.,;:!?)]+$/u, '');
    const span = { start: r.index, end: r.index + matched.length };
    if (exclude.some((x) => overlaps(x, span))) continue;
    // "now" isn't a meaningful due date ("do it now").
    if (r.tags().has('casualReference/now')) continue;
    dates.push({ ...span, text: matched, due: toDue(r, ref) });
  }
  return dates;
}

export function parseText(text: string, ref: ParseRef): ParseResult {
  const urls = findUrls(text);
  const tags = findTags(text, urls);
  const priority = findPriority(text);
  const taken: Range[] = [...urls, ...tags, ...(priority ? [priority] : [])];
  return {
    dates: findDates(text, ref, taken),
    tags,
    priority,
    url: urls[0],
  };
}

// --- Kind inference ---------------------------------------------------------

const NOTE_PREFIX = /^\s*(idea|note|thought)s?\s*:/iu;
const TASK_PREFIX = /^\s*(todo|task)\s*:/iu;
const ACTION_VERBS = new Set([
  'buy', 'call', 'email', 'text', 'pay', 'book', 'fix', 'send', 'pick', 'schedule',
  'finish', 'submit', 'return', 'renew', 'clean', 'order', 'cancel', 'reply', 'write',
  'review', 'check', 'get', 'make', 'ask', 'remind', 'bring', 'take', 'prepare',
  'prep', 'update', 'install', 'visit', 'meet', 'read', 'watch', 'register', 'sign',
]);

/** Text with the given ranges cut out, collapsed to single spaces. */
function without(text: string, ranges: Range[]): string {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  let out = '';
  let pos = 0;
  for (const r of sorted) {
    if (r.start > pos) out += text.slice(pos, r.start);
    pos = Math.max(pos, r.end);
  }
  out += text.slice(pos);
  return out.replace(/\s+/gu, ' ').trim();
}

/**
 * Inference over the values actually applied to an item (after user overrides),
 * so e.g. a user-set due date still makes something a task.
 */
export function inferKind(
  text: string,
  applied: { hasDue: boolean; hasPriority: boolean; url?: Range },
  syntax: Range[],
): Kind {
  if (NOTE_PREFIX.test(text)) return 'note';
  if (TASK_PREFIX.test(text)) return 'task';
  if (applied.hasDue || applied.hasPriority) return 'task';
  const rest = without(text, syntax);
  if (applied.url && rest.split(' ').filter(Boolean).length <= 5) return 'link';
  const firstWord = rest.split(' ')[0]?.toLowerCase().replace(/[^\p{L}]/gu, '');
  if (firstWord && ACTION_VERBS.has(firstWord)) return 'task';
  return applied.url ? 'link' : 'note';
}
