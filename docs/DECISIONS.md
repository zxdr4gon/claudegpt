# Decisions

Short ADR-style log. Each entry: context, decision, consequences. Append new entries; supersede rather than edit old ones.

Status values: **Accepted**, **Proposed** (awaiting review), **Superseded by #N**.

---

## 1. Local-first web app (PWA) — Accepted

**Context.** We want instant startup, offline use, privacy, and no account friction.
**Decision.** Single-page React app, installable as a PWA, all data stored on device. No backend in MVP.
**Consequences.** No cross-device sync and no closed-app notifications in MVP. Data durability depends on the browser (see #4).

## 2. Stack — Accepted

React + TypeScript + Vite + Tailwind (v3, see #15). Dexie over IndexedDB. MiniSearch for search. chrono-node for date parsing. `vite-plugin-pwa` for offline/install. Vitest for unit tests, Playwright for end-to-end.

**Consequences.** Dexie's `liveQuery` is the primary state mechanism; the database is the source of truth. A tiny UI-state store (e.g. Zustand) only if needed — no Redux.

## 3. Single unified item model — Accepted

**Context.** Separate tables per type (tasks, notes, links) would force a decision at capture time, contradicting the core philosophy.
**Decision.** One `items` table. `kind` is an inferred, overridable field. "Idea", "errand", etc. are tags.
**Consequences.** Every view is a query over one table. Changing an item's kind is a field update, not a migration between stores.

## 4. Storage durability — Accepted

**Context.** Browsers may evict IndexedDB data (Safari can clear script-written storage for non-installed sites after ~7 days without a visit; any browser may evict under storage pressure).
**Decision.** Call `navigator.storage.persist()` on first meaningful use. Encourage PWA install. JSON export is a first-class, always-visible feature from day one. Show a non-nagging hint if persistence was denied and no export has happened recently.
**Consequences.** We are honest that local-only storage has limits; sync (later) is the real fix.

## 5. Raw input is immutable — Accepted

**Context.** Parsers make mistakes and improve over time. If parsed output replaces the input, we lose information permanently.
**Decision.** Each item stores `rawText`: exactly what the user typed at capture, never modified by any code path. User edits change a separate `text` field. Parsed metadata lives alongside, never in place of, either.
**Consequences.** We can always re-derive, debug, or re-parse from the original. Slight storage overhead; negligible.

## 6. Field provenance — Accepted

**Context.** Parsing must be transparent and correctable, and corrections must survive future re-parsing.
**Decision.** Every inferable value records its provenance: `'parsed'` or `'user'`.
- **Single-valued fields** (`kind`, `due`, `priority`, `url`) carry provenance on the field.
- **Tags carry provenance per tag.** Removing or adding one tag does not change ownership of the others.
- **Explicit removal is recorded.** If the user removes a parsed value, we store a user-owned "dismissed" marker rather than deleting it, so a re-parse of text that still contains the syntax does not resurrect it. For single-valued fields this is `{ value: null, source: 'user' }`; for a tag it is `{ value, source: 'user', dismissed: true }`.
- The parser returns the character spans it matched in `text`; these are stored so the UI can highlight them. User-set values have no span.

**Consequences.** A correction always sticks. The UI can distinguish "detected" from "set by you". Dismissed markers are hidden from display.

## 7. Date representation and resolution — Accepted

**Context.** "Tomorrow" means different things depending on when and where it was typed. Calendar dates and instants are different things and should be stored differently.
**Decision.** Relative expressions are resolved to absolute values at parse time. `due` is one of two shapes:
- **All-day:** `{ type: 'date', date: 'YYYY-MM-DD' }` — a floating calendar date. It shows on that date wherever the user is; no timezone conversion.
- **Timed:** `{ type: 'instant', at: <epoch ms>, tz: <IANA> }` — an exact instant, displayed in the viewer's current timezone. `tz` records where it was entered (useful for display hints like "5pm Dhaka time" when travelling).

Each parsed `due` also stores **`ref: { at, tz }`** — the timestamp and IANA timezone that relative expressions were resolved against. Re-parsing the same text with the same `ref` and parser version always produces the same result.

**Reference time:**
- At capture: `ref` = capture time and current timezone.
- On text edit: `ref` = edit time and current timezone (if you type "tomorrow" today, you mean tomorrow from today). `capturedAt` is never changed.
- **An untouched date expression keeps its old resolution.** If the edit leaves the matched date text itself untouched (e.g. the user fixes a typo elsewhere in "call dentsit tomorrow"), the existing `due` keeps its `ref`. Only a date expression that is new or changed is resolved against the edit time. Without this, fixing a typo would silently move the due date.
- On parser-version re-parse (no text edit): the stored refs are reused, so the result never depends on the current time.

**Which expression is the due date.** The parser finds every date expression; the first one in the text is the due date (the *primary*). Only the primary is highlighted.

**How "untouched" is decided** (compare matched text, never the whole item):
1. The old primary's character span is tracked through the edit with a character diff (common prefix/suffix, then an LCS of the changed middle).
2. It is untouched only if every character of that span survived, still contiguous, *and* lands exactly on the new primary's span.
3. If so, the expression is re-resolved against its original `ref` (identical result under the same parser version). Otherwise the new primary resolves against the edit time.

Tracking by position rather than by text means duplicates can't inherit each other's resolution: in "tomorrow prep, tomorrow review", deleting the first "tomorrow" makes the second the primary, and it resolves from the edit time because it wasn't the span that was resolved before. Edits inside the expression ("tomorrow" → "tomorrow 3pm") count as changes.

**Parsing rules for the stored shape.**
- A time-of-day the user stated ("3pm", "15:00") makes an instant. The wall time is converted with the zone's rules *for the target date*, so "tomorrow 9am" across a DST switch is still 9am.
- An explicit zone ("5pm EST") or a duration ("in 3 hours") is an exact instant: elapsed time, not wall time.
- Vague times of day ("tonight", "monday morning") stay all-day dates.
- "now" is not treated as a due date.
- Numeric dates are read US-style (`3/4` = March 4) until locale settings exist.
- Times landing in a DST gap shift forward by the gap; ambiguous times take the earlier instant.

**Consequences.** Covered by table-driven tests in `src/parser/parse.test.ts` and `src/model/items.test.ts`, run under an unusual host timezone (`Pacific/Chatham`) to prove nothing depends on the machine's zone.

## 8. Parser versioning — Accepted

**Decision.** The parser exports an integer `PARSER_VERSION`, stored on each item as `parserVersion`. Bump it whenever parsing behavior changes.
**Consequences.** We can identify items parsed by older logic and optionally re-parse them (subject to #6, #7, #13). Parser changes must ship with updated test cases.

## 9. Sync-ready identifiers and timestamps — Accepted

**Context.** No sync in MVP, but retrofitting sync onto auto-increment IDs and hard deletes is painful.
**Decision.** IDs are ULIDs (sortable, client-generated). Every item has `capturedAt`, `createdAt`, `updatedAt`. Deletes are soft (`deletedAt`), purged after a retention period. No auto-increment keys anywhere.
- `capturedAt` — when the user captured the thought. Never changes; preserved through import/export.
- `createdAt` — when this record was created in this database (differs from `capturedAt` for imported items).
- `updatedAt` — last modification; future last-write-wins sync key.

**Consequences.** Per-item last-write-wins sync is a straightforward later addition. CRDTs are not needed.

## 10. Search: in-memory MiniSearch index — Accepted

**Decision.** Build a MiniSearch index over `text`, tags, and `url` on app load; update incrementally on every write. Fuzzy + prefix matching. Archived and deleted items excluded by default.
**Budget.** < 50 ms keystroke-to-results at 10k items; index build on load kept under ~300 ms at 10k items. If load time exceeds budget, persist the serialized index (MiniSearch `toJSON`) and rebuild lazily.
**Consequences.** Search lives entirely in memory; acceptable up to tens of thousands of items.

## 11. No-maintenance UX rules — Accepted

**Context.** Product principle: the app must stay useful without upkeep and must never induce organizational guilt.
**Decision.**
- No unread or item counts on Inbox or any view.
- **Inbox** = items that are open, have no due date (a dismissed date counts as none), are not *actively* snoozed, and were captured within the last **7 days** (by `capturedAt`, not last edit). An item whose `snoozedUntil` has passed qualifies again automatically. Not configurable in MVP. Items age out automatically and remain in Everything and search.
- Past-due tasks appear in a collapsed, neutral "Earlier" section of Today — no red, no counters.
- No streaks, no review prompts, no required fields beyond text.

**Consequences.** Any future feature that adds badges, nags, or required organization must explicitly revisit this decision. Imported items with old `capturedAt` go straight to Everything, not Inbox — intended.

## 12. Reminders deferred — Accepted

**Context.** Browsers can't reliably show notifications while the app is closed without a Web Push server.
**Decision.** MVP has due dates surfaced in Today/Upcoming, but no notifications. The UI does not use the word "reminder" for anything that won't actually notify.
**Consequences.** Revisit when a backend exists.

## 13. Displayed syntax — Accepted

**Decision.** Inline syntax stays in the displayed text as written (`call dentist tmrw 3pm #health`). Detected spans get subtle highlighting; the same values appear as editable chips. Nothing the user typed visually disappears.

## 14. Re-parse rules — Accepted

**Context.** Text edits and parser upgrades both trigger re-parsing. The outcome must be predictable.
**Decision.** On re-parse:
1. **User-owned values are never modified**, including dismissed markers.
2. **Parsed values found again are updated** (subject to the untouched-date-expression rule in #7).
3. **Parsed values no longer found are removed.** If the user deletes "#groceries" from the text, the parsed `groceries` tag goes away. If they delete "tomorrow", the parsed due date goes away.
4. **New syntax produces new parsed values**, unless blocked by a dismissed marker for the same field/tag.
5. `kind` is always present: if parsed, it is recomputed from the new text.
6. `spans` and `parserVersion` are recomputed.

**Consequences.** The text remains the source of truth for parsed data; user corrections remain the source of truth for everything they touched.

## 15. Tailwind v3 via PostCSS — Accepted

**Context.** Tailwind v4 depends on a native binary (`@tailwindcss/oxide`). On the primary dev machine, Windows Application Control blocks that binary, and both the Vite plugin and the WASM fallback hang instead of failing. That stalled `vite build` and `vitest`.
**Decision.** Use Tailwind v3 (pure JavaScript) through PostCSS. Vitest has its own `vitest.config.ts` with no Vite plugins, since the tests are pure logic.
**Consequences.** v3 config style (`tailwind.config.js`, `@tailwind` directives). Upgrading to v4 later is mechanical if the native-binary issue goes away.

---

## Item schema

The source of truth is `src/model/item.ts`; this copy is for reading.

```ts
type Provenance = 'parsed' | 'user';

/** A value inferred by the parser or set by the user. `value: null` with
 *  source 'user' means the user explicitly removed it (#6). */
type Field<T> = { value: T | null; source: Provenance };

type ParseRef = { at: number; tz: string };   // reference for relative dates (#7)

type Due =
  | { type: 'date'; date: string }              // 'YYYY-MM-DD', floating
  | { type: 'instant'; at: number; tz: string }; // epoch ms + IANA zone of entry

type Tag = { value: string; source: Provenance; dismissed?: boolean };

type Span = { start: number; end: number; field: 'due' | 'tag' | 'priority' | 'url' };

type Item = {
  id: string;                 // ULID
  rawText: string;            // exactly as captured; immutable (#5)
  text: string;               // current text; user-editable
  textRef: ParseRef;          // capture time, then time of last text edit (#7)

  kind: Field<'task' | 'note' | 'link'>;   // value never null
  due?: Field<Due> & { ref?: ParseRef };   // ref present when parsed
  priority?: Field<1 | 2 | 3>;
  url?: Field<string>;
  tags: Tag[];                             // per-tag provenance (#6)

  spans: Span[];              // parser matches over `text` (#6, #13)
  parserVersion: number;      // (#8)

  status: 'open' | 'done' | 'archived';
  completedAt?: number;
  snoozedUntil?: number;

  capturedAt: number;         // never changes (#9)
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
};
```

## Open questions

None.
