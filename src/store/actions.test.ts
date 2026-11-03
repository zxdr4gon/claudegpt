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

const SEED = 'call dentist monday 3pm #health #teeth !!';

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
    ['remove priority', () => actions.setPriority(null)],
  ];

  it.each(cases)('%s', async (_name, make) => {
    const { id } = await store.capture(SEED);
    const before = await snapshot(id);
    now += HOUR;

    const after = await perform(store, undo, id, make());
    expect(sameRecord(after, before.record)).toBe(false);

    now += HOUR;
    expect(await undo.undo(store)).toMatchObject({ restored: true });
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
    expect(await undo.undo(store)).toBeUndefined();
  });

  it('a double-clicked undo applies once', async () => {
    const { id } = await store.capture(SEED);
    const v0 = await db.items.get(id);
    await perform(store, undo, id, actions.addTag('a'));
    await perform(store, undo, id, actions.complete());
    // Both start before either finishes.
    const [first, second] = await Promise.all([undo.undo(store), undo.undo(store)]);
    expect(first).toMatchObject({ label: 'Completed', restored: true });
    // The second click takes the next entry instead of re-applying the first.
    expect(second).toMatchObject({ label: 'Added #a', restored: true });
    expect(sameRecord(await db.items.get(id), v0)).toBe(true);
    expect(undo.latest()).toBeUndefined();
  });

  it('undoing an older change is refused once the item changed again', async () => {
    const { id } = await store.capture(SEED);
    await perform(store, undo, id, actions.complete());
    const entry = undo.latest()!;
    await perform(store, undo, id, actions.editText('newer edit'));
    const newest = await db.items.get(id);
    expect(await undo.undoEntry(store, entry)).toEqual({ label: 'Completed', restored: false });
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
    if (undone?.restored) {
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
    expect(await undo.undo(store)).toMatchObject({ restored: false });
    expect(await db.items.get(id)).toBeUndefined();
  });

  it('no-op actions are not recorded', async () => {
    const { id } = await store.capture(SEED);
    await perform(store, undo, id, actions.reopen()); // already open
    expect(undo.latest()).toBeUndefined();
  });

  it('notifies subscribers when the stack changes', async () => {
    const { id } = await store.capture(SEED);
    let calls = 0;
    const off = undo.subscribe(() => calls++);
    await perform(store, undo, id, actions.complete());
    await undo.undo(store);
    off();
    await perform(store, undo, id, actions.complete());
    expect(calls).toBe(2);
  });
});

describe('snoozeAtLocal (Pick date/time)', () => {
  const c: Clock = { now: START, tz: 'Asia/Dhaka' };
  it('reads the value in the viewer zone', () => {
    expect(snoozeAtLocal('2026-11-03T09:30', c)).toBe(Date.UTC(2026, 10, 3, 3, 30));
  });
  it.each(['2026-11-02T09:00', '', 'tomorrow', '2026-11-03 09:30'])('rejects %j (past or malformed)', (v) => {
    expect(snoozeAtLocal(v, c)).toBeNull();
  });
});
