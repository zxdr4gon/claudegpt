import { useEffect, useState, useSyncExternalStore } from 'react';
import { useStore, useUndoStack } from '../app/StoreContext';
import type { UndoEntry } from '../store/undo';

const VISIBLE_MS = 6000;

/**
 * Shows each newly recorded action with an Undo button for a few seconds.
 * Undoing one never brings back the toast of an older action.
 */
export function UndoToast() {
  const undo = useUndoStack();
  const ready = useStore();
  const recent = useSyncExternalStore(
    (cb) => undo.subscribe(cb),
    () => undo.recent(),
  );
  const [shown, setShown] = useState<UndoEntry | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  // Show each new entry for a while.
  useEffect(() => {
    if (!recent) return;
    setShown(recent);
    setMessage(null);
    const id = window.setTimeout(() => setShown(undefined), VISIBLE_MS);
    return () => window.clearTimeout(id);
  }, [recent]);

  // Hide a status message after a while too.
  useEffect(() => {
    if (!message) return;
    const id = window.setTimeout(() => setMessage(null), VISIBLE_MS);
    return () => window.clearTimeout(id);
  }, [message]);

  async function onUndo(entry: UndoEntry) {
    setShown(undefined);
    const result = await undo.undoEntry(await ready, entry);
    if (result && !result.restored) setMessage('Couldn’t undo: that item has changed since.');
  }

  const visible = shown;
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center px-4">
      {visible && (
        <div className="pointer-events-auto flex items-center gap-4 rounded-lg bg-ink px-4 py-2.5 text-[15px] text-paper shadow-lg">
          <span>{visible.label}</span>
          <button
            type="button"
            onClick={() => void onUndo(visible)}
            className="font-semibold underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-paper"
          >
            Undo
          </button>
        </div>
      )}
      {!visible && message && (
        <div className="pointer-events-auto rounded-lg bg-ink px-4 py-2.5 text-[15px] text-paper shadow-lg">{message}</div>
      )}
    </div>
  );
}
