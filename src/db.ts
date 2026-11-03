import Dexie, { type EntityTable } from 'dexie';
import type { Item } from './model/item';

export const db = new Dexie('capture') as Dexie & {
  items: EntityTable<Item, 'id'>;
};

// Indexes only; Dexie stores every other field as-is.
db.version(1).stores({
  items: 'id, status, capturedAt, updatedAt, deletedAt',
});
