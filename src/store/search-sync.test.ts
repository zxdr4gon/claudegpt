import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type CaptureDb } from '../db';
import type { Clock } from '../model/items';
import { actions, perform } from './actions';
import { exportBackup, importBackup } from './backup';
import { DELETE_RETENTION_MS, ItemStore } from './store';
import { UndoStack } from './undo';

const DAY = 86_400_000;
let n = 0;
let now = Date.UTC(2026, 10, 2, 4);
const clock = (): Clock => ({ now, tz: 'Asia/Dhaka' });
const open: { db: CaptureDb; store: ItemStore }[] = [];

async function tab(name: string) {
  const db = openDb(name);
  const store = await ItemStore.open(db, clock);
  open.push({ db, store });
  return store;
}

beforeEach(() => {
  now = Date.UTC(2026, 10, 2, 4);
});
afterEach(async () => {
  for (const { db, store } of open.splice(0)) {
    store.close();
    db.close();
  }
});

describe('search reflects every transition immediately (same tab)', () => {
  let store: ItemStore;
  let undo: UndoStack;
  let id: string;
  const find = (q: string, includeArchived = false) => store.index.search(q, { includeArchived });

  beforeEach(async () => {
    store = await tab(`sync-${++n}`);
    undo = new UndoStack();
    ({ id } = await store.capture('call dentist tomorrow #health'));
  });

  it('edit: old words stop matching, new words match; undo swaps back', async () => {
    await perform(store, undo, id, actions.editText('email orthodontist tomorrow #health'));
    expect(find('dentist')).toEqual([]);
    expect(find('orthodontist')).toEqual([id]);
    await undo.undo(store);
    expect(find('dentist')).toEqual([id]);
    expect(find('orthodontist')).toEqual([]);
  });

  it('correction: an added tag matches, a removed one stops matching', async () => {
    await perform(store, undo, id, actions.addTag('urgent'));
    expect(find('urgent')).toEqual([id]);
    await perform(store, undo, id, actions.removeTag('urgent'));
    expect(find('urgent')).toEqual([]);
    await undo.undo(store);
    expect(find('urgent')).toEqual([id]);
  });

  it('archive hides from default search; unarchive and undo bring it back', async () => {
    await perform(store, undo, id, actions.archive());
    expect(find('dentist')).toEqual([]);
    expect(find('dentist', true)).toEqual([id]);
    await undo.undo(store);
    expect(find('dentist')).toEqual([id]);
  });

  it('delete removes from search; undo (restore) brings it back', async () => {
    await perform(store, undo, id, actions.remove());
    expect(find('dentist', true)).toEqual([]);
    await undo.undo(store);
    expect(find('dentist')).toEqual([id]);
  });

  it('completed items stay searchable', async () => {
    await perform(store, undo, id, actions.complete());
    expect(find('dentist')).toEqual([id]);
  });

  it('notifies subscribers on every index change, and not for no-ops', async () => {
    let calls = 0;
    const off = store.index.subscribe(() => calls++);
    await perform(store, undo, id, actions.complete());
    await perform(store, undo, id, actions.complete()); // already done: no-op
    await undo.undo(store);
    off();
    expect(calls).toBe(2);
  });
});

describe('cross-tab index sync', () => {
  // Two stores on one database stand in for two tabs; they talk over a real BroadcastChannel.
  let a: ItemStore;
  let b: ItemStore;
  const inB = (q: string, includeArchived = false) => b.index.search(q, { includeArchived });

  beforeEach(async () => {
    const name = `tabs-${++n}`;
    a = await tab(name);
    b = await tab(name);
  });

  it('a capture in one tab is searchable in the other without reload', async () => {
    const { id } = await a.capture('quarterly report #work');
    await vi.waitFor(() => expect(inB('quarterly')).toEqual([id]));
  });

  it('edits, archive, delete and undo all reach the other tab', async () => {
    const undo = new UndoStack();
    const { id } = await a.capture('call dentist');
    await vi.waitFor(() => expect(inB('dentist')).toEqual([id]));

    await perform(a, undo, id, actions.editText('call orthodontist'));
    await vi.waitFor(() => expect(inB('orthodontist')).toEqual([id]));
    expect(inB('dentist')).toEqual([]);

    await perform(a, undo, id, actions.archive());
    await vi.waitFor(() => expect(inB('orthodontist')).toEqual([]));
    expect(inB('orthodontist', true)).toEqual([id]);

    await perform(a, undo, id, actions.remove());
    await vi.waitFor(() => expect(inB('orthodontist', true)).toEqual([]));

    await undo.undo(a); // undelete
    await vi.waitFor(() => expect(inB('orthodontist', true)).toEqual([id]));
  });

  it('works in both directions', async () => {
    const { id } = await b.capture('garden plans');
    await vi.waitFor(() => expect(a.index.search('garden')).toEqual([id]));
  });

  it('an import in one tab rebuilds the other tab’s index', async () => {
    const source = await tab(`source-${++n}`);
    await source.capture('imported thought');
    const backup = await exportBackup(source, now);
    await importBackup(a, backup);
    await vi.waitFor(() => expect(inB('imported')).toHaveLength(1));
  });

  it('purging keeps both tabs consistent', async () => {
    const undo = new UndoStack();
    const { id } = await a.capture('old note');
    await perform(a, undo, id, actions.remove());
    now += DELETE_RETENTION_MS + DAY;
    expect(await a.purgeDeleted()).toBe(1);
    await vi.waitFor(() => expect(inB('old', true)).toEqual([]));
  });

  it('a closed tab stops listening', async () => {
    b.close();
    await a.capture('after close');
    await new Promise((r) => setTimeout(r, 50));
    expect(inB('close')).toEqual([]);
  });
});
