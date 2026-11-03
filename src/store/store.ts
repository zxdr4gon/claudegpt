// The one place that writes items. Each write runs a pure model function inside
// a Dexie transaction, then updates the search index once the write committed.

import type { CaptureDb } from '../db';
import type { Item } from '../model/item';
import * as model from '../model/items';
import type { Clock } from '../model/items';
import { PARSER_VERSION } from '../parser/parse';
import { SearchIndex, type SearchOptions } from '../search/index';

/** Soft-deleted items are purged after this long (DECISIONS #9). */
export const DELETE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export class ItemNotFoundError extends Error {
  constructor(id: string) {
    super(`Item not found: ${id}`);
  }
}

export class ItemStore {
  readonly index = new SearchIndex();

  private constructor(
    readonly db: CaptureDb,
    private readonly clock: () => Clock,
  ) {}

  /** Open the store: upgrade items parsed by an older parser, then build the index. */
  static async open(db: CaptureDb, clock: () => Clock): Promise<ItemStore> {
    const store = new ItemStore(db, clock);
    await store.reparseOutdated();
    await store.rebuildIndex();
    return store;
  }

  async rebuildIndex(): Promise<void> {
    this.index.replaceAll(await this.db.items.toArray());
  }

  /**
   * Re-parse items whose `parserVersion` is older than the current parser.
   * Deterministic: uses stored references, never the current time (DECISIONS #7, #8).
   */
  async reparseOutdated(): Promise<number> {
    return this.db.transaction('rw', this.db.items, async () => {
      const outdated = await this.db.items.where('parserVersion').below(PARSER_VERSION).toArray();
      await this.db.items.bulkPut(outdated.map(model.reparse));
      return outdated.length;
    });
  }

  // --- Reads -----------------------------------------------------------------

  get(id: string): Promise<Item | undefined> {
    return this.db.items.get(id);
  }

  /** Every item that isn't deleted, newest capture first. */
  async all(): Promise<Item[]> {
    const items = await this.db.items.orderBy('capturedAt').reverse().toArray();
    return items.filter((i) => i.deletedAt == null);
  }

  /** Search results as items, best match first. */
  async search(query: string, options?: SearchOptions): Promise<Item[]> {
    const ids = this.index.search(query, options);
    const items = await this.db.items.bulkGet(ids);
    return items.filter((i): i is Item => i != null && i.deletedAt == null);
  }

  // --- Writes ----------------------------------------------------------------

  async capture(text: string): Promise<Item> {
    const item = model.createItem(text, this.clock());
    await this.db.items.add(item);
    this.index.upsert(item);
    return item;
  }

  /** Apply a model function to one item, atomically. */
  async update(id: string, change: (item: Item, clock: Clock) => Item): Promise<Item> {
    const updated = await this.db.transaction('rw', this.db.items, async () => {
      const item = await this.db.items.get(id);
      if (!item) throw new ItemNotFoundError(id);
      const next = change(item, this.clock());
      if (next !== item) await this.db.items.put(next);
      return next;
    });
    this.index.upsert(updated);
    return updated;
  }

  editText = (id: string, text: string) => this.update(id, (i, c) => model.editText(i, text, c));
  setStatus = (id: string, status: Item['status']) => this.update(id, (i, c) => model.setStatus(i, status, c));
  snooze = (id: string, until: number | null) => this.update(id, (i, c) => model.snooze(i, until, c));
  remove = (id: string) => this.update(id, model.softDelete);
  restore = (id: string) => this.update(id, model.restore);

  /** Hard-delete items soft-deleted more than the retention period ago. */
  async purgeDeleted(): Promise<number> {
    const cutoff = this.clock().now - DELETE_RETENTION_MS;
    return this.db.items.where('deletedAt').below(cutoff).delete();
  }

  // --- Backup support ----------------------------------------------------------
  // The file format lives in backup.ts; the writes live here.

  /** Every item, soft-deleted ones included. */
  exportItems(): Promise<Item[]> {
    return this.db.items.toArray();
  }

  async recordExport(at: number): Promise<void> {
    await this.db.meta.put({ key: LAST_EXPORT_KEY, value: at });
  }

  async lastExportAt(): Promise<number | undefined> {
    const row = await this.db.meta.get(LAST_EXPORT_KEY);
    return typeof row?.value === 'number' ? row.value : undefined;
  }

  /**
   * Merge already-validated, current-schema items. Per item, the newer
   * `updatedAt` wins (the rule future sync will use). New items keep
   * `capturedAt` and get `createdAt` = now; replaced ones keep the local
   * `createdAt` (DECISIONS #9).
   */
  async importItems(items: Item[]): Promise<{ added: number; updated: number; unchanged: number }> {
    const now = this.clock().now;
    const result = { added: 0, updated: 0, unchanged: 0 };
    await this.db.transaction('rw', this.db.items, async () => {
      for (const incoming of items) {
        const existing = await this.db.items.get(incoming.id);
        if (!existing) {
          await this.db.items.add({ ...incoming, createdAt: now });
          result.added++;
        } else if (incoming.updatedAt > existing.updatedAt) {
          await this.db.items.put({ ...incoming, createdAt: existing.createdAt });
          result.updated++;
        } else {
          result.unchanged++;
        }
      }
    });
    await this.rebuildIndex();
    return result;
  }
}

const LAST_EXPORT_KEY = 'lastExportAt';
