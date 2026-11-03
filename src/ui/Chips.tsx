import { activeTags, type Item } from '../model/item';
import type { Clock } from '../model/items';
import { formatDue } from './format';
import { MARK_CLASS } from './HighlightedText';

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./u, '');
  } catch {
    return url;
  }
}

/** What was detected or set on an item, one chip per value. Read-only for now. */
export function Chips({ item, clock }: { item: Item; clock: Clock }) {
  const chips: { key: string; label: string; className: string }[] = [];
  const due = item.due?.value;
  if (due) chips.push({ key: 'due', label: formatDue(due, clock), className: MARK_CLASS.due });
  for (const tag of activeTags(item)) chips.push({ key: `tag:${tag}`, label: `#${tag}`, className: MARK_CLASS.tag });
  const priority = item.priority?.value;
  if (priority) chips.push({ key: 'priority', label: `Priority ${priority}`, className: MARK_CLASS.priority });
  const url = item.url?.value;
  if (url) chips.push({ key: 'url', label: hostOf(url), className: MARK_CLASS.url });

  if (chips.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Detected details">
      {chips.map((c) => (
        <li key={c.key} className={`rounded px-1.5 py-0.5 text-[13px] leading-5 ${c.className}`}>
          {c.label}
        </li>
      ))}
    </ul>
  );
}
