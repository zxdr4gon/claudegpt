// In-memory full-text index over items (DECISIONS #10). Holds ids and the few
// fields needed to filter; items themselves come from the database.

import MiniSearch from 'minisearch';
import { activeTags, type Item } from '../model/item';

type Doc = { id: string; text: string; tags: string; url: string; status: Item['status'] };

export type SearchOptions = {
  includeArchived?: boolean;
  limit?: number;
};

/** Lowercase and strip accents, so "cafe" finds "café". */
function normalizeTerm(term: string): string | null {
  const t = term.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return t || null;
}

const defaultTokenize = MiniSearch.getDefault('tokenize') as (text: string) => string[];

function tokenize(query: string): string[] {
  return defaultTokenize(query).filter(Boolean);
}

function toDoc(item: Item): Doc {
  return {
    id: item.id,
    text: item.text,
    tags: activeTags(item).join(' '),
    url: item.url?.value ?? '',
    status: item.status,
  };
}

function createMiniSearch(): MiniSearch<Doc> {
  return new MiniSearch<Doc>({
    fields: ['text', 'tags', 'url'],
    storeFields: ['status'],
    processTerm: normalizeTerm,
    searchOptions: {
      // Every word must match; the last one may be partial (search-as-you-type).
      // A one-letter prefix would expand to a huge share of the vocabulary, so
      // prefix matching starts at two letters.
      combineWith: 'AND',
      prefix: (term, i, terms) => i === terms.length - 1 && term.length >= 2,
      // Typo tolerance only where a typo is distinguishable from a different word.
      fuzzy: (term) => (term.length >= 4 ? 0.2 : false),
      boost: { tags: 2 },
    },
  });
}

export class SearchIndex {
  private ms = createMiniSearch();
  private version = 0;
  private listeners = new Set<() => void>();

  /** Called after every change to the index, so open searches re-run (DECISIONS #20). */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Increments on every change; a cheap snapshot for useSyncExternalStore. */
  getVersion(): number {
    return this.version;
  }

  private changed() {
    this.version++;
    for (const l of this.listeners) l();
  }

  /** Rebuild from scratch. Deleted items are never indexed. */
  replaceAll(items: Iterable<Item>): void {
    this.ms = createMiniSearch();
    const docs: Doc[] = [];
    for (const item of items) if (item.deletedAt == null) docs.push(toDoc(item));
    this.ms.addAll(docs);
    this.changed();
  }

  /** Add, update or (for deleted items) drop one item. */
  upsert(item: Item): void {
    if (item.deletedAt != null) {
      this.remove(item.id);
      return;
    }
    const doc = toDoc(item);
    if (this.ms.has(item.id)) this.ms.replace(doc);
    else this.ms.add(doc);
    this.changed();
  }

  remove(id: string): void {
    if (!this.ms.has(id)) return;
    this.ms.discard(id);
    this.changed();
  }

  get size(): number {
    return this.ms.documentCount;
  }

  /** Matching ids, best first. Archived items are excluded unless asked for. */
  search(query: string, options: SearchOptions = {}): string[] {
    const terms = tokenize(query);
    // "dentist i": the user is starting a new word. Keep showing the results
    // for what's complete instead of flickering to nothing.
    if (terms.length > 1 && terms[terms.length - 1]!.length === 1) terms.pop();
    if (terms.length === 0) return [];
    const results = this.ms.search(terms.join(' '), {
      filter: options.includeArchived ? undefined : (r) => r.status !== 'archived',
    });
    const ids = results.map((r) => r.id as string);
    return options.limit != null ? ids.slice(0, options.limit) : ids;
  }
}
