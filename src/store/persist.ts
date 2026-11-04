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
