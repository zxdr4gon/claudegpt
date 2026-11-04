import { useCallback, useEffect, useRef, useState } from 'react';
import { useItems, useStore } from './app/StoreContext';
import { shortcutFor } from './app/shortcuts';
import { useNow } from './app/useNow';
import { requestPersistentStorage } from './store/persist';
import { CaptureBar } from './ui/CaptureBar';
import { SearchPanel } from './ui/SearchPanel';
import { UndoToast } from './ui/UndoToast';
import { View, VIEWS, type ViewName } from './ui/Views';

const VIEW_KEY = 'capture.view';

function initialView(): ViewName {
  try {
    const saved = localStorage.getItem(VIEW_KEY);
    if (VIEWS.some((v) => v.name === saved)) return saved as ViewName;
  } catch {
    // Storage can be unavailable (private mode); the default is fine.
  }
  return 'inbox';
}

export function App() {
  const ready = useStore();
  const items = useItems();
  const clock = useNow();
  const [view, setView] = useState<ViewName>(initialView);
  const [searching, setSearching] = useState(false);
  const askedPersistence = useRef(false);
  const searchButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const command = shortcutFor({
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        isComposing: e.isComposing,
        target: e.target as HTMLElement | null,
      });
      if (command !== 'search') return;
      e.preventDefault();
      setSearching(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function closeSearch() {
    setSearching(false);
    // Put focus back where search was opened from, not into the capture bar.
    requestAnimationFrame(() => searchButton.current?.focus());
  }

  const capture = useCallback(
    async (text: string) => {
      const store = await ready;
      await store.capture(text);
      // After the first capture, never before and never awaited (DECISIONS #17).
      if (!askedPersistence.current) {
        askedPersistence.current = true;
        void requestPersistentStorage().catch(() => undefined);
      }
    },
    [ready],
  );

  function choose(name: ViewName) {
    setView(name);
    try {
      localStorage.setItem(VIEW_KEY, name);
    } catch {
      // Not remembering the tab is harmless.
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-[42rem] flex-col px-4 pb-16 sm:px-6">
      <header className="sticky top-0 z-10 -mx-4 bg-paper/95 px-4 pb-3 pt-5 backdrop-blur sm:-mx-6 sm:px-6 sm:pt-10">
        <CaptureBar onCapture={capture} />
      </header>

      <nav aria-label="Views" className="mt-4 flex items-end justify-between gap-4 border-b border-rule">
        <ul className="-mb-px flex gap-5 overflow-x-auto">
          {VIEWS.map((v) => (
            <li key={v.name}>
              <button
                type="button"
                aria-current={!searching && view === v.name ? 'page' : undefined}
                onClick={() => {
                  setSearching(false);
                  choose(v.name);
                }}
                className={`border-b-2 py-2.5 text-[15px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus ${
                  !searching && view === v.name ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'
                }`}
              >
                {v.label}
              </button>
            </li>
          ))}
        </ul>
        <button
          ref={searchButton}
          type="button"
          onClick={() => setSearching(true)}
          aria-keyshortcuts="/ Control+K"
          className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 py-2.5 text-[15px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus ${
            searching ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'
          }`}
        >
          Search
          <kbd className="hidden rounded border border-rule px-1.5 text-[12px] font-normal text-muted sm:inline">/</kbd>
        </button>
      </nav>

      <main className="pt-1">
        {items === undefined ? null : searching ? (
          <SearchPanel items={items} clock={clock} onClose={closeSearch} />
        ) : (
          <View name={view} items={items} clock={clock} />
        )}
      </main>

      <UndoToast />
    </div>
  );
}
