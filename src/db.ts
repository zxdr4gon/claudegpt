import Dexie, { type EntityTable } from 'dexie';
import type { Item } from './model/item';
import { upgradeShape } from './model/migrate';

/** Small app-level facts, e.g. when the last export happened (DECISIONS #4). */
export type Meta = { key: string; value: unknown };

export type CaptureDb = Dexie & {
  items: EntityTable<Item, 'id'>;
  meta: EntityTable<Meta, 'key'>;
};

export function openDb(name = 'capture'): CaptureDb {
  const db = new Dexie(name) as CaptureDb;
  // Indexes only; Dexie stores every other field as-is. Never edit or remove a
  // version block: add a new one with an upgrade function instead.
  db.version(1).stores({
    items: 'id, status, capturedAt, updatedAt, deletedAt, parserVersion',
    meta: 'key',
  });
  // v2: timed due dates gained `zone` (replacing `tz`). Migrates user-owned
  // values too; parsed ones are also re-derived by the PARSER_VERSION bump.
  db.version(2).upgrade((tx) =>
    tx
      .table('items')
      .toCollection()
      .modify((item, ref) => {
        ref.value = upgradeShape(item);
      }),
  );
  return db;
}
