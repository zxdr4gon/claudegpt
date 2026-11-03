import type { Item } from '../model/item';
import type { Clock } from '../model/items';
import { everythingView, inboxView, todayView, upcomingView } from '../model/views';
import { formatDay } from './format';
import { Empty, ItemList, SectionHeading } from './ItemList';

export type ViewName = 'inbox' | 'today' | 'upcoming' | 'everything';

export const VIEWS: { name: ViewName; label: string }[] = [
  { name: 'inbox', label: 'Inbox' },
  { name: 'today', label: 'Today' },
  { name: 'upcoming', label: 'Upcoming' },
  { name: 'everything', label: 'Everything' },
];

type ViewProps = { items: Item[]; clock: Clock };

function Inbox({ items, clock }: ViewProps) {
  const list = inboxView(items, clock);
  if (list.length === 0) return <Empty>Nothing new this week. Type above and press Enter to capture.</Empty>;
  return <ItemList items={list} clock={clock} label="Inbox" />;
}

function Today({ items, clock }: ViewProps) {
  const { today, earlier } = todayView(items, clock);
  return (
    <>
      {today.length > 0 ? (
        <ItemList items={today} clock={clock} label="Due today" />
      ) : (
        <Empty>Nothing due today.</Empty>
      )}
      {earlier.length > 0 && (
        // Collapsed and neutral: past-due items are there if you want them (DECISIONS #11).
        <details className="group mt-4">
          <summary className="cursor-pointer select-none rounded py-2 text-[15px] font-semibold text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus">
            Earlier
          </summary>
          <ItemList items={earlier} clock={clock} label="Earlier" />
        </details>
      )}
    </>
  );
}

function Upcoming({ items, clock }: ViewProps) {
  const groups = upcomingView(items, clock);
  if (groups.length === 0) {
    return <Empty>Nothing scheduled. Add a date as you type, like “fri 5pm” or “in 2 weeks”.</Empty>;
  }
  return (
    <>
      {groups.map((g) => (
        <section key={g.day}>
          <SectionHeading>{formatDay(g.day, clock)}</SectionHeading>
          <ItemList items={g.items} clock={clock} label={formatDay(g.day, clock)} />
        </section>
      ))}
    </>
  );
}

function Everything({ items, clock }: ViewProps) {
  const { active, completed } = everythingView(items);
  if (active.length === 0 && completed.length === 0) {
    return <Empty>Everything you capture ends up here.</Empty>;
  }
  return (
    <>
      <ItemList items={active} clock={clock} label="Everything" />
      {completed.length > 0 && (
        <section>
          <SectionHeading>Completed</SectionHeading>
          <ItemList items={completed} clock={clock} label="Completed" />
        </section>
      )}
    </>
  );
}

export function View({ name, ...props }: ViewProps & { name: ViewName }) {
  switch (name) {
    case 'inbox':
      return <Inbox {...props} />;
    case 'today':
      return <Today {...props} />;
    case 'upcoming':
      return <Upcoming {...props} />;
    case 'everything':
      return <Everything {...props} />;
  }
}
