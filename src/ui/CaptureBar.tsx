import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNow } from '../app/useNow';
import { createItem } from '../model/items';
import { Chips } from './Chips';
import { HighlightedText } from './HighlightedText';

type Props = {
  /** Saves the text. The bar clears immediately and never waits on this. */
  onCapture: (text: string) => Promise<void>;
};

// The textarea and the highlight layer behind it must lay text out identically.
const TEXT_LAYOUT = 'px-4 py-3.5 text-[19px] leading-7 whitespace-pre-wrap break-words';

/**
 * The capture bar (DECISIONS #17): Enter always saves. Detected syntax is
 * highlighted in place as you type, by drawing the text in a layer behind a
 * textarea whose own text is transparent (only its caret and selection show).
 */
export function CaptureBar({ onCapture }: Props) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const clock = useNow();

  // The exact item Enter would save, so the preview can't disagree with it.
  const preview = useMemo(
    () => (text.trim() ? createItem(text, { now: Date.now(), tz: clock.tz }, 'preview') : null),
    // Re-derive on minute ticks too, so "in 3 hours" doesn't go stale.
    [text, clock],
  );

  // Autofocus only with a fine pointer: never pop the keyboard open on phones.
  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) ref.current?.focus();
  }, []);

  // Grow with the content.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  function submit() {
    const value = text.trim();
    if (!value) return;
    setText('');
    setError(null);
    onCapture(value).catch(() => {
      // Put the text back rather than losing the thought.
      setText((current) => (current ? `${value}\n${current}` : value));
      setError('Couldn’t save that. Your text is back in the box; press Enter to try again.');
    });
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="relative rounded-xl border border-rule bg-raised focus-within:border-focus/60 focus-within:ring-2 focus-within:ring-focus/20">
        <div aria-hidden className={`pointer-events-none absolute inset-0 overflow-hidden ${TEXT_LAYOUT}`}>
          {preview ? <HighlightedText text={text} spans={preview.spans} /> : text}
          {/* Keeps a trailing newline's line box, matching the textarea. */}
          {'​'}
        </div>
        <textarea
          ref={ref}
          value={text}
          rows={1}
          aria-label="Capture a thought"
          placeholder="Capture anything… try “call dentist tomorrow 3pm #health”"
          spellCheck
          className={`relative block w-full resize-none bg-transparent text-transparent caret-ink outline-none placeholder:text-muted ${TEXT_LAYOUT}`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
      </div>
      <div className="flex min-h-7 items-center justify-between gap-3 px-1">
        {preview ? <Chips item={preview} clock={clock} /> : <span />}
        <button
          type="submit"
          // Keep focus where it is: tapping Save must not close or reopen the keyboard.
          onPointerDown={(e) => e.preventDefault()}
          disabled={!preview}
          className="shrink-0 rounded-lg px-3 py-1 text-sm font-medium text-focus hover:bg-focus/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus disabled:text-muted disabled:hover:bg-transparent"
        >
          Save
        </button>
      </div>
      {error && (
        <p role="alert" className="px-1 text-sm text-ink">
          {error}
        </p>
      )}
    </form>
  );
}
