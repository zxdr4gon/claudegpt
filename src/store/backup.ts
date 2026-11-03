// JSON backup file format (DECISIONS #4, #16). This module only reads and
// checks files; every database write goes through ItemStore.

import type { Item } from '../model/item';
import { reparse } from '../model/items';
import { isValidItem, upgradeShape } from '../model/migrate';
import { PARSER_VERSION } from '../parser/parse';
import type { ItemStore } from './store';

export const BACKUP_FORMAT = 'claudegpt-backup';
/** Bump when the envelope changes. Item shape changes are handled by upgradeShape. */
export const BACKUP_VERSION = 1;

export type Backup = {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: number;
  items: Item[];
};

export type ImportResult = { added: number; updated: number; unchanged: number; invalid: number };

export class BackupFormatError extends Error {}

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

export async function importBackup(store: ItemStore, data: unknown): Promise<ImportResult> {
  const backup = data as Partial<Backup> | null;
  if (backup?.format !== BACKUP_FORMAT || !Array.isArray(backup.items)) {
    throw new BackupFormatError('Not a backup file.');
  }
  if (typeof backup.version !== 'number' || backup.version > BACKUP_VERSION) {
    throw new BackupFormatError('This backup was made by a newer version of the app.');
  }

  const valid: Item[] = [];
  let invalid = 0;
  for (const raw of backup.items) {
    const item = prepareImportedItem(raw);
    if (item) valid.push(item);
    else invalid++;
  }
  return { ...(await store.importItems(valid)), invalid };
}
