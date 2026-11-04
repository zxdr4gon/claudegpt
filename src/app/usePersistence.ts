import { useEffect, useSyncExternalStore } from 'react';
import { checkPersistentStorage, requestPersistentStorage, type PersistState } from '../store/persist';

// One shared state for the page, so the footer and the backup panel agree.
let state: PersistState | undefined;
const listeners = new Set<() => void>();

function set(next: PersistState) {
  state = next;
  for (const l of listeners) l();
}

let checked = false;

/** The persistent-storage state; undefined until the first check finishes. */
export function usePersistence(): PersistState | undefined {
  useEffect(() => {
    if (checked) return;
    checked = true;
    void checkPersistentStorage().then(set);
  }, []);
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

/**
 * Ask once, after the first capture (DECISIONS #17). Fire and forget: capture
 * never waits for this, and it never throws.
 */
export function requestPersistenceOnce(): void {
  if (state === 'granted' || state === 'denied' || state === 'unsupported') return;
  void requestPersistentStorage().then(set);
}
