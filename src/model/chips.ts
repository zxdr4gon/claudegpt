// What an item's chips show (DECISIONS #6, #13, #19). Pure, so the rules for
// provenance and dismissed values are tested apart from the UI.

import { parseText } from '../parser/parse';
import { localToInstant, isCalendarDate } from '../parser/time';
import type { Due, Item, Kind, Priority, Provenance } from './item';

export type ChipField = 'kind' | 'due' | 'tag' | 'priority' | 'url';

export type Chip = {
  key: string;
  field: ChipField;
  source: Provenance;
  /**
   * The user removed this value and the text still contains it. Shown struck
   * through so the removal is visible and can be undone with "restore".
   */
  dismissed: boolean;
  /** For tags: the tag. For dismissed values: the text that was detected. */
  text?: string;
  due?: Due;
  priority?: Priority;
  url?: string;
  kind?: Kind;
};

/**
 * Chips for a saved item. `includeKind` adds the kind chip (rows show it so it
 * can be corrected; the capture preview doesn't).
 */
export function chipsFor(item: Item, options: { includeKind?: boolean } = {}): Chip[] {
  const chips: Chip[] = [];
  // What the text says right now, to decide whether a dismissal is still relevant.
  let detected: ReturnType<typeof parseText> | undefined;
  const parse = () => (detected ??= parseText(item.text, item.textRef));

  if (options.includeKind) {
    chips.push({ key: 'kind', field: 'kind', source: item.kind.source, dismissed: false, kind: item.kind.value! });
  }

  if (item.due?.value) {
    chips.push({ key: 'due', field: 'due', source: item.due.source, dismissed: false, due: item.due.value });
  } else if (item.due?.source === 'user') {
    const date = parse().dates[0];
    if (date) chips.push({ key: 'due', field: 'due', source: 'user', dismissed: true, text: date.text });
  }

  for (const tag of item.tags) {
    if (!tag.dismissed) {
      chips.push({ key: `tag:${tag.value}`, field: 'tag', source: tag.source, dismissed: false, text: tag.value });
    } else if (parse().tags.some((t) => t.value === tag.value)) {
      chips.push({ key: `tag:${tag.value}`, field: 'tag', source: 'user', dismissed: true, text: tag.value });
    }
  }

  if (item.priority?.value) {
    chips.push({ key: 'priority', field: 'priority', source: item.priority.source, dismissed: false, priority: item.priority.value });
  } else if (item.priority?.source === 'user') {
    const p = parse().priority;
    if (p) chips.push({ key: 'priority', field: 'priority', source: 'user', dismissed: true, text: '!'.repeat(p.value) });
  }

  if (item.url?.value) {
    chips.push({ key: 'url', field: 'url', source: item.url.source, dismissed: false, url: item.url.value });
  } else if (item.url?.source === 'user') {
    const u = parse().url;
    if (u) chips.push({ key: 'url', field: 'url', source: 'user', dismissed: true, text: u.value });
  }

  return chips;
}

/**
 * A due date from the date editor's fields, in the viewer's zone. No time
 * means all-day. Null if the date or time doesn't exist.
 */
export function dueFromInputs(date: string, time: string, tz: string): Due | null {
  if (!isCalendarDate(date)) return null;
  if (!time) return { type: 'date', date };
  const at = localToInstant(date, time, tz);
  return at == null ? null : { type: 'instant', at, zone: { type: 'iana', tz } };
}
