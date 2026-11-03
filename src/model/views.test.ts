import { describe, expect, it } from 'vitest';
import type { Due, Item } from './item';
import { createItem, setDue, setStatus, snooze, softDelete, type Clock } from './items';
import { snoozeUntil } from './snooze';
import { dueDay, everythingView, inboxView, todayView, upcomingView } from './views';

const utc = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);
const TZ = 'Asia/Dhaka';
// Tuesday 3 Nov 2026, 10:00 in Dhaka.
const NOW: Clock = { now: utc(2026, 11, 3, 4), tz: TZ };
const HOUR = 3_600_000;

let n = 0;
/** An item captured a little before NOW, with an optional user-set due date. */
function item(text: string, due?: Due, patch: Partial<Item> = {}): Item {
  const captured = createItem(text, { now: NOW.now - 1000 + n, tz: TZ }, `id${++n}`);
  const dated = due ? setDue(captured, due, NOW) : captured;
  return { ...dated, ...patch };
}
const date = (d: string): Due => ({ type: 'date', date: d });
const at = (ms: number, tz = TZ): Due => ({ type: 'instant', at: ms, zone: { type: 'iana', tz } });
const texts = (items: Item[]) => items.map((i) => i.text);

describe('dueDay', () => {
  it('all-day dates float; timed dates use the viewer zone', () => {
    expect(dueDay(date('2026-11-03'), 'America/New_York')).toBe('2026-11-03');
    // 20:00Z on 3 Nov is 4 Nov in Dhaka, still 3 Nov in New York.
    expect(dueDay(at(utc(2026, 11, 3, 20)), 'Asia/Dhaka')).toBe('2026-11-04');
    expect(dueDay(at(utc(2026, 11, 3, 20)), 'America/New_York')).toBe('2026-11-03');
  });
});

describe('todayView', () => {
  it('splits today from earlier and orders each', () => {
    const items = [
      item('timed later', at(utc(2026, 11, 3, 10))),
      item('timed sooner', at(utc(2026, 11, 3, 5))),
      item('all day', date('2026-11-03')),
      item('yesterday', date('2026-11-02')),
      item('last week', date('2026-10-27')),
      item('tomorrow', date('2026-11-04')),
      item('no date'),
    ];
    const view = todayView(items, NOW);
    expect(texts(view.today)).toEqual(['all day', 'timed sooner', 'timed later']);
    expect(texts(view.earlier)).toEqual(['last week', 'yesterday']);
  });

  it('completed items leave Today immediately', () => {
    const done = setStatus(item('done', date('2026-11-03')), 'done', NOW);
    const overdueDone = setStatus(item('overdue done', date('2026-11-01')), 'done', NOW);
    expect(todayView([done, overdueDone], NOW)).toEqual({ today: [], earlier: [] });
  });

  it('hides archived, deleted, dismissed-date and actively snoozed items', () => {
    const items = [
      item('archived', date('2026-11-03'), { status: 'archived' }),
      softDelete(item('deleted', date('2026-11-03')), NOW),
      setDue(item('dismissed', date('2026-11-03')), null, NOW),
      snooze(item('snoozed', date('2026-11-03')), NOW.now + HOUR, NOW),
      snooze(item('snooze over', date('2026-11-03')), NOW.now - HOUR, NOW),
    ];
    expect(texts(todayView(items, NOW).today)).toEqual(['snooze over']);
  });

  it('uses the viewer timezone for timed items near midnight', () => {
    // 19:00Z on 3 Nov: 01:00 on 4 Nov in Dhaka, 14:00 on 3 Nov in New York.
    const late = item('late call', at(utc(2026, 11, 3, 19)));
    expect(todayView([late], NOW).today).toEqual([]);
    const ny: Clock = { now: utc(2026, 11, 3, 15), tz: 'America/New_York' };
    expect(texts(todayView([late], ny).today)).toEqual(['late call']);
  });

  it('a parsed date counts the same as a user-set one', () => {
    const parsed = createItem('dentist today', NOW, 'p');
    expect(texts(todayView([parsed], NOW).today)).toEqual(['dentist today']);
  });
});

describe('upcomingView', () => {
  it('groups future items by day, ascending, all-day first within a day', () => {
    const items = [
      item('fri timed', at(utc(2026, 11, 6, 3))),
      item('fri all day', date('2026-11-06')),
      item('wed', date('2026-11-04')),
      item('today', date('2026-11-03')),
      item('past', date('2026-11-01')),
      setStatus(item('done wed', date('2026-11-04')), 'done', NOW),
      snooze(item('snoozed wed', date('2026-11-04')), NOW.now + 24 * HOUR, NOW),
    ];
    expect(upcomingView(items, NOW).map((g) => [g.day, texts(g.items)])).toEqual([
      ['2026-11-04', ['wed']],
      ['2026-11-06', ['fri all day', 'fri timed']],
    ]);
  });
});

describe('inboxView', () => {
  it('shows undated, unsnoozed, recent open items newest first', () => {
    const items = [
      item('older'),
      item('newer'),
      item('dated', date('2026-11-04')),
      snooze(item('snoozed'), NOW.now + HOUR, NOW),
      item('ancient', undefined, { capturedAt: NOW.now - 8 * 24 * HOUR }),
    ];
    expect(texts(inboxView(items, NOW))).toEqual(['newer', 'older']);
  });
});

describe('everythingView', () => {
  const items = [
    item('note one'),
    item('buy milk #shop'),
    item('archived', undefined, { status: 'archived' }),
    softDelete(item('deleted'), NOW),
    snooze(item('snoozed thought'), NOW.now + HOUR, NOW),
    { ...setStatus(item('done early'), 'done', NOW), completedAt: NOW.now - 2 * HOUR },
    { ...setStatus(item('done late #shop'), 'done', NOW), completedAt: NOW.now - HOUR },
  ];

  it('lists live, non-archived items (snoozed included) with completed ones apart', () => {
    const view = everythingView(items);
    expect(texts(view.active)).toEqual(['snoozed thought', 'buy milk #shop', 'note one']);
    expect(texts(view.completed)).toEqual(['done late #shop', 'done early']);
  });

  it('filters by tag and kind', () => {
    expect(texts(everythingView(items, { tag: 'shop' }).active)).toEqual(['buy milk #shop']);
    expect(texts(everythingView(items, { tag: 'shop' }).completed)).toEqual(['done late #shop']);
    expect(texts(everythingView(items, { kind: 'task' }).active)).toEqual(['buy milk #shop']);
  });
});

describe('snoozeUntil', () => {
  const dhaka = (h: number, mi = 0, d = 3) => utc(2026, 11, d, h - 6, mi);

  it.each<[string, Clock, number]>([
    ['later today: +3h rounded up to the hour', NOW, dhaka(13)],
    ['later today: exact hours stay', { now: dhaka(10, 0), tz: TZ }, dhaka(13)],
    ['later today: rounds up partial hours', { now: dhaka(10, 20), tz: TZ }, dhaka(14)],
  ])('%s', (_name, clock, expected) => {
    expect(snoozeUntil('laterToday', clock)).toBe(expected);
  });

  it('tomorrow is 09:00 tomorrow in the viewer zone', () => {
    expect(snoozeUntil('tomorrow', NOW)).toBe(dhaka(9, 0, 4));
  });

  it.each<[string, number, number]>([
    ['from Tuesday', dhaka(10, 0, 3), dhaka(9, 0, 9)],
    ['from Sunday', dhaka(10, 0, 8), dhaka(9, 0, 9)],
    ['from Monday: a week ahead', dhaka(10, 0, 9), dhaka(9, 0, 16)],
  ])('next week is Monday 09:00 %s', (_name, now, expected) => {
    expect(snoozeUntil('nextWeek', { now, tz: TZ })).toBe(expected);
  });

  it('tomorrow morning respects DST in the viewer zone', () => {
    // Sat 31 Oct, New York (EDT). Sunday 09:00 is EST = 14:00Z.
    expect(snoozeUntil('tomorrow', { now: utc(2026, 10, 31, 16), tz: 'America/New_York' })).toBe(
      utc(2026, 11, 1, 14),
    );
  });

  it('snoozing changes neither the due date nor capturedAt', () => {
    const dated = createItem('dentist tomorrow', NOW, 's');
    const snoozed = snooze(dated, snoozeUntil('nextWeek', NOW), NOW);
    expect(snoozed.due).toEqual(dated.due);
    expect(snoozed.capturedAt).toBe(dated.capturedAt);
  });
});
