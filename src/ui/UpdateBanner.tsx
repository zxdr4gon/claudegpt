import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * Tells the user when a new version of the app is ready (DECISIONS #23). It
 * never reloads by itself: reloading could throw away text being typed, so the
 * user chooses when. Item data is in IndexedDB and is untouched by updates.
 */
export function UpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;
  return (
    <div role="status" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rule bg-raised px-4 py-2.5 text-[15px]">
      <span>A new version of Capture is ready.</span>
      <span className="flex gap-2">
        <button
          type="button"
          onClick={() => void updateServiceWorker(true)}
          className="rounded-md px-2 py-1 font-medium text-focus hover:bg-focus/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
        >
          Reload to update
        </button>
        <button
          type="button"
          onClick={() => setNeedRefresh(false)}
          className="rounded-md px-2 py-1 text-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
        >
          Later
        </button>
      </span>
    </div>
  );
}
