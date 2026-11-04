import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { openDb, type CaptureDb } from '../db';
import type { Item } from '../model/item';
import { perform, type Action } from '../store/actions';
import { ItemStore } from '../store/store';
import { UndoStack } from '../store/undo';
import { systemClock } from './clock';

type StoreHandle = {
  db: CaptureDb;
  /** Resolves once outdated items are upgraded and the search index is built. */
  ready: Promise<ItemStore>;
  undo: UndoStack;
};

let handle: StoreHandle | undefined;

/** One database and store per page, opened on first use (safe under StrictMode). */
function getHandle(): StoreHandle {
  if (!handle) {
    const db = openDb();
    handle = { db, ready: ItemStore.open(db, systemClock), undo: new UndoStack() };
  }
  return handle;
}

const StoreContext = createContext<StoreHandle | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const value = useMemo(getHandle, []);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

function useHandle(): StoreHandle {
  const value = useContext(StoreContext);
  if (!value) throw new Error('StoreProvider is missing');
  return value;
}

/** The store, for writes. Await `ready` so a capture never needs the UI to wait first. */
export function useStore(): Promise<ItemStore> {
  return useHandle().ready;
}

/** Every item, live. `undefined` until the first read completes. */
export function useItems(): Item[] | undefined {
  const { db } = useHandle();
  return useLiveQuery(() => db.items.toArray(), [db]);
}

export function useUndoStack(): UndoStack {
  return useHandle().undo;
}

/** Run an item action through the store and record it for undo. */
export function usePerform(): (id: string, action: Action) => Promise<void> {
  const { ready, undo } = useHandle();
  return useCallback(
    async (id: string, action: Action) => {
      await perform(await ready, undo, id, action);
    },
    [ready, undo],
  );
}

/** The store once it's open; undefined until then. */
export function useOpenStore(): ItemStore | undefined {
  const { ready } = useHandle();
  const [store, setStore] = useState<ItemStore>();
  useEffect(() => {
    let live = true;
    void ready.then((s) => live && setStore(s));
    return () => {
      live = false;
    };
  }, [ready]);
  return store;
}

const noop = () => () => {};

/** Re-renders whenever the search index changes, here or from another tab. */
export function useIndexVersion(store: ItemStore | undefined): number {
  return useSyncExternalStore(
    store ? (cb) => store.index.subscribe(cb) : noop,
    () => store?.index.getVersion() ?? -1,
  );
}
