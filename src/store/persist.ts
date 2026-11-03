export type PersistResult = 'granted' | 'denied' | 'unsupported';

/** Ask the browser not to evict our data under storage pressure (DECISIONS #4). */
export async function requestPersistentStorage(): Promise<PersistResult> {
  const storage = globalThis.navigator?.storage;
  if (!storage?.persist) return 'unsupported';
  if (await storage.persisted()) return 'granted';
  return (await storage.persist()) ? 'granted' : 'denied';
}
