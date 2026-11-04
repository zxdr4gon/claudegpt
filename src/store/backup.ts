// JSON backup file format (DECISIONS #4, #16). This module only reads and
// checks files; every database write goes through ItemStore.

import type { Item } from '../model/item';
import { reparse } from '../model/items';
import { isValidItem, upgradeShape } from '../model/migrate';
import { PARSER_VERSION } from '../parser/parse';
import { StaleImportError, type ItemStore, type MergeCounts, type MergeDecision } from './store';

export const BACKUP_FORMAT = 'claudegpt-backup';
/** Bump when the envelope changes. Item shape changes are handled by upgradeShape. */
export const BACKUP_VERSION = 1;

export type Backup = {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: number;
  items: Item[];
};

/**
 * Counts for an import or its preview.
 * - invalid: entries that aren't valid items (skipped).
 * - duplicates: extra entries for an id that appears more than once in the
 *   file; only the newest of them is considered (skipped).
 */
export type ImportResult = MergeCounts & { invalid: number; duplicates: number };

/** A preview also records the decision for each item, so confirm can detect changes. */
export type ImportPreview = ImportResult & { decisions: Record<string, MergeDecision> };

/**
 * Something changed (e.g. in another tab) between preview and confirm, so the
 * preview no longer describes what would happen. Nothing was written; show
 * `preview` and ask again.
 */
export class StalePreviewError extends Error {
  constructor(readonly preview: ImportPreview) {
    super('What this import would do has changed since you previewed it.');
  }
}

export class BackupFormatError extends Error {}

/** Larger files are refused before reading, to keep the tab responsive. Measured in bytes. */
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;

const TOO_LARGE = 'This file is too large to be a backup.';

/** Check a file's size in bytes (e.g. `File.size`) before reading it at all. */
export function checkBackupSize(bytes: number, maxBytes = MAX_BACKUP_BYTES): void {
  if (bytes > maxBytes) throw new BackupFormatError(TOO_LARGE);
}

/**
 * The UTF-8 encoded size of a string, without allocating the encoding.
 * `text.length` counts UTF-16 code units and undercounts non-ASCII text.
 */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4; // a surrogate pair is one 4-byte character
        i++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

/** Read a backup file's text. Throws BackupFormatError with a message for the user. */
export function parseBackupFile(text: string, maxBytes = MAX_BACKUP_BYTES): unknown {
  // Each UTF-16 code unit is at most 3 UTF-8 bytes, so short text skips the count.
  if (text.length * 3 > maxBytes && utf8ByteLength(text) > maxBytes) throw new BackupFormatError(TOO_LARGE);
  try {
    return JSON.parse(text);
  } catch {
    throw new BackupFormatError('This file isn’t a backup: it couldn’t be read as JSON.');
  }
}

/** Includes soft-deleted items, so a restore is faithful. */
export async function exportBackup(store: ItemStore, now: number): Promise<Backup> {
  const items = await store.exportItems();
  await store.recordExport(now);
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now, items };
}

/**
 * Bring one backup entry to the current schema and parser, or null if it isn't
 * a valid item. Never throws: a bad entry must not abort the whole import.
 */
export function prepareImportedItem(raw: unknown): Item | null {
  try {
    const item = upgradeShape(raw);
    if (!isValidItem(item)) return null;
    // Written by a newer app whose parser this one doesn't understand.
    if (item.parserVersion > PARSER_VERSION) return null;
    // Items from an older parser are upgraded the same way as on startup.
    const prepared = item.parserVersion < PARSER_VERSION ? reparse(item) : item;
    return isValidItem(prepared) ? prepared : null;
  } catch {
    return null;
  }
}

type Prepared = { items: Item[]; invalid: number; duplicates: number };

/** Check the envelope, then validate, upgrade and de-duplicate every entry. */
function prepare(data: unknown): Prepared {
  const backup = data as Partial<Backup> | null;
  if (typeof backup !== 'object' || backup === null || backup.format !== BACKUP_FORMAT || !Array.isArray(backup.items)) {
    throw new BackupFormatError('This file isn’t a backup from this app.');
  }
  const version = backup.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new BackupFormatError('This file isn’t a backup from this app.');
  }
  if (version > BACKUP_VERSION) {
    throw new BackupFormatError('This backup was made by a newer version of the app.');
  }
  if (typeof backup.exportedAt !== 'number' || !Number.isFinite(backup.exportedAt)) {
    throw new BackupFormatError('This file isn’t a backup from this app.');
  }

  const byId = new Map<string, Item>();
  let invalid = 0;
  let duplicates = 0;
  for (const raw of backup.items) {
    const item = prepareImportedItem(raw);
    if (!item) {
      invalid++;
      continue;
    }
    const seen = byId.get(item.id);
    if (seen) {
      duplicates++;
      // Same rule as merging: strictly newer wins, otherwise the first stays.
      if (item.updatedAt > seen.updatedAt) byId.set(item.id, item);
    } else {
      byId.set(item.id, item);
    }
  }
  return { items: [...byId.values()], invalid, duplicates };
}

/** What importing would do, without writing anything. */
export async function previewImport(store: ItemStore, data: unknown): Promise<ImportPreview> {
  const { items, invalid, duplicates } = prepare(data);
  return { ...(await store.planImport(items)), invalid, duplicates };
}

/**
 * Merge a backup into the store. All valid entries are written, or none.
 * Pass the preview the user confirmed: if any item's outcome has changed since,
 * nothing is written and StalePreviewError carries the up-to-date preview.
 */
export async function importBackup(store: ItemStore, data: unknown, confirmed?: ImportPreview): Promise<ImportPreview> {
  const { items, invalid, duplicates } = prepare(data);
  try {
    return { ...(await store.importItems(items, confirmed?.decisions)), invalid, duplicates };
  } catch (error) {
    if (error instanceof StaleImportError) throw new StalePreviewError({ ...error.plan, invalid, duplicates });
    throw error;
  }
}
