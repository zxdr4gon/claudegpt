import { describe, expect, it } from 'vitest';
import { checkPersistentStorage, createPersistence, requestPersistentStorage } from './persist';

function fakeStorage({ persisted = false, grant = false, fail = false } = {}) {
  let state = persisted;
  let asks = 0;
  return {
    storage: {
      persisted: async () => {
        if (fail) throw new Error('SecurityError');
        return state;
      },
      persist: async () => {
        asks++;
        state = grant;
        return grant;
      },
    },
    asks: () => asks,
  };
}

function flag(initial = false) {
  let value = initial;
  return { get: () => value, set: () => void (value = true) };
}

describe('checkPersistentStorage (never asks)', () => {
  it('granted when already persisted', async () => {
    const f = fakeStorage({ persisted: true });
    expect(await checkPersistentStorage(f.storage, flag())).toBe('granted');
    expect(f.asks()).toBe(0);
  });

  it('not-asked until we have asked, then denied', async () => {
    const f = fakeStorage();
    expect(await checkPersistentStorage(f.storage, flag(false))).toBe('not-asked');
    expect(await checkPersistentStorage(f.storage, flag(true))).toBe('denied');
    expect(f.asks()).toBe(0);
  });

  it('unsupported without the API, or if it throws', async () => {
    expect(await checkPersistentStorage(undefined, flag())).toBe('unsupported');
    expect(await checkPersistentStorage({} as never, flag())).toBe('unsupported');
    expect(await checkPersistentStorage(fakeStorage({ fail: true }).storage, flag())).toBe('unsupported');
  });
});

describe('requestPersistentStorage', () => {
  it('asks once and reports the answer', async () => {
    const asked = flag();
    const yes = fakeStorage({ grant: true });
    expect(await requestPersistentStorage(yes.storage, asked)).toBe('granted');
    expect(asked.get()).toBe(true);

    const no = fakeStorage({ grant: false });
    expect(await requestPersistentStorage(no.storage, flag())).toBe('denied');
  });

  it('does not ask again when already granted', async () => {
    const f = fakeStorage({ persisted: true });
    expect(await requestPersistentStorage(f.storage, flag())).toBe('granted');
    expect(f.asks()).toBe(0);
  });

  it('never throws', async () => {
    expect(await requestPersistentStorage(fakeStorage({ fail: true }).storage, flag())).toBe('unsupported');
    expect(await requestPersistentStorage(undefined, flag())).toBe('unsupported');
  });

  it('after a denial, a later check says denied rather than not-asked', async () => {
    const asked = flag();
    const f = fakeStorage({ grant: false });
    await requestPersistentStorage(f.storage, asked);
    expect(await checkPersistentStorage(f.storage, asked)).toBe('denied');
  });
});

/** Storage whose answers the test releases by hand, in any order. */
function manualStorage({ persisted = false, grant = false } = {}) {
  const pending: Array<() => void> = [];
  let persistCalls = 0;
  const later = <T>(value: () => T) =>
    new Promise<T>((resolve) => pending.push(() => resolve(value())));
  let granted = persisted;
  return {
    storage: {
      // Answers with the state at the time of asking, as a slow real call would.
      persisted: () => {
        const now = granted;
        return later(() => now);
      },
      persist: () => {
        persistCalls++;
        return later(() => (granted = grant));
      },
    },
    persistCalls: () => persistCalls,
    /** Answer the call at this position in the queue (0 = oldest). */
    release: async (index: number) => {
      pending.splice(index, 1)[0]!();
      await new Promise((r) => setTimeout(r, 0));
    },
    releaseAll: async () => {
      while (pending.length) {
        pending.shift()!();
        await new Promise((r) => setTimeout(r, 0));
      }
    },
    queued: () => pending.length,
  };
}

describe('createPersistence', () => {
  it('captures in quick succession ask the browser only once', async () => {
    const m = manualStorage({ grant: true });
    const p = createPersistence(() => m.storage, flag());
    const a = p.request();
    const b = p.request();
    const c = p.request();
    expect(b).toBe(a);
    expect(c).toBe(a);
    await m.releaseAll();
    await Promise.all([a, b, c]);
    expect(m.persistCalls()).toBe(1);
    expect(p.get()).toBe('granted');

    // And never again on this page, whatever the answer was.
    await p.request();
    await m.releaseAll();
    expect(m.persistCalls()).toBe(1);
  });

  it('a slow initial check cannot overwrite a newer request', async () => {
    const m = manualStorage({ grant: true });
    const p = createPersistence(() => m.storage, flag());
    p.check(); // queue[0]: check's persisted()
    const req = p.request(); // queue[1]: request's persisted()
    await m.release(1); // request's persisted() → false, then persist() queued
    await m.release(1); // persist() → granted
    await req;
    expect(p.get()).toBe('granted');

    await m.release(0); // the old check finally answers "not persisted"
    expect(p.get()).toBe('granted');
  });

  it('a check that answers first is replaced by the request', async () => {
    const m = manualStorage({ grant: false });
    const asked = flag();
    const p = createPersistence(() => m.storage, asked);
    p.check();
    await m.release(0);
    expect(p.get()).toBe('not-asked');
    const req = p.request();
    await m.releaseAll();
    await req;
    expect(p.get()).toBe('denied');
    expect(m.persistCalls()).toBe(1);
  });

  it('checks only once however many components mount', async () => {
    const m = manualStorage();
    const p = createPersistence(() => m.storage, flag());
    p.check();
    p.check();
    p.check();
    expect(m.queued()).toBe(1);
  });

  it('does not ask again after a denial on an earlier visit, even before the check answers', async () => {
    const m = manualStorage();
    const p = createPersistence(() => m.storage, flag(true));
    p.check();
    await p.request();
    await m.releaseAll();
    expect(m.persistCalls()).toBe(0);
    expect(p.get()).toBe('denied');
  });

  it('notifies subscribers only when the state changes', async () => {
    const m = manualStorage({ grant: true });
    const p = createPersistence(() => m.storage, flag());
    let calls = 0;
    const off = p.subscribe(() => calls++);
    p.check();
    await m.releaseAll();
    expect(calls).toBe(1); // not-asked
    const req = p.request();
    await m.releaseAll();
    await req;
    expect(calls).toBe(2); // granted
    off();
  });

  it('a request never throws, even when the API does', async () => {
    const p = createPersistence(() => fakeStorage({ fail: true }).storage, flag());
    await expect(p.request()).resolves.toBeUndefined();
    expect(p.get()).toBe('unsupported');
  });
});
