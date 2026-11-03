import Dexie, { type EntityTable } from 'dexie';
import type { Item } from './model/item';

/** Small app-level facts, e.g. when the last export happened (DECISIONS #4). */
export type Meta = { key: string; value: unknown };

export type CaptureDb = Dexie & {
  items: EntityTable<Item, 'id'>;
  meta: EntityTable<Meta, 'key'>;
};

export function openDb(name = 'capture'): CaptureDb {
  const db = new Dexie(name) as CaptureDb;
  // Indexes only; Dexie stores every other field as-is. Never remove a
  // version block: add a new one with an upgrade function instead.
  db.version(1).stores({
    items: 'id, status, capturedAt, updatedAt, deletedAt, parserVersion',
    meta: 'key',
  });
  return db;
}
