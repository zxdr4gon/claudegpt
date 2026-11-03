import { useEffect, useId, useRef, useState } from 'react';
import { usePerform } from '../app/StoreContext';
import type { Item } from '../model/item';
import type { Clock } from '../model/items';
import { snoozeAtLocal, snoozeUntil, type SnoozePreset } from '../model/snooze';
import { actions } from '../store/actions';
import { formatDay } from './format';
import { dateIn } from '../parser/time';

const PRESETS: { preset: SnoozePreset; label: string }[] = [
  { preset: 'laterToday', label: 'Later today' },
  { preset: 'tomorrow', label: 'Tomorrow' },
  { preset: 'nextWeek', label: 'Next week' },
];

function describeUntil(at: number, clock: Clock): string {
  const day = formatDay(dateIn(at, clock.tz), clock);
  const time = new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: clock.tz });
  return `${day}, ${time}`;
}

const itemClass =
  'block w-full rounded-md px-3 py-1.5 text-left text-[15px] hover:bg-rule/60 focus-visible:bg-rule/60 focus-visible:outline-none';

/** Per-item actions that don't need their own control on the row. */
export function ItemMenu({ item, clock }: { item: Item; clock: Clock }) {
  const perform = usePerform();
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pickValue, setPickValue] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function close() {
    setOpen(false);
    setPicking(false);
  }

  function run(action: Parameters<typeof perform>[1]) {
    close();
    void perform(item.id, action);
  }

  const snoozed = item.snoozedUntil != null && item.snoozedUntil > clock.now;
  const pickedAt = pickValue ? snoozeAtLocal(pickValue, clock) : null;

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
        className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-rule/60 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="currentColor">
          <circle cx="3" cy="8" r="1.5" />
          <circle cx="8" cy="8" r="1.5" />
          <circle cx="13" cy="8" r="1.5" />
        </svg>
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          className="absolute right-0 top-9 z-20 w-60 rounded-lg border border-rule bg-raised p-1 shadow-lg"
        >
          {item.status === 'open' && (
            <>
              <p className="px-3 pb-1 pt-1.5 text-[13px] text-muted">Snooze until</p>
              {PRESETS.map(({ preset, label }) => {
                const until = snoozeUntil(preset, clock);
                return (
                  <button
                    key={preset}
                    role="menuitem"
                    type="button"
                    className={itemClass}
                    onClick={() => run(actions.snooze(until, `Snoozed until ${describeUntil(until, clock)}`))}
                  >
                    {label}
                    <span className="float-right text-[13px] text-muted">{describeUntil(until, clock)}</span>
                  </button>
                );
              })}
              {picking ? (
                <form
                  className="flex flex-col gap-1.5 px-3 py-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (pickedAt) run(actions.snooze(pickedAt, `Snoozed until ${describeUntil(pickedAt, clock)}`));
                  }}
                >
                  <input
                    type="datetime-local"
                    aria-label="Snooze until"
                    autoFocus
                    value={pickValue}
                    onChange={(e) => setPickValue(e.target.value)}
                    className="rounded-md border border-rule bg-paper px-2 py-1 text-[15px]"
                  />
                  {pickValue && !pickedAt && <p className="text-[13px] text-muted">Pick a time in the future.</p>}
                  <button
                    type="submit"
                    disabled={!pickedAt}
                    className="self-end rounded-md px-2 py-1 text-[14px] font-medium text-focus disabled:text-muted"
                  >
                    Snooze
                  </button>
                </form>
              ) : (
                <button role="menuitem" type="button" className={itemClass} onClick={() => setPicking(true)}>
                  Pick date/time…
                </button>
              )}
              {snoozed && (
                <button role="menuitem" type="button" className={itemClass} onClick={() => run(actions.unsnooze())}>
                  Clear snooze
                </button>
              )}
              <hr className="my-1 border-rule" />
            </>
          )}
          {item.status === 'archived' ? (
            <button role="menuitem" type="button" className={itemClass} onClick={() => run(actions.unarchive())}>
              Unarchive
            </button>
          ) : (
            <button role="menuitem" type="button" className={itemClass} onClick={() => run(actions.archive())}>
              Archive
            </button>
          )}
          <button role="menuitem" type="button" className={itemClass} onClick={() => run(actions.remove())}>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
