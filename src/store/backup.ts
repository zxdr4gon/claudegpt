// JSON backup file format (DECISIONS #4, #16). This module only reads and
// checks files; every database write goes through ItemStore.

import type { Item } from '../model/item';
import { reparse } from '../model/items';
import { isValidItem, upgradeShape } from '../model/migrate';
import { PARSER_VERSION } from '../parser/parse';
import type { ItemStore, MergeCounts } from './store';

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

export class BackupFormatError extends Error {}

/** Larger files are refused before parsing, to keep the tab responsive. */
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;

/** Read a backup file's text. Throws BackupFormatError with a message for the user. */
export function parseBackupFile(text: string, maxLength = MAX_BACKUP_BYTES): unknown {
  if (text.length > maxLength) throw new BackupFormatError('This file is too large to be a backup.');
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
  if (typeof backup.version !== 'number' || backup.version > BACKUP_VERSION) {
    throw new BackupFormatError('This backup was made by a newer version of the app.');
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
export async function previewImport(store: ItemStore, data: unknown): Promise<ImportResult> {
  const { items, invalid, duplicates } = prepare(data);
  return { ...(await store.planImport(items)), invalid, duplicates };
}

/** Merge a backup into the store. All valid entries are written, or none. */
export async function importBackup(store: ItemStore, data: unknown): Promise<ImportResult> {
  const { items, invalid, duplicates } = prepare(data);
  return { ...(await store.importItems(items)), invalid, duplicates };
}
