// Persistent storage (DECISIONS #4, #23). Browsers may clear site data when
// space runs low unless storage is marked persistent, and they decide whether
// to grant that. We ask after the first capture, never block on it, and never
// claim the data is guaranteed.

/**
 * - granted: the browser says it won't clear this data on its own.
 * - denied: we asked and it said no (or hasn't said yes yet).
 * - not-asked: we haven't asked yet (nothing captured in this browser so far).
 * - unsupported: this browser has no way to ask.
 */
export type PersistState = 'granted' | 'denied' | 'not-asked' | 'unsupported';

type StorageLike = Pick<StorageManager, 'persist' | 'persisted'> | undefined;

const ASKED_KEY = 'capture.persistAsked';

/** Remembers that we've asked, so a later "not persisted" means denied. */
type AskedFlag = { get(): boolean; set(): void };

export const localAskedFlag: AskedFlag = {
  get() {
    try {
      return localStorage.getItem(ASKED_KEY) === '1';
    } catch {
      return false;
    }
  },
  set() {
    try {
      localStorage.setItem(ASKED_KEY, '1');
    } catch {
      // Without storage we may ask again next time; harmless.
    }
  },
};

const storageOf = (): StorageLike => globalThis.navigator?.storage;

/** The current state, without asking the browser for anything. */
export async function checkPersistentStorage(
  storage: StorageLike = storageOf(),
  asked: AskedFlag = localAskedFlag,
): Promise<PersistState> {
  if (!storage?.persisted || !storage.persist) return 'unsupported';
  try {
    if (await storage.persisted()) return 'granted';
  } catch {
    return 'unsupported';
  }
  return asked.get() ? 'denied' : 'not-asked';
}

/** Ask the browser not to evict our data. Never throws. */
export async function requestPersistentStorage(
  storage: StorageLike = storageOf(),
  asked: AskedFlag = localAskedFlag,
): Promise<PersistState> {
  if (!storage?.persisted || !storage.persist) return 'unsupported';
  try {
    if (await storage.persisted()) return 'granted';
    asked.set();
    return (await storage.persist()) ? 'granted' : 'denied';
  } catch {
    return 'unsupported';
  }
}

export type Persistence = {
  /** The latest known state; undefined until something has answered. */
  get(): PersistState | undefined;
  subscribe(listener: () => void): () => void;
  /** Look up the state once per page, without asking the browser. */
  check(): void;
  /**
   * Ask at most once per page (DECISIONS #23). Calls made while a request is
   * in flight, or after one, share it. Fire and forget; never throws.
   */
  request(): Promise<void>;
};

/**
 * The page's one view of persistent storage. Results are applied in the order
 * their lookups started, so a slow initial check can never overwrite the
 * answer to a request that began after it.
 */
export function createPersistence(
  storage: () => StorageLike = storageOf,
  asked: AskedFlag = localAskedFlag,
): Persistence {
  let state: PersistState | undefined;
  let applied = 0; // sequence number of the result currently in `state`
  let started = 0;
  let checking = false;
  let requesting: Promise<void> | undefined;
  const listeners = new Set<() => void>();

  const run = (lookup: () => Promise<PersistState>): Promise<void> => {
    const seq = ++started;
    return lookup().then(
      (next) => {
        if (seq < applied) return; // a newer lookup already answered
        applied = seq;
        if (next === state) return;
        state = next;
        for (const l of listeners) l();
      },
      () => undefined, // both lookups already catch; belt and braces
    );
  };

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    check() {
      if (checking) return;
      checking = true;
      void run(() => checkPersistentStorage(storage(), asked));
    },
    request() {
      // Already settled for this browser: granted, unsupported, or denied on
      // an earlier visit. Asking again would only nag.
      // The flag also covers a reload where the first check hasn't answered yet.
      if (state === 'granted' || state === 'denied' || state === 'unsupported') return Promise.resolve();
      if (!requesting && asked.get()) return Promise.resolve();
      requesting ??= run(() => requestPersistentStorage(storage(), asked));
      return requesting;
    },
  };
}
