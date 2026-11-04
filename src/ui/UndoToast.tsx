import { useEffect, useState, useSyncExternalStore } from 'react';
import { useStore, useUndoStack } from '../app/StoreContext';
import type { UndoEntry, UndoOutcome } from '../store/undo';

const VISIBLE_MS = 6000;

function describe(outcome: UndoOutcome): string {
  switch (outcome.kind) {
    case 'restored':
      return `Undone: ${outcome.label.toLowerCase()}`;
    case 'refused':
      return `Couldn’t undo “${outcome.label}”: that item has changed since.`;
    case 'empty':
      return 'Nothing to undo.';
    case 'failed':
      return `Couldn’t undo “${outcome.label}”. Try again.`;
  }
}

/**
 * Shows each newly recorded action with an Undo button, and the result of
 * every undo attempt, from the button or Ctrl+Z, so undo is never silent (#21).
 * Undoing one action never brings back the toast of an older action.
 */
export function UndoToast() {
  const undo = useUndoStack();
  const ready = useStore();
  const subscribe = (cb: () => void) => undo.subscribe(cb);
  const recent = useSyncExternalStore(subscribe, () => undo.recent());
  const outcome = useSyncExternalStore(subscribe, () => undo.outcome());
  const [shown, setShown] = useState<UndoEntry | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  // Show each new action for a while.
  useEffect(() => {
    if (!recent) return;
    setShown(recent);
    setMessage(null);
    const id = window.setTimeout(() => setShown(undefined), VISIBLE_MS);
    return () => window.clearTimeout(id);
  }, [recent]);

  // Report each undo attempt (a new outcome object every time).
  useEffect(() => {
    if (!outcome) return;
    setShown(undefined);
    setMessage(describe(outcome));
    const id = window.setTimeout(() => setMessage(null), VISIBLE_MS);
    return () => window.clearTimeout(id);
  }, [outcome]);

  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center px-4">
      {shown ? (
        <div className="pointer-events-auto flex items-center gap-4 rounded-lg bg-ink px-4 py-2.5 text-[15px] text-paper shadow-lg">
          <span>{shown.label}</span>
          <button
            type="button"
            onClick={async () => void undo.undoEntry(await ready, shown)}
            aria-keyshortcuts="Control+Z"
            className="font-semibold underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-paper"
          >
            Undo
          </button>
        </div>
      ) : (
        message && (
          <div role="status" className="pointer-events-auto rounded-lg bg-ink px-4 py-2.5 text-[15px] text-paper shadow-lg">
            {message}
          </div>
        )
      )}
    </div>
  );
}
