# Decisions

Short ADR-style log. Each entry: context, decision, consequences. Append new entries; supersede rather than edit old ones.

Status values: **Accepted**, **Proposed** (awaiting review), **Superseded by #N**.

---

## 1. Local-first web app (PWA) — Accepted

**Context.** We want instant startup, offline use, privacy, and no account friction.
**Decision.** Single-page React app, installable as a PWA, all data stored on device. No backend in MVP.
**Consequences.** No cross-device sync and no closed-app notifications in MVP. Data durability depends on the browser (see #4).

## 2. Stack — Accepted

React + TypeScript + Vite + Tailwind. Dexie over IndexedDB. MiniSearch for search. chrono-node for date parsing. `vite-plugin-pwa` for offline/install. Vitest for unit tests, Playwright for end-to-end.

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

## 6. Parsed vs. user-set fields — Proposed

**Context.** Parsing must be transparent and correctable, and corrections must survive future re-parsing.
**Decision.** Every inferable field (`kind`, `due`, `tags`, `priority`, `url`) records its provenance: `'parsed'` or `'user'`. Re-parsing (e.g. after a parser upgrade or a text edit) may update `'parsed'` fields but never touches `'user'` fields. The parser also returns the character spans it matched, stored on the item, so the UI can highlight what was detected.
**Consequences.** Users can trust that a correction sticks. The UI can show "detected" vs. "set by you" if useful.

## 7. Dates resolved at capture time, with timezone — Accepted

**Context.** "Tomorrow" means different things depending on when and where it was typed. Re-interpreting relative dates later would silently move items.
**Decision.** Relative expressions are resolved to an absolute value at capture time, relative to `capturedAt` in the user's current IANA timezone. We store:
- `due.at` — epoch ms. For timed dates, the exact instant. For all-day dates, local midnight in the capture timezone.
- `due.allDay` — whether a time was specified.
- `due.tz` — IANA timezone at capture (e.g. `Asia/Dhaka`).
- `due.source` — `'parsed'` or `'user'` (see #6).

All-day items are displayed by calendar date in `due.tz`, so they don't shift a day when the user travels. Timed items are displayed as instants in the viewer's current timezone.
**Consequences.** Re-parsing an old item uses its original `capturedAt` and `due.tz` as the reference, so the same input yields the same date. Test suite must cover DST transitions and timezone boundaries.

## 8. Parser versioning — Accepted

**Decision.** The parser exports an integer `PARSER_VERSION`, stored on each item as `parserVersion`. Bump it whenever parsing behavior changes.
**Consequences.** We can identify items parsed by older logic and optionally re-parse them (subject to #6 and #7). Parser changes must ship with updated test cases.

## 9. Sync-ready identifiers and timestamps — Accepted

**Context.** No sync in MVP, but retrofitting sync onto auto-increment IDs and hard deletes is painful.
**Decision.** IDs are ULIDs (sortable, client-generated). Every item has `capturedAt`, `createdAt`, `updatedAt`. Deletes are soft (`deletedAt`), purged after a retention period. No auto-increment keys anywhere.
- `capturedAt` — when the user captured the thought (preserved through import/export).
- `createdAt` — when this record was created in this database (differs from `capturedAt` for imported items).
- `updatedAt` — last modification; future last-write-wins sync key.
**Consequences.** Per-item last-write-wins sync is a straightforward later addition. CRDTs are not needed.

## 10. Search: in-memory MiniSearch index — Accepted

**Decision.** Build a MiniSearch index over `text`, `tags`, and `url` on app load; update incrementally on every write. Fuzzy + prefix matching. Archived and deleted items excluded by default.
**Budget.** < 50 ms keystroke-to-results at 10k items; index build on load measured and kept under ~300 ms at 10k items. If load time exceeds budget, persist the serialized index (MiniSearch `toJSON`) and rebuild lazily.
**Consequences.** Search lives entirely in memory; acceptable up to tens of thousands of items.

## 11. No-maintenance UX rules — Accepted

**Context.** Product principle: the app must stay useful without upkeep and must never induce organizational guilt.
**Decision.**
- No unread or item counts on Inbox or any view.
- Inbox is "recent and untouched", not "pending work"; items age out of it automatically (threshold TBD, e.g. 7 days) and remain in Everything and search.
- Past-due tasks appear in a collapsed, neutral "Earlier" section of Today — no red, no counters.
- No streaks, no review prompts, no required fields beyond text.
**Consequences.** Any future feature that adds badges, nags, or required organization must explicitly revisit this decision.

## 12. Reminders deferred — Accepted

**Context.** Browsers can't reliably show notifications while the app is closed without a Web Push server.
**Decision.** MVP has due dates surfaced in Today/Upcoming, but no notifications. The UI does not use the word "reminder" for anything that won't actually notify.
**Consequences.** Revisit when a backend exists.

---

## Proposed item schema (for review)

```ts
type Provenance = 'parsed' | 'user';

type Span = { start: number; end: number; field: 'due' | 'tag' | 'priority' | 'url' };

type Item = {
  id: string;                 // ULID
  rawText: string;            // exactly as captured; immutable (#5)
  text: string;               // current text; user-editable

  kind: { value: 'task' | 'note' | 'link'; source: Provenance };
  due?: { at: number; allDay: boolean; tz: string; source: Provenance }; // (#7)
  tags: { value: string[]; source: Provenance };
  priority?: { value: 1 | 2 | 3; source: Provenance };
  url?: { value: string; source: Provenance };

  spans: Span[];              // parser matches over `text`, for highlighting (#6)
  parserVersion: number;      // (#8)

  status: 'open' | 'done' | 'archived';
  completedAt?: number;
  snoozedUntil?: number;

  capturedAt: number;         // (#9)
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
};
```

### Open questions

1. **Tag provenance granularity.** Per-list (above) is simpler; per-tag would let a user remove one parsed tag while others stay auto-managed. Proposal: per-list — once the user edits tags, the whole list is user-owned.
2. **Text edits and re-parsing.** When the user edits `text`, re-parse and update `'parsed'` fields, re-resolving dates against the *original* `capturedAt`? Or against edit time? Proposal: edit time — if you type "tomorrow" today, you mean tomorrow from now. The original `rawText` is still preserved either way.
3. **Should inline syntax be stripped from displayed text?** E.g. show `call dentist` with a date chip, rather than `call dentist tmrw 3pm`. Proposal: keep the text as written, with detected spans subtly highlighted. More transparent; nothing appears to vanish.
4. **Inbox age-out threshold.** Proposal: 7 days, not user-configurable in MVP.
