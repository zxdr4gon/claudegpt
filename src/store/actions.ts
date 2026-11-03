// The user-facing item actions. Each is one model function run through
// ItemStore.change and recorded for undo with the toast label it produces.

import type { Due, Item, Kind, Priority } from '../model/item';
import * as model from '../model/items';
import type { Clock } from '../model/items';
import type { ItemStore } from './store';
import type { UndoStack } from './undo';

export type Action = { label: string; apply: (item: Item, clock: Clock) => Item };

export const actions = {
  complete: (): Action => ({ label: 'Completed', apply: (i, c) => model.setStatus(i, 'done', c) }),
  reopen: (): Action => ({ label: 'Reopened', apply: (i, c) => model.setStatus(i, 'open', c) }),
  archive: (): Action => ({ label: 'Archived', apply: (i, c) => model.setStatus(i, 'archived', c) }),
  unarchive: (): Action => ({ label: 'Unarchived', apply: (i, c) => model.setStatus(i, 'open', c) }),
  remove: (): Action => ({ label: 'Deleted', apply: model.softDelete }),
  snooze: (until: number, label = 'Snoozed'): Action => ({ label, apply: (i, c) => model.snooze(i, until, c) }),
  unsnooze: (): Action => ({ label: 'Snooze cleared', apply: (i, c) => model.snooze(i, null, c) }),
  editText: (text: string): Action => ({ label: 'Edited', apply: (i, c) => model.editText(i, text, c) }),
  setDue: (due: Due | null): Action => ({
    label: due ? 'Date changed' : 'Date removed',
    apply: (i, c) => model.setDue(i, due, c),
  }),
  setKind: (kind: Kind): Action => ({ label: `Marked as ${kind}`, apply: (i, c) => model.setKind(i, kind, c) }),
  setPriority: (p: Priority | null): Action => ({
    label: p ? `Priority ${p}` : 'Priority removed',
    apply: (i, c) => model.setPriority(i, p, c),
  }),
  addTag: (tag: string): Action => ({ label: `Added #${tag}`, apply: (i, c) => model.addTag(i, tag, c) }),
  removeTag: (tag: string): Action => ({ label: `Removed #${tag}`, apply: (i, c) => model.removeTag(i, tag, c) }),
  resetField: (field: 'kind' | 'due' | 'priority' | 'url'): Action => ({
    label: 'Reset to detected',
    apply: (i, c) => model.resetField(i, field, c),
  }),
  resetTag: (tag: string): Action => ({ label: `Reset #${tag}`, apply: (i, c) => model.resetTag(i, tag, c) }),
};

/** Run an action on one item and record it for undo. */
export async function perform(store: ItemStore, undo: UndoStack, id: string, action: Action): Promise<Item> {
  const change = await store.change(id, action.apply);
  undo.push(action.label, change);
  return change.after;
}
