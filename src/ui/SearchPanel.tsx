import { useMemo, useState } from 'react';
import { useIndexVersion, useOpenStore } from '../app/StoreContext';
import type { Item } from '../model/item';
import type { Clock } from '../model/items';
import { Empty, ItemList } from './ItemList';

/**
 * Search, separate from capture (DECISIONS #17). Ranking comes from the index;
 * the rows come from the live item list, so every edit, correction, archive,
 * delete or undo shows up at once, including changes made in other tabs (#20).
 */
export function SearchPanel({ items, clock, onClose }: { items: Item[]; clock: Clock; onClose: () => void }) {
  const store = useOpenStore();
  const version = useIndexVersion(store);
  const [query, setQuery] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const results = useMemo(() => {
    if (!store) return [];
    return store.index
      .search(query, { includeArchived, limit: 100 })
      .map((id) => byId.get(id))
      .filter((i): i is Item => i != null && i.deletedAt == null && (includeArchived || i.status !== 'archived'));
    // `version` isn't read here: it re-runs the search whenever the index changes.
  }, [store, version, query, includeArchived, byId]);

  return (
    <section aria-label="Search" className="pt-4">
      <div className="flex items-center gap-2">
        <input
          type="search"
          autoFocus
          aria-label="Search everything"
          placeholder="Search everything you’ve captured"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            }
          }}
          className="min-w-0 flex-1 rounded-lg border border-rule bg-raised px-3 py-2 text-[17px] outline-none focus:border-focus/60 focus:ring-2 focus:ring-focus/20"
        />
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-3 py-2 text-[15px] font-medium text-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
        >
          Close
        </button>
      </div>
      <label className="mt-2 flex w-fit cursor-pointer items-center gap-2 text-[14px] text-muted">
        <input
          type="checkbox"
          checked={includeArchived}
          onChange={(e) => setIncludeArchived(e.target.checked)}
          className="h-4 w-4 accent-focus"
        />
        Include archived
      </label>

      {!query.trim() ? (
        <Empty>Search words, tags or links. Typos are fine.</Empty>
      ) : !store ? (
        <Empty>Getting search ready…</Empty>
      ) : results.length === 0 ? (
        <Empty>Nothing matches “{query.trim()}”.</Empty>
      ) : (
        <ItemList items={results} clock={clock} label="Search results" />
      )}
    </section>
  );
}
