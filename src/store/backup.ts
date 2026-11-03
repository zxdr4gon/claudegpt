// JSON export/import (DECISIONS #4, #16). The backup holds every item,
// including soft-deleted ones, so a restore is faithful.

import type { Item } from '../model/item';
import { reparse } from '../model/items';
import { PARSER_VERSION } from '../parser/parse';
import type { ItemStore } from './store';

export const BACKUP_FORMAT = 'claudegpt-backup';
export const BACKUP_VERSION = 1;
const LAST_EXPORT_KEY = 'lastExportAt';

export type Backup = {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: number;
  items: Item[];
};

export type ImportResult = { added: number; updated: number; unchanged: number; invalid: number };

export class BackupFormatError extends Error {}

export async function exportBackup(store: ItemStore, now: number): Promise<Backup> {
  const items = await store.db.items.toArray();
  await store.db.meta.put({ key: LAST_EXPORT_KEY, value: now });
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now, items };
}

export async function lastExportAt(store: ItemStore): Promise<number | undefined> {
  const row = await store.db.meta.get(LAST_EXPORT_KEY);
  return typeof row?.value === 'number' ? row.value : undefined;
}

/** Enough shape checking to refuse garbage; not a full schema validator. */
function isItem(x: unknown): x is Item {
  if (typeof x !== 'object' || x === null) return false;
  const i = x as Record<string, unknown>;
  return (
    typeof i.id === 'string' &&
    typeof i.rawText === 'string' &&
    typeof i.text === 'string' &&
    typeof i.capturedAt === 'number' &&
    typeof i.updatedAt === 'number' &&
    typeof i.parserVersion === 'number' &&
    ['open', 'done', 'archived'].includes(i.status as string) &&
    typeof i.textRef === 'object' &&
    typeof i.kind === 'object' &&
    Array.isArray(i.tags) &&
    Array.isArray(i.spans)
  );
}

/**
 * Merge a backup into the store. Per item, the newer `updatedAt` wins (the
 * same last-write-wins rule future sync will use). New items keep their
 * `capturedAt` but get `createdAt` = now (DECISIONS #9).
 */
export async function importBackup(store: ItemStore, data: unknown, now: number): Promise<ImportResult> {
  const backup = data as Partial<Backup> | null;
  if (backup?.format !== BACKUP_FORMAT || !Array.isArray(backup.items)) {
    throw new BackupFormatError('Not a backup file.');
  }
  if (typeof backup.version !== 'number' || backup.version > BACKUP_VERSION) {
    throw new BackupFormatError('This backup was made by a newer version of the app.');
  }

  const result: ImportResult = { added: 0, updated: 0, unchanged: 0, invalid: 0 };
  await store.db.transaction('rw', store.db.items, async () => {
    for (const raw of backup.items!) {
      if (!isItem(raw)) {
        result.invalid++;
        continue;
      }
      // Items from an older parser are upgraded the same way as on startup.
      const incoming = raw.parserVersion < PARSER_VERSION ? reparse(raw) : raw;
      const existing = await store.db.items.get(incoming.id);
      if (!existing) {
        await store.db.items.add({ ...incoming, createdAt: now });
        result.added++;
      } else if (incoming.updatedAt > existing.updatedAt) {
        await store.db.items.put({ ...incoming, createdAt: existing.createdAt });
        result.updated++;
      } else {
        result.unchanged++;
      }
    }
  });
  await store.rebuildIndex();
  return result;
}
