import { useEffect, useSyncExternalStore } from 'react';
import { createPersistence, type PersistState } from '../store/persist';

// One shared state for the page, so the footer and the backup panel agree.
const persistence = createPersistence();

/** The persistent-storage state; undefined until the first check finishes. */
export function usePersistence(): PersistState | undefined {
  useEffect(() => persistence.check(), []);
  return useSyncExternalStore(persistence.subscribe, persistence.get);
}

/**
 * Ask once, after the first capture (DECISIONS #17, #23). Fire and forget:
 * capture never waits for this, and it never throws.
 */
export function requestPersistenceOnce(): void {
  void persistence.request();
}
