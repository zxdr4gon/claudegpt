import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type CaptureDb } from '../db';
import type { Clock } from '../model/items';
import { snoozeAtLocal } from '../model/snooze';
import { actions, perform, type Action } from './actions';
import { ItemStore, sameRecord } from './store';
import { UndoStack } from './undo';

const HOUR = 3_600_000;
const START = Date.UTC(2026, 10, 2, 4); // Mon 2 Nov 2026, 10:00 Dhaka

let n = 0;
let db: CaptureDb;
let store: ItemStore;
let undo: UndoStack;
let now: number;
const clock = (): Clock => ({ now, tz: 'Asia/Dhaka' });

beforeEach(async () => {
  db = openDb(`actions-${++n}`);
  now = START;
  store = await ItemStore.open(db, clock);
  undo = new UndoStack();
});
afterEach(async () => {
  await db.delete();
});

/** The stored record and what search finds, for exact before/after comparison. */
async function snapshot(id: string) {
  const record = await db.items.get(id);
  return { record, searchIds: store.index.search('dentist health monday', { includeArchived: true }) };
}

const SEED = 'call dentist monday 3pm #health #teeth !! https://example.com/dentist';

describe('each action, then undo, restores the exact previous record and search entry', () => {
  const cases: [string, () => Action][] = [
    ['complete', actions.complete],
    ['archive', actions.archive],
    ['delete', actions.remove],
    ['snooze', () => actions.snooze(START + 5 * HOUR)],
    ['edit text', () => actions.editText('call the dentist monday 4pm #teeth')],
    ['remove a parsed tag', () => actions.removeTag('health')],
    ['add a tag', () => actions.addTag('errands')],
    ['set a due date', () => actions.setDue({ type: 'date', date: '2026-12-01' })],
    ['dismiss the due date', () => actions.setDue(null)],
    ['change kind', () => actions.setKind('note')],
    ['change priority', () => actions.setPriority(3)],
    ['remove the link', () => actions.setUrl(null)],
    ['reset a user-set field', () => actions.resetField('kind')],
    ['remove priority', () => actions.setPriority(null)],
  ];

  it.each(cases)('%s', async (_name, make) => {
    const { id } = await store.capture(SEED);
    const before = await snapshot(id);
    now += HOUR;

    const after = await perform(store, undo, id, make());
    expect(sameRecord(after, before.record)).toBe(false);

    now += HOUR;
    expect(await undo.undo(store)).toMatchObject({ kind: 'restored' });
    const restored = await snapshot(id);
    expect(sameRecord(restored.record, before.record)).toBe(true);
    // Timestamps included: undo is a restore, not a new edit.
    expect(restored.record?.updatedAt).toBe(START);
    expect(restored.searchIds).toEqual(before.searchIds);
  });

  it('reset-to-detected after a correction, then undo, restores the correction', async () => {
    const { id } = await store.capture(SEED);
    await perform(store, undo, id, actions.removeTag('health'));
    const corrected = await snapshot(id);
    await perform(store, undo, id, actions.resetTag('health'));
    await undo.undo(store);
    expect(sameRecord((await snapshot(id)).record, corrected.record)).toBe(true);
  });

  it('delete then undo makes the item searchable again', async () => {
    const { id } = await store.capture(SEED);
    await perform(store, undo, id, actions.remove());
    expect(store.index.search('dentist')).toEqual([]);
    await undo.undo(store);
    expect(store.index.search('dentist')).toEqual([id]);
  });

  it('edit then undo restores text, metadata, spans and provenance', async () => {
    const { id } = await store.capture(SEED);
    const original = (await db.items.get(id))!;
    await perform(store, undo, id, actions.removeTag('teeth')); // user-owned dismissal
    const withDismissal = (await db.items.get(id))!;
    now += HOUR;
    await perform(store, undo, id, actions.editText('totally different'));
    await undo.undo(store);
    const back = (await db.items.get(id))!;
    expect(sameRecord(back, withDismissal)).toBe(true);
    expect(back.tags).toEqual([
      { value: 'teeth', source: 'user', dismissed: true },
      { value: 'health', source: 'parsed' },
    ]);
    expect(back.spans).toEqual(withDismissal.spans);
    expect(store.index.search('totally')).toEqual([]);
    await undo.undo(store);
    expect(sameRecord(await db.items.get(id), original)).toBe(true);
  });
});

describe('undo under rapid interactions', () => {
  it('undoes in reverse order, one change at a time', async () => {
    const { id } = await store.capture(SEED);
    const v0 = await db.items.get(id);
    await perform(store, undo, id, actions.addTag('a'));
    const v1 = await db.items.get(id);
    await perform(store, undo, id, actions.complete());
    await undo.undo(store);
    expect(sameRecord(await db.items.get(id), v1)).toBe(true);
    await undo.undo(store);
    expect(sameRecord(await db.items.get(id), v0)).toBe(true);
    expect(await undo.undo(store)).toEqual({ kind: 'empty' });
  });

  it('a double-clicked undo applies once', async () => {
    const { id } = await store.capture(SEED);
    const v0 = await db.items.get(id);
    await perform(store, undo, id, actions.addTag('a'));
    await perform(store, undo, id, actions.complete());
    // Both start before either finishes.
    const [first, second] = await Promise.all([undo.undo(store), undo.undo(store)]);
    expect(first).toEqual({ kind: 'restored', label: 'Completed' });
    // The second click takes the next entry instead of re-applying the first.
    expect(second).toEqual({ kind: 'restored', label: 'Added #a' });
    expect(sameRecord(await db.items.get(id), v0)).toBe(true);
    expect(undo.latest()).toBeUndefined();
  });

  it('undoing an older change is refused once the item changed again', async () => {
    const { id } = await store.capture(SEED);
    await perform(store, undo, id, actions.complete());
    const entry = undo.latest()!;
    await perform(store, undo, id, actions.editText('newer edit'));
    const newest = await db.items.get(id);
    expect(await undo.undoEntry(store, entry)).toEqual({ kind: 'refused', label: 'Completed' });
    expect(sameRecord(await db.items.get(id), newest)).toBe(true);
    expect(store.index.search('newer')).toEqual([id]);
  });

  it('an undo racing a new action never mixes the two', async () => {
    const { id } = await store.capture(SEED);
    await perform(store, undo, id, actions.complete());
    const completed = await db.items.get(id);
    const [, undone] = await Promise.all([
      perform(store, undo, id, actions.editText('raced edit')),
      undo.undoEntry(store, undo.latest()!),
    ]);
    const final = (await db.items.get(id))!;
    if (undone.kind === 'restored') {
      // The undo ran first: the edit then applied on top of the restored record.
      expect(final.text).toBe('raced edit');
      expect(final.status).toBe('open');
    } else {
      // The edit ran first: the undo was refused and the edit stands untouched.
      expect(final.text).toBe('raced edit');
      expect(final.status).toBe(completed!.status);
    }
    expect(store.index.search('raced')).toEqual([id]);
  });

  it('undo after the item was deleted elsewhere is refused', async () => {
    const { id } = await store.capture(SEED);
    await perform(store, undo, id, actions.complete());
    await db.items.delete(id);
    expect(await undo.undo(store)).toEqual({ kind: 'refused', label: 'Completed' });
    expect(await db.items.get(id)).toBeUndefined();
  });

  it('every attempt reports an outcome, including nothing to undo', async () => {
    expect(await undo.undo(store)).toEqual({ kind: 'empty' });
    expect(undo.outcome()).toEqual({ kind: 'empty' });
    const { id } = await store.capture(SEED);
    await perform(store, undo, id, actions.complete());
    await undo.undo(store);
    expect(undo.outcome()).toEqual({ kind: 'restored', label: 'Completed' });
  });

  it('a failed restore is reported and the entry stays undoable', async () => {
    const { id } = await store.capture(SEED);
    await perform(store, undo, id, actions.complete());
    const broken = { revert: async () => Promise.reject(new Error('disk full')) } as unknown as ItemStore;
    expect(await undo.undo(broken)).toEqual({ kind: 'failed', label: 'Completed' });
    expect(undo.latest()?.label).toBe('Completed');
    // Retrying with a working store succeeds.
    expect(await undo.undo(store)).toEqual({ kind: 'restored', label: 'Completed' });
    expect((await db.items.get(id))?.status).toBe('open');
  });

  it('no-op actions are not recorded', async () => {
    const { id } = await store.capture(SEED);
    await perform(store, undo, id, actions.reopen()); // already open
    expect(undo.latest()).toBeUndefined();
  });

  it('recent() follows pushes only, so undo never resurfaces an older entry', async () => {
    const { id } = await store.capture(SEED);
    await perform(store, undo, id, actions.addTag('a'));
    await perform(store, undo, id, actions.complete());
    const completed = undo.recent();
    await undo.undo(store);
    expect(undo.recent()).toBe(completed);
    expect(undo.latest()?.label).toBe('Added #a');
  });

  it('notifies subscribers when the stack changes', async () => {
    const { id } = await store.capture(SEED);
    let calls = 0;
    const off = undo.subscribe(() => calls++);
    await perform(store, undo, id, actions.complete());
    await undo.undo(store);
    off();
    await perform(store, undo, id, actions.complete());
    // push, then the undo: entry taken off the stack, outcome reported.
    expect(calls).toBe(3);
  });
});

describe('snoozeAtLocal (Pick date/time)', () => {
  const c: Clock = { now: START, tz: 'Asia/Dhaka' };
  it('reads the value in the viewer zone', () => {
    expect(snoozeAtLocal('2026-11-03T09:30', c)).toBe(Date.UTC(2026, 10, 3, 3, 30));
  });
  it.each([
    ['in the past', '2026-11-02T09:00'],
    ['empty', ''],
    ['words', 'tomorrow'],
    ['space instead of T', '2026-11-03 09:30'],
    ['February 31', '2027-02-31T10:00'],
    ['February 29 in a common year', '2027-02-29T10:00'],
    ['month 13', '2027-13-01T10:00'],
    ['day 0', '2027-01-00T10:00'],
    ['hour 24', '2026-12-01T24:00'],
    ['hour 25', '2026-12-01T25:00'],
    ['minute 60', '2026-12-01T10:60'],
    ['seconds included', '2026-12-01T10:00:00'],
  ])('rejects %s (%j)', (_name, v) => {
    expect(snoozeAtLocal(v, c)).toBeNull();
  });

  it('accepts a leap day', () => {
    expect(snoozeAtLocal('2028-02-29T10:00', c)).toBe(Date.UTC(2028, 1, 29, 4));
  });

  describe('DST behaviour stays explicit (New York)', () => {
    const ny: Clock = { now: Date.UTC(2026, 0, 1), tz: 'America/New_York' };
    it('a time in the spring-forward gap shifts forward by the gap', () => {
      // 02:30 doesn't exist on 8 Mar 2026; it becomes 03:30 EDT = 07:30Z.
      expect(snoozeAtLocal('2026-03-08T02:30', ny)).toBe(Date.UTC(2026, 2, 8, 7, 30));
    });
    it('a repeated fall-back time takes the earlier occurrence', () => {
      // 01:30 happens twice on 1 Nov 2026; the first is 01:30 EDT = 05:30Z.
      expect(snoozeAtLocal('2026-11-01T01:30', ny)).toBe(Date.UTC(2026, 10, 1, 5, 30));
    });
  });
});
