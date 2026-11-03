// Item lifecycle: capture, text edits, re-parsing and user corrections.
// Every function is pure and returns a new item; persistence is the caller's job.
//
// Merge rules (DECISIONS #6, #7, #14):
// - User-owned values, including dismissals, are never modified by parsing.
// - Parsed values are recomputed from the current text; ones no longer found are removed.
// - A parsed due date whose expression survived an edit untouched keeps its
//   original reference time. New or changed expressions use the edit time.

import { ulid } from 'ulid';
import { inferKind, parseText, PARSER_VERSION, type Range } from '../parser/parse';
import { trackRange } from '../parser/track';
import type { Due, DueField, Field, Item, Kind, ParseRef, Priority, Span } from './item';

export type Clock = { now: number; tz: string };

type Derived = Pick<Item, 'kind' | 'due' | 'priority' | 'url' | 'tags' | 'spans' | 'parserVersion'>;

const isUser = (f: { source: string } | undefined) => f?.source === 'user';

/**
 * Recompute parsed values for `text`, keeping user-owned ones.
 * `prev` is the item before the change (with its old text), if any.
 */
function derive(
  text: string,
  textRef: ParseRef,
  user: Pick<Item, 'kind' | 'due' | 'priority' | 'url' | 'tags'> | undefined,
  prev: Pick<Item, 'text' | 'due' | 'spans'> | undefined,
): Derived {
  const parsed = parseText(text, textRef);
  const spans: Span[] = [];
  const syntax: Range[] = [...parsed.tags, ...parsed.dates];
  if (parsed.priority) syntax.push(parsed.priority);
  if (parsed.url) syntax.push(parsed.url);

  // Due date
  let due: DueField | undefined;
  if (user?.due && isUser(user.due)) {
    due = user.due;
  } else if (parsed.dates[0]) {
    const primary = parsed.dates[0];
    due = { value: primary.due, source: 'parsed', ref: textRef };
    const kept = prev && keptDue(prev, text, primary);
    if (kept) due = kept;
    spans.push({ start: primary.start, end: primary.end, field: 'due' });
  }

  // Priority
  let priority: Field<Priority> | undefined;
  if (user?.priority && isUser(user.priority)) priority = user.priority;
  else if (parsed.priority) {
    priority = { value: parsed.priority.value, source: 'parsed' };
    spans.push({ start: parsed.priority.start, end: parsed.priority.end, field: 'priority' });
  }

  // URL
  let url: Field<string> | undefined;
  let urlRange: Range | undefined;
  if (user?.url && isUser(user.url)) url = user.url;
  else if (parsed.url) {
    url = { value: parsed.url.value, source: 'parsed' };
    urlRange = parsed.url;
    spans.push({ start: parsed.url.start, end: parsed.url.end, field: 'url' });
  }

  // Tags: user entries win per tag; parsed tags fill in the rest.
  const userTags = (user?.tags ?? []).filter(isUser);
  const owned = new Set(userTags.map((t) => t.value));
  const tags = [...userTags];
  for (const t of parsed.tags) {
    if (owned.has(t.value)) continue;
    if (!tags.some((x) => x.value === t.value)) tags.push({ value: t.value, source: 'parsed' });
    spans.push({ start: t.start, end: t.end, field: 'tag' });
  }

  // Kind, inferred from what is actually applied.
  const kind: Field<Kind> =
    user?.kind && isUser(user.kind)
      ? user.kind
      : {
          value: inferKind(
            text,
            { hasDue: due?.value != null, hasPriority: priority?.value != null, url: urlRange },
            syntax,
          ),
          source: 'parsed',
        };

  spans.sort((a, b) => a.start - b.start);
  return { kind, due, priority, url, tags, spans, parserVersion: PARSER_VERSION };
}

/**
 * If the previous parsed due date came from an expression that is still the
 * primary date, untouched by the edit, re-resolve it against its original
 * reference so it doesn't move.
 */
function keptDue(
  prev: Pick<Item, 'text' | 'due' | 'spans'>,
  text: string,
  primary: Range & { text: string },
): DueField | undefined {
  if (!prev.due || prev.due.source !== 'parsed' || !prev.due.ref) return undefined;
  const oldSpan = prev.spans.find((s) => s.field === 'due');
  if (!oldSpan) return undefined;
  const moved = trackRange(prev.text, text, oldSpan);
  if (!moved || moved.start !== primary.start || moved.end !== primary.end) return undefined;

  const ref = prev.due.ref;
  const again = parseText(text, ref).dates.find((d) => d.start === primary.start && d.end === primary.end);
  return { value: again?.due ?? prev.due.value, source: 'parsed', ref };
}

export function createItem(text: string, clock: Clock, id: string = ulid(clock.now)): Item {
  const textRef = { at: clock.now, tz: clock.tz };
  return {
    id,
    rawText: text,
    text,
    textRef,
    ...derive(text, textRef, undefined, undefined),
    status: 'open',
    capturedAt: clock.now,
    createdAt: clock.now,
    updatedAt: clock.now,
  };
}

/** The user changed the text. New or changed date expressions resolve from now. */
export function editText(item: Item, text: string, clock: Clock): Item {
  if (text === item.text) return item;
  const textRef = { at: clock.now, tz: clock.tz };
  return { ...item, text, textRef, ...derive(text, textRef, item, item), updatedAt: clock.now };
}

/**
 * Re-run the parser over unchanged text (e.g. after a parser upgrade or a reset).
 * Uses only stored references, so the result never depends on the current time.
 */
export function reparse(item: Item): Item {
  return { ...item, ...derive(item.text, item.textRef, item, item) };
}

function touch(item: Item, clock: Clock, patch: Partial<Item>): Item {
  return reparse({ ...item, ...patch, updatedAt: clock.now });
}

// --- User corrections --------------------------------------------------------

export const setKind = (item: Item, kind: Kind, clock: Clock) =>
  touch(item, clock, { kind: { value: kind, source: 'user' } });

/** `null` removes the due date and blocks it from being re-detected. */
export const setDue = (item: Item, due: Due | null, clock: Clock) =>
  touch(item, clock, { due: { value: due, source: 'user' } });

export const setPriority = (item: Item, priority: Priority | null, clock: Clock) =>
  touch(item, clock, { priority: { value: priority, source: 'user' } });

export const setUrl = (item: Item, url: string | null, clock: Clock) =>
  touch(item, clock, { url: { value: url, source: 'user' } });

const normalizeTag = (value: string) => value.replace(/^#/u, '').trim().toLowerCase();

export function addTag(item: Item, value: string, clock: Clock): Item {
  const tag = normalizeTag(value);
  if (!tag) return item;
  const existing = item.tags.find((t) => t.value === tag);
  if (existing && !existing.dismissed) return item;
  const tags = item.tags.filter((t) => t.value !== tag);
  tags.push({ value: tag, source: 'user' });
  return touch(item, clock, { tags });
}

/** Leaves a dismissed marker so the tag isn't re-detected from the text. */
export function removeTag(item: Item, value: string, clock: Clock): Item {
  const tag = normalizeTag(value);
  const tags = item.tags.filter((t) => t.value !== tag);
  tags.push({ value: tag, source: 'user', dismissed: true });
  return touch(item, clock, { tags });
}

/** Drop a user correction and go back to whatever the text says. */
export function resetField(item: Item, field: 'kind' | 'due' | 'priority' | 'url', clock: Clock): Item {
  const patch: Partial<Item> = { [field]: undefined };
  // `kind` is required; a placeholder parsed value is replaced by reparse.
  if (field === 'kind') patch.kind = { value: item.kind.value, source: 'parsed' };
  return touch(item, clock, patch);
}

export function resetTag(item: Item, value: string, clock: Clock): Item {
  const tag = normalizeTag(value);
  return touch(item, clock, { tags: item.tags.filter((t) => t.value !== tag) });
}

// --- Status ------------------------------------------------------------------
// These don't touch text or parsed values, so no re-parse.

export function setStatus(item: Item, status: Item['status'], clock: Clock): Item {
  if (item.status === status) return item;
  return {
    ...item,
    status,
    completedAt: status === 'done' ? clock.now : undefined,
    updatedAt: clock.now,
  };
}

/** `null` clears the snooze. */
export function snooze(item: Item, until: number | null, clock: Clock): Item {
  return { ...item, snoozedUntil: until ?? undefined, updatedAt: clock.now };
}

export function softDelete(item: Item, clock: Clock): Item {
  if (item.deletedAt != null) return item;
  return { ...item, deletedAt: clock.now, updatedAt: clock.now };
}

export function restore(item: Item, clock: Clock): Item {
  if (item.deletedAt == null) return item;
  return { ...item, deletedAt: undefined, updatedAt: clock.now };
}
