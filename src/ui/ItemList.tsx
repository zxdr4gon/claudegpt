import type { Item } from '../model/item';
import type { Clock } from '../model/items';
import { Chips } from './Chips';
import { HighlightedText } from './HighlightedText';

export function ItemRow({ item, clock }: { item: Item; clock: Clock }) {
  const done = item.status === 'done';
  return (
    <li className="flex flex-col gap-1.5 border-b border-rule py-3 last:border-b-0">
      <p className={`text-[17px] leading-7 [overflow-wrap:anywhere] ${done ? 'text-muted line-through decoration-muted/60' : ''}`}>
        <HighlightedText text={item.text} spans={done ? [] : item.spans} />
      </p>
      <Chips item={item} clock={clock} />
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
