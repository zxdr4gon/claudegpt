// Undo history (DECISIONS #18). Each entry holds the exact records before and
// after one change; undo restores `before` through ItemStore.revert, never by
// applying an inverse operation.

import { sameRecord, type Change, type ItemStore } from './store';

export type UndoEntry = { label: string; change: Change };

/**
 * What the last undo attempt did, so the UI can always say so (#21):
 * - restored: the previous record is back.
 * - refused: the item changed since (here or in another tab), so nothing was overwritten.
 * - empty: there was nothing to undo.
 * - failed: saving the restore failed; the entry is back on the stack to retry.
 */
export type UndoOutcome =
  | { kind: 'restored'; label: string }
  | { kind: 'refused'; label: string }
  | { kind: 'empty' }
  | { kind: 'failed'; label: string };

const LIMIT = 50;

export class UndoStack {
  private entries: UndoEntry[] = [];
  private lastPushed: UndoEntry | undefined;
  private lastOutcome: UndoOutcome | undefined;
  private listeners = new Set<() => void>();

  /** Record a change. No-ops (nothing actually changed) aren't recorded. */
  push(label: string, change: Change): void {
    if (sameRecord(change.before, change.after)) return;
    const entry = { label, change };
    this.entries.push(entry);
    this.lastPushed = entry;
    if (this.entries.length > LIMIT) this.entries.shift();
    this.emit();
  }

  latest(): UndoEntry | undefined {
    return this.entries[this.entries.length - 1];
  }

  /**
   * The most recently recorded action, even if already undone. The toast
   * follows this, so undoing never resurfaces an older action's toast.
   */
  recent(): UndoEntry | undefined {
    return this.lastPushed;
  }

  /** The result of the most recent undo attempt (a new object each time). */
  outcome(): UndoOutcome | undefined {
    return this.lastOutcome;
  }

  /**
   * Undo the most recent change. The entry is taken off the stack before any
   * await, so rapid repeated undos can never apply the same entry twice.
   */
  async undo(store: ItemStore): Promise<UndoOutcome> {
    const entry = this.entries.pop();
    if (!entry) return this.report({ kind: 'empty' });
    return this.run(store, entry);
  }

  /** Undo a specific entry (e.g. from its own toast), wherever it is in the stack. */
  async undoEntry(store: ItemStore, entry: UndoEntry): Promise<UndoOutcome> {
    const i = this.entries.indexOf(entry);
    if (i < 0) return this.report({ kind: 'empty' });
    this.entries.splice(i, 1);
    return this.run(store, entry);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async run(store: ItemStore, entry: UndoEntry): Promise<UndoOutcome> {
    this.emit();
    try {
      const restored = await store.revert(entry.change);
      return this.report({ kind: restored ? 'restored' : 'refused', label: entry.label });
    } catch {
      // Nothing was written; keep the entry so the user can try again.
      this.entries.push(entry);
      return this.report({ kind: 'failed', label: entry.label });
    }
  }

  private report(outcome: UndoOutcome): UndoOutcome {
    this.lastOutcome = outcome;
    this.emit();
    return outcome;
  }

  private emit() {
    for (const l of this.listeners) l();
  }
}
