// What each view shows (PRODUCT "MVP views", DECISIONS #11, #17). Pure
// functions over a list of items, evaluated for the viewer's clock.

import { dateIn } from '../parser/time';
import { isInInbox } from './inbox';
import { activeTags, type Due, type Item, type Kind } from './item';
import type { Clock } from './items';

const isSnoozed = (item: Item, now: number) => item.snoozedUntil != null && item.snoozedUntil > now;
const isLive = (item: Item) => item.deletedAt == null;

/**
 * The calendar day a due date falls on for this viewer. All-day dates are
 * floating; timed ones are converted to the viewer's zone.
 */
export function dueDay(due: Due, tz: string): string {
  return due.type === 'date' ? due.date : dateIn(due.at, tz);
}

/** Within a day: all-day items first ("any time today"), then by time. */
function compareDue(a: Item, b: Item): number {
  const da = a.due!.value!;
  const db = b.due!.value!;
  if (da.type === 'date' && db.type === 'date') return a.capturedAt - b.capturedAt;
  if (da.type === 'date') return -1;
  if (db.type === 'date') return 1;
  return da.at - db.at || a.capturedAt - b.capturedAt;
}

const newestFirst = (a: Item, b: Item) => b.capturedAt - a.capturedAt;

/** Open, live, not snoozed, with a due date. */
function scheduled(items: Item[], now: number): Item[] {
  return items.filter(
    (i) => isLive(i) && i.status === 'open' && i.due?.value != null && !isSnoozed(i, now),
  );
}

export function inboxView(items: Item[], clock: Clock): Item[] {
  return items.filter((i) => isInInbox(i, clock.now)).sort(newestFirst);
}

export type TodayView = {
  /**
   * Due today, all-day first, then by time — including timed items whose time
   * today has already passed. They stay here until the day ends.
   */
  today: Item[];
  /** Open items due on previous days, oldest first. Shown collapsed and neutral. */
  earlier: Item[];
};

export function todayView(items: Item[], clock: Clock): TodayView {
  const today = dateIn(clock.now, clock.tz);
  const result: TodayView = { today: [], earlier: [] };
  for (const item of scheduled(items, clock.now)) {
    const day = dueDay(item.due!.value!, clock.tz);
    if (day === today) result.today.push(item);
    else if (day < today) result.earlier.push(item);
  }
  result.today.sort(compareDue);
  result.earlier.sort((a, b) => {
    const da = dueDay(a.due!.value!, clock.tz);
    const db = dueDay(b.due!.value!, clock.tz);
    return da < db ? -1 : da > db ? 1 : compareDue(a, b);
  });
  return result;
}

export type DayGroup = { day: string; items: Item[] };

/** Due after today, grouped by day in ascending order. */
export function upcomingView(items: Item[], clock: Clock): DayGroup[] {
  const today = dateIn(clock.now, clock.tz);
  const byDay = new Map<string, Item[]>();
  for (const item of scheduled(items, clock.now)) {
    const day = dueDay(item.due!.value!, clock.tz);
    if (day <= today) continue;
    const group = byDay.get(day);
    if (group) group.push(item);
    else byDay.set(day, [item]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([day, group]) => ({ day, items: group.sort(compareDue) }));
}

export type EverythingFilter = { kind?: Kind; tag?: string };
export type EverythingView = { active: Item[]; completed: Item[] };

/** Every live, non-archived item, newest capture first; snoozed items included. */
export function everythingView(items: Item[], filter: EverythingFilter = {}): EverythingView {
  const result: EverythingView = { active: [], completed: [] };
  for (const item of items) {
    if (!isLive(item) || item.status === 'archived') continue;
    if (filter.kind && item.kind.value !== filter.kind) continue;
    if (filter.tag && !activeTags(item).includes(filter.tag)) continue;
    (item.status === 'done' ? result.completed : result.active).push(item);
  }
  result.active.sort(newestFirst);
  result.completed.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  return result;
}
