import { useCallback, useEffect, useRef, useState } from 'react';
import { useItems, useStore, useUndoStack } from './app/StoreContext';
import { handleShortcut, type Command } from './app/shortcuts';
import { useNow } from './app/useNow';
import { requestPersistenceOnce, usePersistence } from './app/usePersistence';
import { BackupPanel } from './ui/BackupPanel';
import { CAPTURE_INPUT_ID, CaptureBar } from './ui/CaptureBar';
import { SearchPanel } from './ui/SearchPanel';
import { UndoToast } from './ui/UndoToast';
import { UpdateBanner } from './ui/UpdateBanner';
import { View, VIEWS, type ViewName } from './ui/Views';

const VIEW_KEY = 'capture.view';

/** The item row that contains focus, if any. */
function focusedRow(): HTMLElement | null {
  return (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('main [data-item-id]') ?? null;
}

/**
 * After an action moves a row (e.g. completing it sends it to the Completed
 * section, which re-mounts it), keep focus on that item, or on whichever row
 * now sits where it was if it left the view.
 */
function keepRowFocus(id: string, index: number) {
  window.setTimeout(() => {
    if (document.activeElement && document.activeElement !== document.body) return;
    const rows = [...document.querySelectorAll<HTMLElement>('main [data-item-id]')];
    const target = rows.find((r) => r.dataset.itemId === id) ?? rows[Math.min(index, rows.length - 1)];
    target?.querySelector<HTMLElement>('[data-row-focus]')?.focus();
  }, 100);
}

/** j/k: move focus between item rows in the current view or search results. */
function moveFocus(step: 1 | -1) {
  const rows = [...document.querySelectorAll<HTMLElement>('main [data-item-id]')];
  if (rows.length === 0) return;
  const current = focusedRow();
  const i = current ? rows.indexOf(current) : -1;
  const next = rows[i < 0 ? (step === 1 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, i + step))];
  next?.querySelector<HTMLElement>('[data-row-focus]')?.focus();
}

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
  const undo = useUndoStack();
  const items = useItems();
  const clock = useNow();
  const [view, setView] = useState<ViewName>(initialView);
  const [searching, setSearching] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const persistence = usePersistence();
  const searchButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) =>
      handleShortcut(
        {
          key: e.key,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          altKey: e.altKey,
          shiftKey: e.shiftKey,
          isComposing: e.isComposing,
          target: e.target as HTMLElement | null,
          preventDefault: () => e.preventDefault(),
        },
        run,
      );
    // Each command acts through the same controls and actions as a click, so
    // everything stays undoable.
    const run = (command: Command) => {
      switch (command) {
        case 'search':
          setBackingUp(false);
          return setSearching(true);
        case 'undo':
          return void ready.then((store) => undo.undo(store));
        case 'capture':
          return document.getElementById(CAPTURE_INPUT_ID)?.focus();
        case 'next':
          return moveFocus(1);
        case 'previous':
          return moveFocus(-1);
        case 'toggleDone': {
          const row = focusedRow();
          if (!row) return;
          const index = [...document.querySelectorAll('main [data-item-id]')].indexOf(row);
          row.querySelector<HTMLElement>('input[type=checkbox]')?.click();
          return keepRowFocus(row.dataset.itemId!, index);
        }
        case 'edit':
          return focusedRow()?.querySelector<HTMLElement>('[data-row-focus]')?.click();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ready, undo]);

  function closeSearch() {
    setSearching(false);
    // Put focus back where search was opened from, not into the capture bar.
    requestAnimationFrame(() => searchButton.current?.focus());
  }

  const capture = useCallback(
    async (text: string) => {
      const store = await ready;
      await store.capture(text);
      // After the first capture, never before and never awaited (DECISIONS #17, #23).
      requestPersistenceOnce();
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
                aria-current={!searching && !backingUp && view === v.name ? 'page' : undefined}
                onClick={() => {
                  setSearching(false);
                  setBackingUp(false);
                  choose(v.name);
                }}
                className={`border-b-2 py-2.5 text-[15px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus ${
                  !searching && !backingUp && view === v.name ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'
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
          onClick={() => {
            setBackingUp(false);
            setSearching(true);
          }}
          aria-keyshortcuts="/ Control+K"
          className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 py-2.5 text-[15px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus ${
            searching ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'
          }`}
        >
          Search
          <kbd className="hidden rounded border border-rule px-1.5 text-[12px] font-normal text-muted sm:inline">/</kbd>
        </button>
      </nav>

      <UpdateBanner />

      <main className="pt-1">
        {items === undefined ? null : backingUp ? (
          <BackupPanel clock={clock} onClose={() => setBackingUp(false)} />
        ) : searching ? (
          <SearchPanel items={items} clock={clock} onClose={closeSearch} />
        ) : (
          <View name={view} items={items} clock={clock} />
        )}
      </main>

      <footer className="mt-auto flex flex-col gap-1 pt-16">
        {(persistence === 'denied' || persistence === 'unsupported') && (
          // Quiet and non-blocking: a fact, not a warning dialog.
          <p className="max-w-prose text-[14px] leading-6 text-muted">
            This browser may clear your data if it runs low on space. Exporting a backup now and then keeps it safe.
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            setSearching(false);
            setBackingUp(true);
            window.scrollTo({ top: 0 });
          }}
          className="w-fit text-[14px] text-muted underline-offset-2 hover:text-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
        >
          Backup and restore
        </button>
      </footer>

      <UndoToast />
    </div>
  );
}
