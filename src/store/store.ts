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

/** One write to one item: the stored record before and after it. */
export type Change = { before: Item; after: Item };

/**
 * Structural equality for stored records. A key holding `undefined` counts as
 * absent, since storage may keep or drop such keys.
 */
export function sameRecord(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((x, i) => sameRecord(x, bb[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) if (!sameRecord(ao[k], bo[k])) return false;
  return true;
}

export class ItemNotFoundError extends Error {
  constructor(id: string) {
    super(`Item not found: ${id}`);
  }
}

/**
 * Tells other tabs which items this tab wrote, so they can update their own
 * search index (DECISIONS #20). Their item lists update through Dexie already.
 */
type SyncMessage = { type: 'items'; ids: string[] } | { type: 'all' };

export class ItemStore {
  readonly index = new SearchIndex();
  private channel: BroadcastChannel | undefined;

  private constructor(
    readonly db: CaptureDb,
    private readonly clock: () => Clock,
  ) {}

  /** Open the store: upgrade items parsed by an older parser, then build the index. */
  static async open(db: CaptureDb, clock: () => Clock): Promise<ItemStore> {
    const store = new ItemStore(db, clock);
    store.listen();
    if ((await store.reparseOutdated()) > 0) store.announce({ type: 'all' });
    await store.rebuildIndex();
    return store;
  }

  /** Stop listening to other tabs. */
  close(): void {
    this.channel?.close();
    this.channel = undefined;
  }

  private listen() {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(`capture-items:${this.db.name}`);
    // In Node (tests) an open channel would keep the process alive.
    (channel as { unref?: () => void }).unref?.();
    channel.onmessage = (e: MessageEvent<SyncMessage>) => {
      this.applyRemote(e.data).catch((error: unknown) => {
        // After close() (e.g. the tab is going away) there's nothing to update.
        if (this.channel) console.warn('Could not apply a change from another tab to search', error);
      });
    };
    this.channel = channel;
  }

  private announce(message: SyncMessage) {
    this.channel?.postMessage(message);
  }

  /**
   * Another tab wrote these items. Re-read them from the database rather than
   * trusting the message, so out-of-order messages still converge.
   */
  private async applyRemote(message: SyncMessage) {
    if (message.type === 'all') return this.rebuildIndex();
    const items = await this.db.items.bulkGet(message.ids);
    message.ids.forEach((id, i) => {
      const item = items[i];
      if (item) this.index.upsert(item);
      else this.index.remove(id);
    });
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
    this.announce({ type: 'items', ids: [item.id] });
    return item;
  }

  /**
   * Apply a model function to one item, atomically. Returns the exact stored
   * record before and after, which is what undo restores (DECISIONS #18).
   */
  async change(id: string, fn: (item: Item, clock: Clock) => Item): Promise<Change> {
    const result = await this.db.transaction('rw', this.db.items, async () => {
      const before = await this.db.items.get(id);
      if (!before) throw new ItemNotFoundError(id);
      const after = fn(before, this.clock());
      if (after !== before) await this.db.items.put(after);
      return { before, after };
    });
    if (result.after !== result.before) {
      this.index.upsert(result.after);
      this.announce({ type: 'items', ids: [result.after.id] });
    }
    return result;
  }

  async update(id: string, fn: (item: Item, clock: Clock) => Item): Promise<Item> {
    return (await this.change(id, fn)).after;
  }

  /**
   * Undo a change by writing back its exact `before` record. Refused (false)
   * unless the item is still exactly the change's `after`, so undoing an older
   * action can never overwrite anything done since.
   */
  async revert(change: Change): Promise<boolean> {
    const { before, after } = change;
    const reverted = await this.db.transaction('rw', this.db.items, async () => {
      const current = await this.db.items.get(after.id);
      if (!current || !sameRecord(current, after)) return false;
      await this.db.items.put(before);
      return true;
    });
    if (reverted) {
      this.index.upsert(before);
      this.announce({ type: 'items', ids: [before.id] });
    }
    return reverted;
  }

  editText = (id: string, text: string) => this.update(id, (i, c) => model.editText(i, text, c));
  setStatus = (id: string, status: Item['status']) => this.update(id, (i, c) => model.setStatus(i, status, c));
  snooze = (id: string, until: number | null) => this.update(id, (i, c) => model.snooze(i, until, c));
  remove = (id: string) => this.update(id, model.softDelete);
  restore = (id: string) => this.update(id, model.restore);

  /** Hard-delete items soft-deleted more than the retention period ago. */
  async purgeDeleted(): Promise<number> {
    const cutoff = this.clock().now - DELETE_RETENTION_MS;
    const purged = await this.db.items.where('deletedAt').below(cutoff).delete();
    // Soft-deleted items aren't indexed, so no index change; just keep tabs in step.
    if (purged > 0) this.announce({ type: 'all' });
    return purged;
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
   * What importing these items would do, without writing anything. Uses the
   * same decision as importItems, so the preview can't disagree with the result.
   */
  async planImport(items: Item[]): Promise<MergePlan> {
    return planMerge(items, await this.db.items.bulkGet(items.map((i) => i.id)));
  }

  /**
   * Merge already-validated, current-schema items with distinct ids, in one
   * transaction: if any write fails, nothing is written (DECISIONS #22).
   * New items keep `capturedAt` and get `createdAt` = now; replaced ones keep
   * the local `createdAt` (#9).
   *
   * With `expected` (the decisions a preview showed), the plan is recomputed
   * inside the same transaction and the import is refused with
   * StaleImportError, writing nothing, if any item's decision changed since.
   */
  async importItems(items: Item[], expected?: MergePlan['decisions']): Promise<MergePlan> {
    const now = this.clock().now;
    const plan = await this.db.transaction('rw', this.db.items, async () => {
      const existing = await this.db.items.bulkGet(items.map((i) => i.id));
      const plan = planMerge(items, existing);
      if (expected && !sameDecisions(plan.decisions, expected)) throw new StaleImportError(plan);
      const writes: Item[] = [];
      items.forEach((incoming, i) => {
        const decision = plan.decisions[incoming.id];
        if (decision === 'added') writes.push({ ...incoming, createdAt: now });
        if (decision === 'updated') writes.push({ ...incoming, createdAt: existing[i]!.createdAt });
      });
      for (const item of writes) await this.db.items.put(item);
      return plan;
    });
    await this.rebuildIndex();
    this.announce({ type: 'all' });
    return plan;
  }
}

const LAST_EXPORT_KEY = 'lastExportAt';

export type MergeCounts = { added: number; updated: number; unchanged: number };
export type MergeDecision = keyof MergeCounts;
/** Counts plus the decision for each incoming id. */
export type MergePlan = MergeCounts & { decisions: Record<string, MergeDecision> };

/** The data changed between preview and confirm; carries the fresh plan. */
export class StaleImportError extends Error {
  constructor(readonly plan: MergePlan) {
    super('The data changed since the import was previewed.');
  }
}

function planMerge(items: Item[], existing: (Item | undefined)[]): MergePlan {
  const plan: MergePlan = { added: 0, updated: 0, unchanged: 0, decisions: {} };
  items.forEach((incoming, i) => {
    const decision = mergeDecision(existing[i], incoming);
    plan[decision]++;
    plan.decisions[incoming.id] = decision;
  });
  return plan;
}

/** Same ids with the same decisions; equal counts alone aren't enough. */
function sameDecisions(a: Record<string, MergeDecision>, b: Record<string, MergeDecision>): boolean {
  const ids = Object.keys(a);
  return ids.length === Object.keys(b).length && ids.every((id) => a[id] === b[id]);
}

/**
 * Last-write-wins on `updatedAt`, the rule future sync will use. On a tie the
 * local record stays: an import never replaces local data with something that
 * isn't strictly newer. A newer soft-deleted record does replace a live one
 * (and vice versa), since deletion is just another update.
 */
export function mergeDecision(local: Item | undefined, incoming: Item): MergeDecision {
  if (!local) return 'added';
  return incoming.updatedAt > local.updatedAt ? 'updated' : 'unchanged';
}
