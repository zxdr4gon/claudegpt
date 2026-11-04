import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePerform } from '../app/StoreContext';
import type { Item } from '../model/item';
import type { Clock } from '../model/items';
import { actions } from '../store/actions';
import { EditableChips } from './Chips';
import { HighlightedText } from './HighlightedText';
import { ItemMenu } from './ItemMenu';

/**
 * Inline text editing: Enter saves, Escape cancels, Shift+Enter adds a line.
 * `onDone(returnFocus)`: Enter and Escape hand focus back to the row; a blur
 * (the user clicked elsewhere) doesn't take it back.
 */
function TextEditor({ item, onDone }: { item: Item; onDone: (returnFocus: boolean) => void }) {
  const perform = usePerform();
  const [value, setValue] = useState(item.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  // Closing the editor blurs it; without this, Escape would save via onBlur.
  const finished = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  function finish(saveIt: boolean, returnFocus: boolean) {
    if (finished.current) return;
    finished.current = true;
    onDone(returnFocus);
    const text = value.trim();
    if (saveIt && text && text !== item.text) void perform(item.id, actions.editText(text));
  }


  return (
    <textarea
      ref={ref}
      autoFocus
      rows={1}
      aria-label="Edit text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true, false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          finish(true, true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(false, true);
        }
      }}
      className="-mx-1.5 block w-[calc(100%+0.75rem)] resize-none rounded-md border border-focus/60 bg-raised px-1.5 text-[17px] leading-7 outline-none ring-2 ring-focus/20"
    />
  );
}

export function ItemRow({ item, clock }: { item: Item; clock: Clock }) {
  const perform = usePerform();
  const [editing, setEditing] = useState(false);
  const textButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const done = item.status === 'done';

  useEffect(() => {
    if (editing || !returnFocus.current) return;
    returnFocus.current = false;
    textButton.current?.focus();
  }, [editing]);

  return (
    <li data-item-id={item.id} className="flex items-start gap-3 border-b border-rule py-3 last:border-b-0">
      <input
        type="checkbox"
        checked={done}
        aria-label={done ? 'Mark as not done' : 'Mark as done'}
        onChange={() => void perform(item.id, done ? actions.reopen() : actions.complete())}
        className="mt-1.5 h-[18px] w-[18px] shrink-0 cursor-pointer rounded accent-focus"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {editing ? (
          <TextEditor
            item={item}
            onDone={(back) => {
              returnFocus.current = back;
              setEditing(false);
            }}
          />
        ) : (
          <button
            ref={textButton}
            type="button"
            onClick={() => setEditing(true)}
            data-row-focus
            aria-label={`Edit: ${item.text}`}
            className={`-mx-1.5 rounded-md px-1.5 text-left text-[17px] leading-7 [overflow-wrap:anywhere] hover:bg-rule/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus ${
              done ? 'text-muted line-through decoration-muted/60' : ''
            }`}
          >
            <HighlightedText text={item.text} spans={done ? [] : item.spans} />
          </button>
        )}
        <EditableChips item={item} clock={clock} />
      </div>
      <ItemMenu item={item} clock={clock} />
    </li>
  );
}

export function ItemList({ items, clock, label }: { items: Item[]; clock: Clock; label: string }) {
  return (
    <ul aria-label={label}>
      {items.map((item) => (
        <ItemRow key={item.id} item={item} clock={clock} />
      ))}
    </ul>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-10 text-[15px] leading-6 text-muted">{children}</p>;
}

export function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="pt-6 text-[15px] font-semibold text-muted">{children}</h2>;
}
