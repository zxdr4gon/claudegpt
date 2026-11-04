import { describe, expect, it } from 'vitest';
import { checkPersistentStorage, requestPersistentStorage } from './persist';

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
