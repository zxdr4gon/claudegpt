import { useState } from 'react';
import { usePerform } from '../app/StoreContext';
import { chipsFor, dueFromInputs, type Chip } from '../model/chips';
import type { Item, Kind, Priority } from '../model/item';
import type { Clock } from '../model/items';
import { dateIn, wallClock } from '../parser/time';
import { actions, type Action } from '../store/actions';
import { formatDue } from './format';
import { MARK_CLASS } from './HighlightedText';
import { MenuDivider, MenuNote, Popover, menuItemClass } from './Popover';

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./u, '');
  } catch {
    return url;
  }
}

const KIND_LABEL: Record<Kind, string> = { task: 'Task', note: 'Note', link: 'Link' };

const CHIP_CLASS: Record<Chip['field'], string> = {
  kind: 'bg-rule/70',
  due: MARK_CLASS.due,
  tag: MARK_CLASS.tag,
  priority: MARK_CLASS.priority,
  url: MARK_CLASS.url,
};

function chipLabel(chip: Chip, clock: Clock): string {
  if (chip.dismissed) return chip.field === 'tag' ? `#${chip.text}` : chip.text!;
  switch (chip.field) {
    case 'kind':
      return KIND_LABEL[chip.kind!];
    case 'due':
      return formatDue(chip.due!, clock);
    case 'tag':
      return `#${chip.text}`;
    case 'priority':
      return `Priority ${chip.priority}`;
    case 'url':
      return hostOf(chip.url!);
  }
}

/** What the chip means, for screen readers and the tooltip. */
function chipDescription(chip: Chip, label: string): string {
  if (chip.dismissed) return `${label}, removed by you`;
  return chip.source === 'user' ? `${label}, set by you` : `${label}, detected`;
}

function chipClass(chip: Chip): string {
  const base = 'rounded px-1.5 py-0.5 text-[13px] leading-5';
  if (chip.dismissed) return `${base} bg-transparent text-muted line-through ring-1 ring-inset ring-rule`;
  // User-set values get a thin outline, so "set by you" is visible at a glance.
  const owned = chip.source === 'user' ? 'ring-1 ring-inset ring-ink/25' : '';
  return `${base} ${CHIP_CLASS[chip.field]} ${owned}`;
}

/** Read-only chips, e.g. for the capture preview. */
export function Chips({ item, clock }: { item: Item; clock: Clock }) {
  const chips = chipsFor(item);
  if (chips.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Detected details">
      {chips.map((c) => {
        const label = chipLabel(c, clock);
        return (
          <li key={c.key} className={chipClass(c)} title={chipDescription(c, label)}>
            {label}
          </li>
        );
      })}
    </ul>
  );
}

/** Today's date in the viewer's zone, for the date input's default. */
function todayInput(clock: Clock) {
  return dateIn(clock.now, clock.tz);
}

function DueEditor({ chip, clock, onSave }: { chip: Chip; clock: Clock; onSave: (action: Action) => void }) {
  const due = chip.due;
  const initialDate = due ? (due.type === 'date' ? due.date : dateIn(due.at, clock.tz)) : todayInput(clock);
  const initialTime = (() => {
    if (due?.type !== 'instant') return '';
    const w = wallClock(due.at, clock.tz);
    return `${String(w.hour).padStart(2, '0')}:${String(w.minute).padStart(2, '0')}`;
  })();
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(initialTime);
  const next = dueFromInputs(date, time, clock.tz);
  return (
    <form
      className="flex flex-col gap-1.5 px-3 py-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (next) onSave(actions.setDue(next));
      }}
    >
      <div className="flex gap-1.5">
        <input
          type="date"
          aria-label="Date"
          autoFocus
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-rule bg-paper px-2 py-1 text-[15px]"
        />
        <input
          type="time"
          aria-label="Time (optional)"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className="w-[6.5rem] rounded-md border border-rule bg-paper px-2 py-1 text-[15px]"
        />
      </div>
      <p className="text-[13px] text-muted">{next ? 'Leave the time empty for an all-day date.' : 'Enter a real date.'}</p>
      <button type="submit" disabled={!next} className="self-end rounded-md px-2 py-1 text-[14px] font-medium text-focus disabled:text-muted">
        Save date
      </button>
    </form>
  );
}

function ChipMenu({ chip, item, clock }: { chip: Chip; item: Item; clock: Clock }) {
  const perform = usePerform();
  const [editingDate, setEditingDate] = useState(false);
  const label = chipLabel(chip, clock);
  const field = chip.field === 'tag' ? null : chip.field;

  return (
    <Popover
      align="left"
      width="w-64"
      trigger={(props) => (
        <button
          type="button"
          {...props}
          onClick={() => {
            setEditingDate(false);
            props.onClick();
          }}
          aria-label={chipDescription(chip, label)}
          title={chipDescription(chip, label)}
          className={`${chipClass(chip)} hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus dark:hover:brightness-110`}
        >
          {label}
        </button>
      )}
    >
      {(close) => {
        const run = (action: Action) => {
          close();
          void perform(item.id, action);
        };
        const item_ = (text: string, action: Action) => (
          <button key={text} role="menuitem" type="button" className={menuItemClass} onClick={() => run(action)}>
            {text}
          </button>
        );
        const resetToText = chip.source === 'user' && field && !chip.dismissed && item_('Reset to what the text says', actions.resetField(field));

        if (chip.dismissed) {
          return (
            <>
              <MenuNote>You removed this. The text still says “{chip.field === 'tag' ? `#${chip.text}` : chip.text}”.</MenuNote>
              {chip.field === 'tag'
                ? item_('Restore tag', actions.resetTag(chip.text!))
                : item_('Restore what the text says', actions.resetField(field!))}
            </>
          );
        }

        switch (chip.field) {
          case 'kind':
            return (
              <>
                <MenuNote>{chip.source === 'user' ? 'Set by you' : 'Detected from the text'}</MenuNote>
                {(['task', 'note', 'link'] as const)
                  .filter((k) => k !== chip.kind)
                  .map((k) => item_(`Mark as ${k}`, actions.setKind(k)))}
                {resetToText && (
                  <>
                    <MenuDivider />
                    {resetToText}
                  </>
                )}
              </>
            );
          case 'due':
            return (
              <>
                <MenuNote>{chip.source === 'user' ? 'Set by you' : 'Detected from the text'}</MenuNote>
                {editingDate ? (
                  <DueEditor chip={chip} clock={clock} onSave={run} />
                ) : (
                  <button role="menuitem" type="button" className={menuItemClass} onClick={() => setEditingDate(true)}>
                    Change date…
                  </button>
                )}
                {item_('Remove date', actions.setDue(null))}
                {resetToText}
              </>
            );
          case 'tag':
            return (
              <>
                <MenuNote>{chip.source === 'user' ? 'Added by you' : 'Detected from the text'}</MenuNote>
                {item_('Remove tag', actions.removeTag(chip.text!))}
              </>
            );
          case 'priority':
            return (
              <>
                <MenuNote>{chip.source === 'user' ? 'Set by you' : 'Detected from the text'}</MenuNote>
                {([1, 2, 3] as Priority[])
                  .filter((p) => p !== chip.priority)
                  .map((p) => item_(`Priority ${p}`, actions.setPriority(p)))}
                {item_('Remove priority', actions.setPriority(null))}
                {resetToText}
              </>
            );
          case 'url':
            return (
              <>
                <a
                  role="menuitem"
                  href={chip.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={menuItemClass}
                  onClick={close}
                >
                  Open link
                </a>
                {item_('Remove link', actions.setUrl(null))}
                {resetToText}
              </>
            );
        }
      }}
    </Popover>
  );
}

/** Chips on a saved item: each opens a menu to correct, remove or restore it. */
export function EditableChips({ item, clock }: { item: Item; clock: Clock }) {
  const chips = chipsFor(item, { includeKind: true });
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Details">
      {chips.map((c) => (
        <li key={c.key}>
          <ChipMenu chip={c} item={item} clock={clock} />
        </li>
      ))}
    </ul>
  );
}
