import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type CaptureDb } from '../db';
import type { Item } from '../model/item';
import { addTag, removeTag, setDue, type Clock } from '../model/items';
import { PARSER_VERSION } from '../parser/parse';
import { BackupFormatError, exportBackup, importBackup } from './backup';
import { DELETE_RETENTION_MS, ItemNotFoundError, ItemStore } from './store';

const DAY = 24 * 60 * 60 * 1000;
const START = Date.UTC(2026, 10, 2, 4); // Mon 2 Nov 2026, 10:00 Dhaka

let dbCount = 0;
let db: CaptureDb;
let now: number;
const clock = (): Clock => ({ now, tz: 'Asia/Dhaka' });
const openStore = (d = db) => ItemStore.open(d, clock);
const texts = (items: Item[]) => items.map((i) => i.text);

beforeEach(() => {
  db = openDb(`test-${++dbCount}`);
  now = START;
});
afterEach(async () => {
  await db.delete();
});

describe('ItemStore writes', () => {
  it('captures, persists and indexes', async () => {
    const store = await openStore();
    const item = await store.capture('call dentist tomorrow');
    expect(await store.get(item.id)).toEqual(item);
    expect(texts(await store.search('dentist'))).toEqual(['call dentist tomorrow']);
  });

  it('edits keep the store and the index in step', async () => {
    const store = await openStore();
    const { id } = await store.capture('buy milk');
    now += DAY;
    await store.editText(id, 'buy oat milk');
    expect((await store.get(id))?.text).toBe('buy oat milk');
    expect((await store.get(id))?.rawText).toBe('buy milk');
    expect(texts(await store.search('oat'))).toEqual(['buy oat milk']);
  });

  it('runs model corrections atomically through update()', async () => {
    const store = await openStore();
    const { id } = await store.capture('dentist tomorrow');
    const updated = await store.update(id, (i, c) => setDue(i, null, c));
    expect(updated.due).toEqual({ value: null, source: 'user' });
    expect(await store.get(id)).toEqual(updated);
  });

  it('throws for unknown ids', async () => {
    const store = await openStore();
    await expect(store.editText('nope', 'x')).rejects.toBeInstanceOf(ItemNotFoundError);
  });

  it('lists non-deleted items, newest capture first', async () => {
    const store = await openStore();
    await store.capture('first');
    now += 1000;
    const second = await store.capture('second');
    now += 1000;
    await store.capture('third');
    await store.remove(second.id);
    expect(texts(await store.all())).toEqual(['third', 'first']);
  });

  it('status changes set and clear completedAt', async () => {
    const store = await openStore();
    const { id } = await store.capture('buy milk');
    expect((await store.setStatus(id, 'done')).completedAt).toBe(START);
    expect((await store.setStatus(id, 'open')).completedAt).toBeUndefined();
  });

  it('soft delete hides an item; restore brings it back', async () => {
    const store = await openStore();
    const { id } = await store.capture('secret plan');
    await store.remove(id);
    expect(await store.search('secret')).toEqual([]);
    expect((await store.get(id))?.deletedAt).toBe(START);
    await store.restore(id);
    expect(texts(await store.search('secret'))).toEqual(['secret plan']);
  });

  it('purges only items deleted longer ago than the retention period', async () => {
    const store = await openStore();
    const old = await store.capture('old');
    const recent = await store.capture('recent');
    const kept = await store.capture('kept');
    await store.remove(old.id);
    now += DELETE_RETENTION_MS - DAY;
    await store.remove(recent.id);
    now += 2 * DAY;
    expect(await store.purgeDeleted()).toBe(1);
    expect(await store.get(old.id)).toBeUndefined();
    expect(await store.get(recent.id)).toBeDefined();
    expect(await store.get(kept.id)).toBeDefined();
  });
});

describe('opening the store', () => {
  it('rebuilds the index from the database', async () => {
    const first = await openStore();
    await first.capture('quarterly report #work');
    const second = await openStore();
    expect(texts(await second.search('work'))).toEqual(['quarterly report #work']);
  });

  it('re-parses items from older parsers using stored references, not the current time', async () => {
    const store = await openStore();
    const { id } = await store.capture('dentist tomorrow');
    const current = (await store.get(id))!;
    // Pretend an older parser wrote this item with a wrong due date.
    await db.items.put({
      ...current,
      parserVersion: 0,
      due: { ...current.due!, value: { type: 'date', date: '1999-01-01' } },
    });
    now += 10 * DAY;
    await openStore();
    const upgraded = (await db.items.get(id))!;
    expect(upgraded.parserVersion).toBe(PARSER_VERSION);
    expect(upgraded.due?.value).toEqual({ type: 'date', date: '2026-11-03' });
    expect(upgraded.updatedAt).toBe(current.updatedAt);
  });
});

describe('search behaviour', () => {
  let store: ItemStore;
  beforeEach(async () => {
    store = await openStore();
    for (const text of [
      'call dentist tomorrow',
      'buy milk and eggs #groceries',
      'buy milk',
      'café on 5th street',
      'great read https://example.com/rust-ownership',
      'plan trip #travel #japan',
    ]) {
      await store.capture(text);
    }
  });

  it.each<[string, string[]]>([
    ['dentist', ['call dentist tomorrow']],
    ['dent', ['call dentist tomorrow']], // prefix while typing
    ['dentst', ['call dentist tomorrow']], // typo
    ['DENTIST', ['call dentist tomorrow']],
    ['cafe', ['café on 5th street']], // accents
    ['groceries', ['buy milk and eggs #groceries']], // tag
    ['#groceries', ['buy milk and eggs #groceries']],
    ['milk eggs', ['buy milk and eggs #groceries']], // every word must match
    ['example', ['great read https://example.com/rust-ownership']], // url
    ['ownership', ['great read https://example.com/rust-ownership']],
    ['japan travel', ['plan trip #travel #japan']],
    ['zebra', []],
    ['   ', []],
    ['dentist t', ['call dentist tomorrow']], // a new one-letter word doesn't blank the results
    ['dentist to', ['call dentist tomorrow']],
    ['dentist ta', []],
  ])('%j', async (query, expected) => {
    expect(texts(await store.search(query))).toEqual(expected);
  });

  it('ranks tag matches above text-only matches', async () => {
    await store.capture('milk notes');
    await store.capture('dairy #milk');
    expect((await store.search('milk'))[0]?.text).toBe('dairy #milk');
  });

  it('a removed tag stops matching, but the words of the text still do', async () => {
    const [item] = await store.search('japan');
    await store.update(item!.id, (i, c) => addTag(i, 'someday', c));
    expect(texts(await store.search('someday'))).toEqual(['plan trip #travel #japan']);
    await store.update(item!.id, (i, c) => removeTag(removeTag(i, 'someday', c), 'japan', c));
    expect(await store.search('someday')).toEqual([]);
    // "#japan" is still in the user's text, and text is always searchable.
    expect(texts(await store.search('japan'))).toEqual(['plan trip #travel #japan']);
  });

  it('excludes archived items unless asked; includes done items', async () => {
    const [archived] = await store.search('dentist');
    await store.setStatus(archived!.id, 'archived');
    const [done] = await store.search('japan');
    await store.setStatus(done!.id, 'done');
    expect(await store.search('dentist')).toEqual([]);
    expect(texts(await store.search('dentist', { includeArchived: true }))).toEqual(['call dentist tomorrow']);
    expect(texts(await store.search('japan'))).toEqual(['plan trip #travel #japan']);
  });

  it('limits results', async () => {
    expect(await store.search('buy', { limit: 1 })).toHaveLength(1);
  });
});

describe('backup', () => {
  it('round-trips every item, including soft-deleted ones', async () => {
    const store = await openStore();
    await store.capture('keep me #a');
    const gone = await store.capture('deleted one');
    await store.remove(gone.id);
    const backup = await exportBackup(store, now);

    const otherDb = openDb(`test-${++dbCount}`);
    try {
      now += DAY;
      const other = await openStore(otherDb);
      expect(await importBackup(other, JSON.parse(JSON.stringify(backup)))).toEqual({
        added: 2,
        updated: 0,
        unchanged: 0,
        invalid: 0,
        duplicates: 0,
      });
      const restored = await otherDb.items.toArray();
      expect(restored.map((i) => ({ ...i, createdAt: START }))).toEqual(
        expect.arrayContaining(backup.items.map((i) => expect.objectContaining({ id: i.id, rawText: i.rawText }))),
      );
      expect(restored.every((i) => i.createdAt === now)).toBe(true);
      expect(restored.every((i) => i.capturedAt === START)).toBe(true);
      expect(texts(await other.search('keep'))).toEqual(['keep me #a']);
      expect(await other.search('deleted')).toEqual([]);
    } finally {
      await otherDb.delete();
    }
  });

  it('newer updatedAt wins; re-importing is a no-op', async () => {
    const store = await openStore();
    const { id } = await store.capture('draft');
    const backup = await exportBackup(store, now);
    now += DAY;
    await store.editText(id, 'final');

    // The backup is older than the local edit: local wins.
    expect(await importBackup(store, backup)).toMatchObject({ updated: 0, unchanged: 1 });
    expect((await store.get(id))?.text).toBe('final');

    // A backup newer than local wins, keeping the local createdAt.
    const newer = await exportBackup(store, now);
    await store.editText(id, 'local again'); // same timestamp as `newer` items: not newer
    now += DAY;
    const edited = { ...newer, items: newer.items.map((i) => ({ ...i, text: 'from backup', updatedAt: now })) };
    expect(await importBackup(store, edited)).toMatchObject({ updated: 1 });
    expect((await store.get(id))?.text).toBe('from backup');
    expect((await store.get(id))?.createdAt).toBe(START);
    expect(texts(await store.search('backup'))).toEqual(['from backup']);
  });

  it('counts invalid entries and rejects non-backups', async () => {
    const store = await openStore();
    const backup = await exportBackup(store, now);
    expect(await importBackup(store, { ...backup, items: [{ id: 'x' }, 42, null] })).toMatchObject({
      invalid: 3,
    });
    await expect(importBackup(store, { hello: 'world' })).rejects.toBeInstanceOf(BackupFormatError);
    await expect(importBackup(store, { ...backup, version: 99 })).rejects.toThrow(/newer version/);
  });

  it('records when the last export happened', async () => {
    const store = await openStore();
    expect(await store.lastExportAt()).toBeUndefined();
    await exportBackup(store, now);
    expect(await store.lastExportAt()).toBe(START);
  });

  it('upgrades items from older parsers on import', async () => {
    const store = await openStore();
    const item = await store.capture('dentist tomorrow');
    const backup = await exportBackup(store, now);
    await db.items.clear();
    const old = { ...backup, items: [{ ...item, parserVersion: 0 }] };
    await importBackup(store, old);
    expect((await store.get(item.id))?.parserVersion).toBe(PARSER_VERSION);
  });
});

describe('legacy data (v1 timed due dates stored `tz` instead of `zone`)', () => {
  const NY_ZONE = { type: 'iana', tz: 'America/New_York' } as const;

  /** Rewrite a current item's timed due date into the v1 shape, as parser v1 wrote it. */
  function toLegacy(item: Item): Record<string, unknown> {
    const v = item.due!.value as { at: number; zone: { tz: string } };
    return { ...item, parserVersion: 1, due: { ...item.due, value: { type: 'instant', at: v.at, tz: v.zone.tz } } };
  }

  async function legacyItems() {
    const store = await openStore();
    const parsed = await store.capture('call mom tomorrow 3pm');
    const user = await store.update((await store.capture('flight')).id, (i, c) =>
      setDue(i, { type: 'instant', at: Date.UTC(2026, 11, 24, 15), zone: NY_ZONE }, c),
    );
    return { parsed, user };
  }

  it('migrates parsed and user-owned due dates when the database opens', async () => {
    const { parsed, user } = await legacyItems();
    const name = db.name;
    await db.delete(); // start over from a genuine v1 database

    // Write v1-shaped records through a raw v1 schema, as the old app would have.
    const v1 = new Dexie(name);
    v1.version(1).stores({ items: 'id, status, capturedAt, updatedAt, deletedAt, parserVersion', meta: 'key' });
    await v1.table('items').bulkPut([toLegacy(parsed), toLegacy(user)]);
    v1.close();

    db = openDb(name);
    await openStore();
    const [p, u] = await db.items.bulkGet([parsed.id, user.id]);
    expect(p).toEqual(parsed); // shape migrated, then re-parsed by parser v2 to the same values
    expect(u?.due).toEqual(user.due); // user-owned: migrated by shape, untouched by reparse
    expect(u?.parserVersion).toBe(PARSER_VERSION);
  });

  it('migrates legacy items in an old backup', async () => {
    const { parsed, user } = await legacyItems();
    await db.items.clear();
    const store = await openStore();
    const old = {
      format: 'claudegpt-backup',
      version: 1,
      exportedAt: now,
      items: [toLegacy(parsed), toLegacy(user)],
    };
    expect(await importBackup(store, JSON.parse(JSON.stringify(old)))).toMatchObject({ added: 2, invalid: 0 });
    expect((await store.get(parsed.id))?.due).toEqual(parsed.due);
    expect((await store.get(user.id))?.due).toEqual(user.due);
  });

  it('skips malformed nested entries without poisoning the database', async () => {
    const store = await openStore();
    const good = await store.capture('good one #a');
    await db.items.clear();
    const bad = [
      { ...good, id: 'b1', textRef: null },
      { ...good, id: 'b2', kind: { value: 'event', source: 'parsed' } },
      { ...good, id: 'b3', tags: [null] },
      { ...good, id: 'b4', due: { value: { type: 'instant', at: 1, zone: { type: 'iana', tz: 'Mars/Base' } }, source: 'user' } },
      { ...good, id: 'b5', parserVersion: 0, textRef: { at: 1, tz: 'Not/AZone' } }, // would crash reparse
      { ...good, id: 'b6', spans: [{ start: 0, end: 999, field: 'tag' }] },
    ];
    const result = await importBackup(store, {
      format: 'claudegpt-backup',
      version: 1,
      exportedAt: now,
      items: [...bad, good],
    });
    expect(result).toEqual({ added: 1, updated: 0, unchanged: 0, invalid: bad.length, duplicates: 0 });
    expect((await db.items.toArray()).map((i) => i.id)).toEqual([good.id]);
    expect(texts(await store.search('good'))).toEqual(['good one #a']);
  });

});

describe('backup entries from a newer parser', () => {
  it('rejects unsupported future parser versions instead of importing them', async () => {
    const store = await openStore();
    const item = await store.capture('from the future');
    await db.items.clear();
    const result = await importBackup(store, {
      format: 'claudegpt-backup',
      version: 1,
      exportedAt: now,
      items: [{ ...item, parserVersion: PARSER_VERSION + 1 }, { ...item, id: 'current' }],
    });
    expect(result).toEqual({ added: 1, updated: 0, unchanged: 0, invalid: 1, duplicates: 0 });
    expect(await store.get(item.id)).toBeUndefined();
  });
});
