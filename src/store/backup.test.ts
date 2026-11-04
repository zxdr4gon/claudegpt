// Backup reliability (DECISIONS #22): the backup is the user's escape hatch,
// so malformed files, duplicates, partial and failed imports, and merge
// conflicts are tested here before any UI.

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type CaptureDb } from '../db';
import type { Item } from '../model/item';
import type { Clock } from '../model/items';
import { actions, perform } from './actions';
import {
  BACKUP_FORMAT,
  BackupFormatError,
  StalePreviewError,
  checkBackupSize,
  exportBackup,
  importBackup,
  parseBackupFile,
  previewImport,
  utf8ByteLength,
  type Backup,
} from './backup';
import { ItemStore, sameRecord } from './store';
import { UndoStack } from './undo';

const HOUR = 3_600_000;
const START = Date.UTC(2026, 10, 2, 4);

let n = 0;
let now: number;
const clock = (): Clock => ({ now, tz: 'Asia/Dhaka' });
const opened: { db: CaptureDb; store: ItemStore }[] = [];

async function openStore() {
  const db = openDb(`backup-${++n}`);
  const store = await ItemStore.open(db, clock);
  opened.push({ db, store });
  return { db, store };
}

const backupOf = (items: unknown[]): Backup =>
  ({ format: BACKUP_FORMAT, version: 1, exportedAt: now, items }) as Backup;

/** Everything in the database, by id, for before/after comparison. */
async function dump(db: CaptureDb): Promise<Map<string, Item>> {
  return new Map((await db.items.toArray()).map((i) => [i.id, i]));
}

beforeEach(() => {
  now = START;
});
afterEach(async () => {
  for (const { db, store } of opened.splice(0)) {
    store.close();
    await db.delete();
  }
});

describe('reading a backup file', () => {
  it('parses a real export', async () => {
    const { store } = await openStore();
    await store.capture('hello #a');
    const text = JSON.stringify(await exportBackup(store, now));
    expect(parseBackupFile(text)).toMatchObject({ format: BACKUP_FORMAT, version: 1 });
  });

  it.each(['', 'not json', '{"format":', '<html></html>'])('rejects unreadable text %j', (text) => {
    expect(() => parseBackupFile(text)).toThrow(BackupFormatError);
    expect(() => parseBackupFile(text)).toThrow(/couldn’t be read as JSON/);
  });

  it('refuses files over the size limit before parsing', () => {
    expect(() => parseBackupFile('{"format":"x"}', 10)).toThrow(/too large/);
  });

  it('measures the limit in UTF-8 bytes, not string length', () => {
    // 6 characters but 14 bytes: each 日 is 3 bytes in UTF-8.
    const text = '"日日日日"';
    expect(text.length).toBe(6);
    expect(() => parseBackupFile(text, 10)).toThrow(/too large/);
    expect(parseBackupFile('"abcd"', 10)).toBe('abcd');
  });

  it.each<[string, string, number]>([
    ['ASCII', 'abc', 3],
    ['2-byte character', 'é', 2],
    ['3-byte character', '日', 3],
    ['4-byte emoji (surrogate pair)', '😀', 4],
    ['lone surrogate (encoded as U+FFFD)', '\ud800', 3],
    ['mixed', 'a é 日 😀', 1 + 1 + 2 + 1 + 3 + 1 + 4],
  ])('utf8ByteLength: %s', (_name, text, bytes) => {
    expect(utf8ByteLength(text)).toBe(bytes);
    expect(utf8ByteLength(text)).toBe(new TextEncoder().encode(text).length);
  });

  it('checks a file’s byte size before reading it', () => {
    expect(() => checkBackupSize(11, 10)).toThrow(/too large/);
    expect(() => checkBackupSize(10, 10)).not.toThrow();
  });
});

describe('malformed backups', () => {
  it.each<[string, unknown]>([
    ['null', null],
    ['a number', 42],
    ['a string', 'backup'],
    ['an array', []],
    ['no format', { version: 1, items: [] }],
    ['another app’s format', { format: 'other-app', version: 1, items: [] }],
    ['items not an array', { format: BACKUP_FORMAT, version: 1, items: {} }],
    ['no version', { format: BACKUP_FORMAT, exportedAt: 1, items: [] }],
    ['version as a string', { format: BACKUP_FORMAT, version: '1', exportedAt: 1, items: [] }],
    ['version 0', { format: BACKUP_FORMAT, version: 0, exportedAt: 1, items: [] }],
    ['negative version', { format: BACKUP_FORMAT, version: -1, exportedAt: 1, items: [] }],
    ['fractional version', { format: BACKUP_FORMAT, version: 0.5, exportedAt: 1, items: [] }],
    ['NaN version', { format: BACKUP_FORMAT, version: NaN, exportedAt: 1, items: [] }],
    ['no exportedAt', { format: BACKUP_FORMAT, version: 1, items: [] }],
    ['exportedAt as a string', { format: BACKUP_FORMAT, version: 1, exportedAt: '2026-11-03', items: [] }],
    ['exportedAt null', { format: BACKUP_FORMAT, version: 1, exportedAt: null, items: [] }],
    ['exportedAt Infinity', { format: BACKUP_FORMAT, version: 1, exportedAt: Infinity, items: [] }],
  ])('rejects %s, writing nothing', async (_name, data) => {
    const { db, store } = await openStore();
    await store.capture('existing');
    const before = await dump(db);
    await expect(importBackup(store, data)).rejects.toThrow(BackupFormatError);
    await expect(previewImport(store, data)).rejects.toThrow(BackupFormatError);
    expect(await dump(db)).toEqual(before);
  });

  it('rejects a backup from a newer app version', async () => {
    const { store } = await openStore();
    await expect(importBackup(store, { ...backupOf([]), version: 2 })).rejects.toThrow(/newer version/);
    await expect(importBackup(store, { ...backupOf([]), version: 1.5 })).rejects.toThrow(/isn’t a backup/);
  });

  it('an empty backup imports nothing and succeeds', async () => {
    const { store } = await openStore();
    expect(await importBackup(store, backupOf([]))).toMatchObject({ added: 0, updated: 0, unchanged: 0, invalid: 0, duplicates: 0 });
  });
});

describe('duplicate ids within one backup', () => {
  async function versions() {
    const { store } = await openStore();
    const item = await store.capture('draft');
    const older = item;
    const newer: Item = { ...item, text: 'final', rawText: item.rawText, updatedAt: item.updatedAt + HOUR };
    return { older, newer };
  }

  it('the newest copy wins, whatever its position', async () => {
    const { older, newer } = await versions();
    for (const order of [[older, newer], [newer, older]]) {
      const { db, store } = await openStore();
      expect(await importBackup(store, backupOf(order))).toMatchObject({ added: 1, duplicates: 1 });
      expect((await db.items.get(older.id))?.text).toBe('final');
    }
  });

  it('on a tie the first copy stays', async () => {
    const { older } = await versions();
    const twin: Item = { ...older, text: 'same time, different text' };
    const { db, store } = await openStore();
    await importBackup(store, backupOf([older, twin]));
    expect((await db.items.get(older.id))?.text).toBe(older.text);
  });

  it('an invalid copy doesn’t count as a duplicate and doesn’t block the valid one', async () => {
    const { older } = await versions();
    const { db, store } = await openStore();
    const result = await importBackup(store, backupOf([{ ...older, textRef: null }, older]));
    expect(result).toMatchObject({ added: 1, invalid: 1, duplicates: 0 });
    expect(await db.items.get(older.id)).toBeDefined();
  });
});

describe('partial imports', () => {
  it('imports every valid entry and reports the rest', async () => {
    const source = await openStore();
    const a = await source.store.capture('alpha');
    const b = await source.store.capture('beta');
    const { db, store } = await openStore();
    const result = await importBackup(store, backupOf([a, { id: 'junk' }, 7, b, { ...a, id: 'x', status: 'later' }]));
    expect(result).toMatchObject({ added: 2, updated: 0, unchanged: 0, invalid: 3, duplicates: 0 });
    expect([...(await dump(db)).keys()].sort()).toEqual([a.id, b.id].sort());
  });

  it('writes all valid entries or none: a failed write leaves the database untouched', async () => {
    const source = await openStore();
    const items = [await source.store.capture('one'), await source.store.capture('two'), await source.store.capture('three')];
    const { db, store } = await openStore();
    const local = await store.capture('local item');
    const before = await dump(db);
    const indexBefore = store.index.search('local');

    // The second write inside the import's transaction fails (e.g. quota exceeded).
    const realPut = db.items.put.bind(db.items);
    let calls = 0;
    const spy = vi.spyOn(db.items, 'put').mockImplementation((...args: Parameters<typeof realPut>) => {
      if (++calls === 2) return Promise.reject(new Error('QuotaExceededError')) as ReturnType<typeof realPut>;
      return realPut(...args);
    });
    await expect(importBackup(store, backupOf(items))).rejects.toThrow('QuotaExceededError');
    spy.mockRestore();

    expect(await dump(db)).toEqual(before);
    expect(store.index.search('local')).toEqual(indexBefore);
    expect(store.index.search('three')).toEqual([]);
    expect(await db.items.get(local.id)).toBeDefined();
  });
});

describe('merge conflicts (last write wins on updatedAt; local wins ties)', () => {
  async function setup() {
    const local = await openStore();
    const item = await local.store.capture('original text');
    return { ...local, item };
  }

  it('local newer than the backup: local kept', async () => {
    const { db, store, item } = await setup();
    now += HOUR;
    await store.editText(item.id, 'edited locally');
    expect(await importBackup(store, backupOf([item]))).toMatchObject({ updated: 0, unchanged: 1 });
    expect((await db.items.get(item.id))?.text).toBe('edited locally');
  });

  it('backup newer than local: backup applied, local createdAt kept', async () => {
    const { db, store, item } = await setup();
    const newer: Item = { ...item, text: 'from backup', updatedAt: item.updatedAt + HOUR, createdAt: 1 };
    expect(await importBackup(store, backupOf([newer]))).toMatchObject({ updated: 1 });
    const stored = (await db.items.get(item.id))!;
    expect(stored.text).toBe('from backup');
    expect(stored.createdAt).toBe(item.createdAt);
    expect(store.index.search('backup')).toEqual([item.id]);
  });

  it('same updatedAt, different content: local kept', async () => {
    const { db, store, item } = await setup();
    const twin: Item = { ...item, text: 'conflicting text' };
    expect(await importBackup(store, backupOf([twin]))).toMatchObject({ unchanged: 1 });
    expect(sameRecord(await db.items.get(item.id), item)).toBe(true);
  });

  it('a newer deletion in the backup deletes locally (soft) and leaves search', async () => {
    const { db, store, item } = await setup();
    const deleted: Item = { ...item, deletedAt: item.updatedAt + HOUR, updatedAt: item.updatedAt + HOUR };
    await importBackup(store, backupOf([deleted]));
    expect((await db.items.get(item.id))?.deletedAt).toBe(item.updatedAt + HOUR);
    expect(store.index.search('original')).toEqual([]);
  });

  it('a newer local deletion is not undone by an older live copy', async () => {
    const { db, store, item } = await setup();
    now += HOUR;
    await perform(store, new UndoStack(), item.id, actions.remove());
    await importBackup(store, backupOf([item]));
    expect((await db.items.get(item.id))?.deletedAt).toBe(now);
  });

  it('a newer live copy in the backup restores a locally deleted item', async () => {
    const { db, store, item } = await setup();
    now += HOUR;
    await perform(store, new UndoStack(), item.id, actions.remove());
    const revived: Item = { ...item, text: 'revived', updatedAt: now + HOUR };
    await importBackup(store, backupOf([revived]));
    const stored = (await db.items.get(item.id))!;
    expect(stored.deletedAt).toBeUndefined();
    expect(store.index.search('revived')).toEqual([item.id]);
  });
});

describe('preview', () => {
  it('reports exactly what the import then does, and writes nothing', async () => {
    const source = await openStore();
    const a = await source.store.capture('alpha');
    const b = await source.store.capture('beta');
    const { db, store } = await openStore();
    await importBackup(store, backupOf([a]));
    now += HOUR;
    await store.editText(a.id, 'alpha edited locally'); // local now newer than the backup's copy
    const newerB: Item = { ...b, updatedAt: b.updatedAt + 2 * HOUR };
    const data = backupOf([a, newerB, newerB, { id: 'junk' }]);

    const before = await dump(db);
    const preview = await previewImport(store, data);
    expect(await dump(db)).toEqual(before);
    expect(preview).toMatchObject({ added: 1, updated: 0, unchanged: 1, invalid: 1, duplicates: 1 });
    const { searchReady, ...result } = await importBackup(store, data);
    expect(result).toEqual(preview);
    expect(searchReady).toBe(true);
  });

  it('re-importing the same backup changes nothing', async () => {
    const source = await openStore();
    await source.store.capture('alpha');
    await source.store.capture('beta');
    const data = JSON.parse(JSON.stringify(await exportBackup(source.store, now)));
    const { db, store } = await openStore();
    await importBackup(store, data);
    const after = await dump(db);
    now += HOUR;
    expect(await importBackup(store, data)).toMatchObject({ added: 0, updated: 0, unchanged: 2 });
    expect(await dump(db)).toEqual(after);
  });
});

describe('round trip through a file', () => {
  it('export → text → import into an empty store restores every item', async () => {
    const source = await openStore();
    const undo = new UndoStack();
    const a = await source.store.capture('call dentist tomorrow 3pm #health !!');
    await perform(source.store, undo, a.id, actions.removeTag('health'));
    const b = await source.store.capture('gone soon');
    await perform(source.store, undo, b.id, actions.remove());
    const text = JSON.stringify(await exportBackup(source.store, now));

    now += HOUR;
    const { db, store } = await openStore();
    expect(await importBackup(store, parseBackupFile(text))).toMatchObject({ added: 2, invalid: 0 });
    const original = await dump(source.db);
    for (const [id, item] of await dump(db)) {
      expect(sameRecord({ ...item, createdAt: 0 }, { ...original.get(id), createdAt: 0 })).toBe(true);
      expect(item.createdAt).toBe(now);
    }
  });
});

describe('stale previews (something changed between preview and confirm)', () => {
  async function setup() {
    const source = await openStore();
    const a = await source.store.capture('alpha');
    const b = await source.store.capture('beta');
    const { db, store } = await openStore();
    await importBackup(store, backupOf([a, b]));
    // The file's copies are an hour newer than the local ones.
    const file = backupOf([
      { ...a, text: 'alpha from file', updatedAt: a.updatedAt + HOUR },
      { ...b, text: 'beta from file', updatedAt: b.updatedAt + HOUR },
    ]);
    return { db, store, a, b, file };
  }

  it('confirming an up-to-date preview imports', async () => {
    const { db, store, a, file } = await setup();
    const preview = await previewImport(store, file);
    const { searchReady, ...result } = await importBackup(store, file, preview);
    expect(result).toEqual(preview);
    expect(searchReady).toBe(true);
    expect((await db.items.get(a.id))?.text).toBe('alpha from file');
  });

  it('an edit after the preview makes it stale: nothing is written, the fresh preview is returned', async () => {
    const { db, store, a, file } = await setup();
    const preview = await previewImport(store, file);
    expect(preview).toMatchObject({ updated: 2, unchanged: 0 });

    // e.g. another tab edits alpha after the preview was shown: local is now newer.
    now += 2 * HOUR;
    await store.editText(a.id, 'alpha edited in another tab');
    const before = await dump(db);

    const error = await importBackup(store, file, preview).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StalePreviewError);
    expect((error as StalePreviewError).preview).toMatchObject({ updated: 1, unchanged: 1, invalid: 0, duplicates: 0 });
    expect(await dump(db)).toEqual(before);

    // Confirming the refreshed preview goes ahead, and keeps the newer local edit.
    await importBackup(store, file, (error as StalePreviewError).preview);
    expect((await db.items.get(a.id))?.text).toBe('alpha edited in another tab');
  });

  it('equal counts with different items still count as stale', async () => {
    const { db, store, a, b } = await setup();
    // File: alpha newer than local, beta older than local.
    const file = backupOf([
      { ...a, text: 'alpha from file', updatedAt: a.updatedAt + HOUR },
      { ...b, text: 'old beta', updatedAt: b.updatedAt - HOUR },
    ]);
    const preview = await previewImport(store, file);
    expect(preview).toMatchObject({ updated: 1, unchanged: 1 });

    // Local alpha becomes newer and local beta older: still { updated: 1, unchanged: 1 }, but swapped.
    now += 2 * HOUR;
    await store.editText(a.id, 'alpha edited here');
    await db.items.update(b.id, { updatedAt: b.updatedAt - 2 * HOUR });
    const before = await dump(db);

    await expect(importBackup(store, file, preview)).rejects.toBeInstanceOf(StalePreviewError);
    expect(await dump(db)).toEqual(before);
  });

  it('without a confirmed preview, import just recomputes', async () => {
    const { store, file } = await setup();
    expect(await importBackup(store, file)).toMatchObject({ updated: 2 });
  });
});

describe('after the commit (search catching up)', () => {
  it('a failed index rebuild after commit still reports the import as done', async () => {
    const source = await openStore();
    const item = await source.store.capture('imported thought');
    const { db, store } = await openStore();
    const spy = vi.spyOn(store, 'rebuildIndex').mockRejectedValueOnce(new Error('index broke'));

    const result = await importBackup(store, backupOf([item]));
    expect(result).toMatchObject({ added: 1, searchReady: false });
    expect(await db.items.get(item.id)).toBeDefined(); // the data is committed
    expect(store.searchStale).toBe(true);

    // The scheduled retry (1 s) repairs search without anyone asking.
    await vi.waitFor(() => expect(store.index.search('imported')).toEqual([item.id]), { timeout: 3000 });
    expect(store.searchStale).toBe(false);
    spy.mockRestore();
  });

  it('refreshIndex can also be run directly and reports success', async () => {
    const { store } = await openStore();
    await store.capture('direct repair');
    vi.spyOn(store, 'rebuildIndex').mockRejectedValueOnce(new Error('index broke'));
    expect(await store.refreshIndex()).toBe(false);
    expect(await store.refreshIndex()).toBe(true);
    expect(store.index.search('repair')).toHaveLength(1);
  });

  it('closing the store stops retries', async () => {
    const { store } = await openStore();
    const spy = vi.spyOn(store, 'rebuildIndex').mockRejectedValue(new Error('index broke'));
    await store.refreshIndex();
    store.close();
    const calls = spy.mock.calls.length;
    await new Promise((r) => setTimeout(r, 1200));
    expect(spy.mock.calls.length).toBe(calls);
    spy.mockRestore();
  });
});
