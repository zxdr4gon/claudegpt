import type { Span, SpanField } from '../model/item';

export const MARK_CLASS: Record<SpanField, string> = {
  due: 'bg-mark-due',
  tag: 'bg-mark-tag',
  priority: 'bg-mark-priority',
  url: 'bg-mark-url',
};

/** The text as written, with detected syntax marked (DECISIONS #13). */
export function HighlightedText({ text, spans }: { text: string; spans: Span[] }) {
  const parts: React.ReactNode[] = [];
  let pos = 0;
  for (const span of spans) {
    if (span.start < pos) continue; // overlapping spans can't be drawn twice
    if (span.start > pos) parts.push(text.slice(pos, span.start));
    parts.push(
      <mark key={span.start} className={`mark text-inherit ${MARK_CLASS[span.field]}`}>
        {text.slice(span.start, span.end)}
      </mark>,
    );
    pos = span.end;
  }
  parts.push(text.slice(pos));
  return <>{parts}</>;
}
