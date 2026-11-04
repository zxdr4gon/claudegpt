import { useState } from 'react';
import { usePerform } from '../app/StoreContext';
import type { Item } from '../model/item';
import type { Clock } from '../model/items';
import { snoozeAtLocal, snoozeUntil, type SnoozePreset } from '../model/snooze';
import { dateIn } from '../parser/time';
import { actions, type Action } from '../store/actions';
import { formatDay } from './format';
import { MenuDivider, MenuNote, Popover, menuItemClass } from './Popover';

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

function PickSnooze({ clock, onPick }: { clock: Clock; onPick: (at: number) => void }) {
  const [value, setValue] = useState('');
  const at = value ? snoozeAtLocal(value, clock) : null;
  return (
    <form
      className="flex flex-col gap-1.5 px-3 py-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (at) onPick(at);
      }}
    >
      <input
        type="datetime-local"
        aria-label="Snooze until"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="rounded-md border border-rule bg-paper px-2 py-1 text-[15px]"
      />
      {value && !at && <p className="text-[13px] text-muted">Pick a time in the future.</p>}
      <button type="submit" disabled={!at} className="self-end rounded-md px-2 py-1 text-[14px] font-medium text-focus disabled:text-muted">
        Snooze
      </button>
    </form>
  );
}

/** Per-item actions that don't need their own control on the row. */
export function ItemMenu({ item, clock }: { item: Item; clock: Clock }) {
  const perform = usePerform();
  const [picking, setPicking] = useState(false);
  const snoozed = item.snoozedUntil != null && item.snoozedUntil > clock.now;

  return (
    <Popover
      trigger={(props) => (
        <button
          type="button"
          aria-label="More actions"
          {...props}
          onClick={() => {
            setPicking(false);
            props.onClick();
          }}
          className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-rule/60 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="currentColor">
            <circle cx="3" cy="8" r="1.5" />
            <circle cx="8" cy="8" r="1.5" />
            <circle cx="13" cy="8" r="1.5" />
          </svg>
        </button>
      )}
    >
      {(close) => {
        const run = (action: Action) => {
          close();
          void perform(item.id, action);
        };
        const snoozeTo = (at: number) => run(actions.snooze(at, `Snoozed until ${describeUntil(at, clock)}`));
        return (
          <>
            {item.status === 'open' && (
              <>
                <MenuNote>Snooze until</MenuNote>
                {PRESETS.map(({ preset, label }) => {
                  const until = snoozeUntil(preset, clock);
                  return (
                    <button key={preset} role="menuitem" type="button" className={menuItemClass} onClick={() => snoozeTo(until)}>
                      {label}
                      <span className="float-right text-[13px] text-muted">{describeUntil(until, clock)}</span>
                    </button>
                  );
                })}
                {picking ? (
                  <PickSnooze clock={clock} onPick={snoozeTo} />
                ) : (
                  <button role="menuitem" type="button" className={menuItemClass} onClick={() => setPicking(true)}>
                    Pick date/time…
                  </button>
                )}
                {snoozed && (
                  <button role="menuitem" type="button" className={menuItemClass} onClick={() => run(actions.unsnooze())}>
                    Clear snooze
                  </button>
                )}
                <MenuDivider />
              </>
            )}
            {item.status === 'archived' ? (
              <button role="menuitem" type="button" className={menuItemClass} onClick={() => run(actions.unarchive())}>
                Unarchive
              </button>
            ) : (
              <button role="menuitem" type="button" className={menuItemClass} onClick={() => run(actions.archive())}>
                Archive
              </button>
            )}
            <button role="menuitem" type="button" className={menuItemClass} onClick={() => run(actions.remove())}>
              Delete
            </button>
          </>
        );
      }}
    </Popover>
  );
}
