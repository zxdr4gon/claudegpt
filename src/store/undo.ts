// Undo history (DECISIONS #18). Each entry holds the exact records before and
// after one change; undo restores `before` through ItemStore.revert, never by
// applying an inverse operation.

import { sameRecord, type Change, type ItemStore } from './store';

export type UndoEntry = { label: string; change: Change };
export type UndoResult = { label: string; restored: boolean };

const LIMIT = 50;

export class UndoStack {
  private entries: UndoEntry[] = [];
  private listeners = new Set<() => void>();

  /** Record a change. No-ops (nothing actually changed) aren't recorded. */
  push(label: string, change: Change): void {
    if (sameRecord(change.before, change.after)) return;
    this.entries.push({ label, change });
    if (this.entries.length > LIMIT) this.entries.shift();
    this.emit();
  }

  latest(): UndoEntry | undefined {
    return this.entries[this.entries.length - 1];
  }

  /**
   * Undo the most recent change. The entry is taken off the stack before any
   * await, so rapid repeated undos can never apply the same entry twice.
   * `restored: false` means the item changed again since (or is gone), and
   * nothing was overwritten.
   */
  async undo(store: ItemStore): Promise<UndoResult | undefined> {
    const entry = this.entries.pop();
    if (!entry) return undefined;
    this.emit();
    return { label: entry.label, restored: await store.revert(entry.change) };
  }

  /** Undo a specific entry (e.g. from its own toast), wherever it is in the stack. */
  async undoEntry(store: ItemStore, entry: UndoEntry): Promise<UndoResult | undefined> {
    const i = this.entries.indexOf(entry);
    if (i < 0) return undefined;
    this.entries.splice(i, 1);
    this.emit();
    return { label: entry.label, restored: await store.revert(entry.change) };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const l of this.listeners) l();
  }
}
