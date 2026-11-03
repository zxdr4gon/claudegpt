import { useCallback, useRef, useState } from 'react';
import { useItems, useStore } from './app/StoreContext';
import { useNow } from './app/useNow';
import { requestPersistentStorage } from './store/persist';
import { CaptureBar } from './ui/CaptureBar';
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
  const askedPersistence = useRef(false);

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

      <nav aria-label="Views" className="mt-4 border-b border-rule">
        <ul className="-mb-px flex gap-5 overflow-x-auto">
          {VIEWS.map((v) => (
            <li key={v.name}>
              <button
                type="button"
                aria-current={view === v.name ? 'page' : undefined}
                onClick={() => choose(v.name)}
                className={`border-b-2 py-2.5 text-[15px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus ${
                  view === v.name ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'
                }`}
              >
                {v.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <main className="pt-1">
        {items === undefined ? null : <View name={view} items={items} clock={clock} />}
      </main>

      <UndoToast />
    </div>
  );
}
