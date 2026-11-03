// Checks the DECISIONS #10 budgets at 10,000 items. Budgets are asserted with
// headroom so a slow CI machine doesn't flake; actual timings are logged.

import { describe, expect, it } from 'vitest';
import { createItem } from '../model/items';
import type { Item } from '../model/item';
import { SearchIndex } from './index';

const WORDS = (
  'call buy email fix plan read write review book pay send dentist milk eggs report ' +
  'meeting trip japan budget invoice garden car insurance birthday gift project draft ' +
  'notes idea recipe workout doctor school library movie album podcast article bug'
).split(' ');

function generate(n: number): Item[] {
  let seed = 42;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const pick = () => WORDS[Math.floor(rand() * WORDS.length)]!;
  const items: Item[] = [];
  for (let i = 0; i < n; i++) {
    const words = Array.from({ length: 4 + Math.floor(rand() * 10) }, pick);
    const text = `${words.join(' ')} #${pick()} item${i}`;
    items.push(createItem(text, { now: Date.UTC(2026, 0, 1) + i * 60000, tz: 'UTC' }, `id${i}`));
  }
  return items;
}

describe('search performance at 10k items', () => {
  const items = generate(10_000);

  it('builds the index within budget (300 ms)', () => {
    const index = new SearchIndex();
    const t = performance.now();
    index.replaceAll(items);
    const ms = performance.now() - t;
    console.log(`index build: ${ms.toFixed(1)} ms for ${index.size} items`);
    expect(index.size).toBe(10_000);
    expect(ms).toBeLessThan(300 * 3);
  });

  it('answers every keystroke within budget (50 ms)', () => {
    const index = new SearchIndex();
    index.replaceAll(items);
    // Includes a typo, and "i" which on its own would prefix-match all 10k
    // unique "item…" terms (the worst case for search-as-you-type).
    const queries = ['dentist insurnce birthday', 'item 42 budget'];
    const timings: number[] = [];
    for (const query of queries) {
      for (let i = 1; i <= query.length; i++) {
        const t = performance.now();
        index.search(query.slice(0, i));
        timings.push(performance.now() - t);
      }
    }
    const worst = Math.max(...timings);
    const sorted = [...timings].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    console.log(`per keystroke: median ${median.toFixed(2)} ms, worst ${worst.toFixed(2)} ms`);
    expect(worst).toBeLessThan(50 * 3);
  });

  it('applies incremental updates quickly', () => {
    const index = new SearchIndex();
    index.replaceAll(items);
    const t = performance.now();
    for (const item of items.slice(0, 100)) index.upsert({ ...item, text: `${item.text} edited` });
    const ms = (performance.now() - t) / 100;
    console.log(`upsert: ${ms.toFixed(3)} ms each`);
    expect(ms).toBeLessThan(5);
  });
});
