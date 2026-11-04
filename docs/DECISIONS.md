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
- **Timed:** `{ type: 'instant', at: <epoch ms>, zone }` — an exact instant, displayed in the viewer's current timezone. `zone` records the zone the time was *expressed in*: `{ type: 'iana', tz }` for the user's own zone or a named region, or `{ type: 'offset', minutes, label }` for an explicit fixed zone such as `5pm EST`. The user's local zone is never claimed for a time they typed in another zone.

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
- A duration ("in 3 hours") is elapsed time from the reference instant, even across a DST switch.
- Only chrono's `result/relativeDateAndTime` tag (pure time-unit durations: "in 3 hours", "2 hours from now", "in an hour") counts as elapsed time. Day-level relatives with a clock time ("in 2 days at 9am", "next week 5pm") are wall-clock times and go through the zone rules.
- An explicit zone takes precedence over everything except a pure duration, and keeps what was typed. Specific abbreviations and offsets (`EST`, `PDT`, `UTC`, `GMT+3`) are stored as that fixed offset with its label, so `5pm EST` in July is still UTC-5. Generic US labels (`ET`, `CT`, `MT`, `PT`) name a region, so they map to its IANA zone and follow its DST.
- Vague times of day ("tonight", "monday morning") stay all-day dates.
- "now" is not treated as a due date.
- Numeric dates are read US-style (`3/4` = March 4) until locale settings exist.
- Times landing in a DST gap shift forward by the gap; ambiguous times take the earlier instant.

**Consequences.** Covered by table-driven tests in `src/parser/parse.test.ts` and `src/model/items.test.ts`, run under an unusual host timezone (`Pacific/Chatham`) to prove nothing depends on the machine's zone.

## 8. Parser versioning — Accepted

**Decision.** The parser exports an integer `PARSER_VERSION`, stored on each item as `parserVersion`. Bump it whenever parsing behavior changes.
**Consequences.** We can identify items parsed by older logic and optionally re-parse them (subject to #6, #7, #13). Parser changes must ship with updated test cases.

**Schema changes are separate from parser changes.** Re-parsing never touches user-owned values, so a change to the *shape* of stored data can't rely on it. Shape changes go through `upgradeShape()` (`src/model/migrate.ts`), applied by a new Dexie version's upgrade function for stored data and by backup import for old files. A change can need both: parser v2 below.

| Parser version | Change |
|---|---|
| 1 | Initial parser. |
| 2 | Timed due dates record their `zone` (was `tz`); explicit zones beat day-level relatives (`in 2 days at 9am PST`); day-level relatives with a clock time use wall-clock rules. Dexie schema v2 migrates the `tz` → `zone` shape for parsed and user-owned values. |

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

**Matching rules** (`src/search/index.ts`):
- Indexed fields: `text`, active tags (boosted ×2), `url`. Deleted items are never indexed. Dismissed tags aren't indexed, but the words of the text always are: dismissing `#japan` doesn't hide an item whose text says "#japan".
- Every word must match (AND). Case and accents are ignored ("cafe" finds "café").
- Only the last word is prefix-matched, and only once it has 2+ letters. A one-letter trailing word after other words is ignored ("dentist t" shows the results for "dentist"), so results don't flicker to empty and a single letter can't expand to most of the vocabulary.
- Typo tolerance (edit distance 20% of length) for words of 4+ letters. Known gap: a typo *while the word is still incomplete* ("insurn") matches nothing until the word is finished ("insurnce" → "insurance").
- Archived items are excluded unless requested; done items are included.

**Measured** (10k generated items, this dev machine, `src/search/search.perf.test.ts`): index build ~130–150 ms; per keystroke median ~3 ms, worst ~34 ms; incremental update ~0.03 ms. The test asserts the budgets with 3× headroom so slower CI machines don't flake.

## 11. No-maintenance UX rules — Accepted

**Context.** Product principle: the app must stay useful without upkeep and must never induce organizational guilt.
**Decision.**
- No unread or item counts on Inbox or any view.
- **Inbox** = items that are open, have no due date (a dismissed date counts as none), are not *actively* snoozed, and were captured within the last **7 days** (by `capturedAt`, not last edit). An item whose `snoozedUntil` has passed qualifies again automatically. Not configurable in MVP. Items age out automatically and remain in Everything and search.
- Past-due tasks appear in a collapsed, neutral "Earlier" section of Today — no red, no counters. "Earlier" means **previous calendar days** (in the viewer's zone); a timed item whose time has passed earlier today stays in the main Today list until the day ends.
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

## 16. Storage layer — Accepted

**Decision.** `ItemStore` (`src/store/store.ts`) is the only code that writes items.
- Each write runs a pure model function (`src/model/items.ts`) inside a Dexie read-modify-write transaction, then updates the search index after the transaction commits. A generic `update(id, fn)` covers every user correction, so new model operations need no new store code.
- On open: items with an older `parserVersion` are re-parsed (deterministically, from stored references, without changing `updatedAt`), then the index is built from the database.
- Soft-deleted items are hard-deleted by `purgeDeleted()` after **30 days**.
- Time comes from an injected clock, so tests control it.
- The schema has a `meta` table for small app facts (e.g. `lastExportAt` for the backup hint in #4). Dexie version blocks are never edited, only added.

**Backup** (`src/store/backup.ts`): JSON `{ format: 'claudegpt-backup', version: 1, exportedAt, items }`, including soft-deleted items so a restore is faithful. `backup.ts` only reads and checks files; the writes (`importItems`, `recordExport`) are `ItemStore` methods, so the store stays the only writer.
- Each entry goes through: `upgradeShape()` → `isValidItem()` (full nested check: refs, timezones, fields and provenance, due/zone shapes, real calendar dates, fixed offsets within UTC-12:00…+14:00 with a non-empty label, tags, spans within the text, statuses, finite timestamps) → rejected if its `parserVersion` is newer than this app's parser → re-parse if older → validated again. A test checks that everything the parser produces passes `isValidItem()`, so the app's own backups always import. Any failure, including an exception, counts the entry as invalid and skips it; it never reaches the database or aborts the import.
- Merge is per item, last-write-wins on `updatedAt` (the same rule future sync will use). New items keep `capturedAt` and get `createdAt` = now; replaced ones keep the local `createdAt`.
- Non-backups and backups from a newer app version are rejected outright.
- The envelope `version` changes only if the envelope changes; item shape changes are handled by `upgradeShape()`, so old files stay importable.

Markdown export comes with the UI.

**Cross-tab.** Each tab has its own index, kept in step without reloads (see #20).

**Tests.** `src/store/store.test.ts` runs the real store against `fake-indexeddb`.

## 17. UI interaction rules — Accepted

**Principle.** Capture always feels immediate. Retrieval can be powerful, but never at the cost of complicating capture.

- **Capture and search are separate.** The capture bar always saves on Enter. Search opens with `/` or `Ctrl+K`. No live search results under the capture bar, so Enter is never ambiguous.
- **Capture never waits.** The bar is usable before the store has finished opening (a capture made early is saved once it's ready). The persistent-storage request (#4) fires after the first capture and is never awaited.
- **Mobile.** No programmatic refocus after a capture: the keyboard stays open if it was open, and is never forced back open. Autofocus on load only with a fine pointer (desktop).
- **Global shortcuts** never fire while focus is in an input, textarea, select or contenteditable element, or while an IME composition is in progress.
- **Undo really reverses.** Undo restores the item's exact previous record (and search entry), not an approximate inverse operation.
- **Cross-tab.** Search indexes stay in sync across tabs without reloads.
- **Snooze** is separate from due dates and never changes `capturedAt`. Presets: Later today (at least 3 elapsed hours, rounded up to the next full local hour; rounding is done on instants so a repeated fall-back hour can't shorten it), Tomorrow (09:00), Next week (coming Monday 09:00), Pick date/time. Rules in `src/model/snooze.ts`.
- **Zone hint on timed due dates.** A timed due date shows the time in the zone it was expressed in only when that zone's clock reads differently from the viewer's at that moment ("Tomorrow, 4:00 (17:00 EST)" seen from Dhaka). Same zone, or a different zone on the same offset: no hint, since it would repeat the time.
- **Snoozed items** are hidden from Inbox, Today and Upcoming while the snooze is active; they stay in Everything and search.
- **Completed items** leave Today and Upcoming immediately; Everything shows them in a separate Completed section.

## 18. Item actions and undo — Accepted

**Decision.** Every item action (`src/store/actions.ts`) is one pure model function run through `ItemStore.change(id, fn)`, which returns the exact stored record **before** and **after**, read and written in one transaction.

Undo restores, it never inverts:
- `UndoStack` (`src/store/undo.ts`) keeps `{ label, before, after }` per action. Undo writes back the exact `before` record through `ItemStore.revert()`, and the search entry is restored from that same record. Text, parsed values, spans, provenance, dismissals, status and all timestamps (including `updatedAt`) come back exactly.
- `revert()` runs in a transaction and only proceeds if the item is still exactly `after` (structural equality). If anything changed since, in this tab or another, the undo is refused and nothing is overwritten.
- An entry leaves the stack before any await, so a double-clicked undo can't apply the same entry twice.
- Actions that change nothing aren't recorded.
- The toast shows each newly recorded action for 6 seconds. It follows the most recently *recorded* action, so undoing one never brings back the toast of an older action.

**Tests.** `src/store/actions.test.ts`: every action followed by undo is compared to the exact previous record and search results; plus reverse-order undos, a double-clicked undo, an undo racing a new action, undoing an older change after a newer one (refused), and an item deleted underneath. Removing the "still exactly `after`" guard makes the safety tests fail.

**Trade-off.** Restoring `updatedAt` means an undone change looks as if it never happened. That's the intended meaning of undo; for future sync, the undo itself may need a fresh `updatedAt` to win last-write-wins. Revisit with sync.

## 19. Editable chips — Accepted

**Decision.** Each value on a saved item is a chip that opens a menu to correct it; everything goes through the existing actions, so it's undoable (#18). What chips show is decided by `chipsFor()` (`src/model/chips.ts`), tested apart from the UI.
- **Kind** (rows only): Mark as task/note/link.
- **Date**: Change date… (date plus optional time; no time means all-day; impossible dates are rejected), Remove date.
- **Tag**: Remove tag. **Priority**: change level, Remove priority. **Link**: Open link, Remove link.
- **Provenance is visible.** Detected chips are plain highlights; user-set chips get a thin outline and "set by you" in their accessible name. A user-set value offers "Reset to what the text says".
- **Removals are visible while relevant.** A value the user removed is shown as a struck-through chip with "Restore…", but only while the text still contains it. Once the text no longer says it, the chip disappears (the dismissal marker stays, harmlessly).
- The capture preview's chips are read-only.

## 20. Search UI and cross-tab index sync — Accepted

**Search UI.** `/` (when not typing) or Ctrl/Cmd+K (from anywhere; it never types a character) opens search in place of the current view. The capture bar stays on top and keeps saving on Enter. Escape or Close returns to the view. "Include archived" is an explicit toggle. Results are full item rows, so every action works from them.

**Results stay current.** Ranking comes from the index; the rows come from the live item list. The index notifies subscribers on every change (`SearchIndex.subscribe` / `getVersion`), so an open search re-runs after any edit, correction, archive, delete, restore or undo, with no reload. No-op actions don't touch the index.

**Cross-tab sync.** After each write, `ItemStore` posts the changed ids on a `BroadcastChannel` named per database (`{ type: 'items', ids }`, or `{ type: 'all' }` after an import, purge or parser upgrade). Other tabs re-read those records from the database and upsert or remove them in their own index; they never trust the message's content, so messages arriving out of order still converge. Item lists in other tabs already update through Dexie. A failed remote update is caught and logged; it can't break the tab.

**Shortcut rule** (`src/app/shortcuts.ts`): shortcuts never fire during IME composition, and `/` never fires while focus is in a text-like input, textarea, select or contenteditable element. A focused checkbox or button doesn't count as typing.

**Tests.** `src/store/search-sync.test.ts`: each transition (edit, tag correction, archive, delete, complete, and undo of each) is reflected in search immediately, subscribers are notified only on real changes, and two stores on one database stay in sync over a real BroadcastChannel in both directions, including import and purge. `src/app/shortcuts.test.ts` covers the shortcut rule. Verified in the browser with two real tabs: a capture and a delete in one tab updated the other tab's open search without reload.

## 21. Keyboard shortcuts and undo feedback — Accepted

**Shortcuts** (one pure rule, `shortcutFor()` in `src/app/shortcuts.ts`):

| Key | Does | Fires when |
|---|---|---|
| `/` | Open search | Not typing in a field |
| Ctrl/Cmd+K | Open search | Anywhere (it never types a character) |
| Ctrl/Cmd+Z | Undo the app's last action | Not typing in a field. In the capture bar, inline editor, date/time editors, snooze picker and search field it stays the field's own undo |
| `n` | Focus the capture bar | Not typing |
| `j` / `k` | Next / previous item | Not typing |
| `x` | Complete or reopen the focused item | Not typing |
| `e` | Edit the focused item's text | Not typing |

Nothing fires during IME composition. Single-letter commands never fire with Ctrl, Cmd, Alt or Shift. Ctrl+Shift+Z and Ctrl+Alt+Z are left to the browser. Commands act through the same controls as a click (`x` clicks the row's checkbox), so everything stays undoable.

**Focus.** Enter or Escape in the inline editor returns focus to that row; clicking elsewhere (blur) doesn't pull it back. After `x` moves an item between sections (which re-mounts its row), focus stays on that item, or on the row now in its place if it left the view.

**Undo is never silent.** Every attempt, from the toast or Ctrl+Z, reports an outcome that the toast shows: *Undone: …*; *Couldn't undo "…": that item has changed since* (refused, nothing overwritten); *Nothing to undo*; or *Couldn't undo "…". Try again* (the restore failed to save; the entry goes back on the stack so a retry works).

**Dates.** Supported years are 1000–9999 (`MIN_YEAR`/`MAX_YEAR`): `Date.UTC()` reads years 0–99 as 1900–1999, so earlier years are rejected rather than silently shifted.

**Verified in the browser with real keystrokes:** `j` `x` then Ctrl+Z restored the exact stored record; Ctrl+Z with an empty stack said "Nothing to undo"; Ctrl+Z inside the capture bar and inside the inline editor undid the typing there and left the app's last action alone; focus stayed on the item after `x` and returned to the row after Escape; after another tab edited the item, Ctrl+Z here was refused with the message and the other tab's edit was kept.

## 22. Backup reliability and UI — Accepted

The backup is the user's escape hatch, so the rules come first and are tested in `src/store/backup.test.ts`.

**Reading a file.** Files over 50 MB are refused by their **byte** size: the UI checks `File.size` before reading the file at all, and `parseBackupFile()` counts UTF-8 bytes of the text (`utf8ByteLength()`; `text.length` counts UTF-16 units and undercounts non-ASCII). Text that isn't JSON is refused with a message for the user. The envelope must be this app's format, with `version` a positive integer no higher than this app supports and `exportedAt` a finite timestamp; anything else is refused before any item is looked at.

**Each entry** goes through shape upgrade, full validation and parser upgrade (#16). Bad entries are counted as *invalid* and skipped; they never block the valid ones.

**Duplicate ids within one file.** Only the newest copy (by `updatedAt`) is considered; on a tie the first one stays. The extra copies are counted as *duplicates*.

**Merge.** Per item, last-write-wins on `updatedAt` (`mergeDecision()`), the rule future sync will use. **Local wins ties**, so an import never replaces local data with something that isn't strictly newer. Deletion is just another update: a newer soft-deleted copy deletes locally, and a newer live copy restores a locally deleted item.

**All or nothing.** Every valid entry is written in one transaction. If any write fails (e.g. storage quota), nothing is written, and the index and other tabs are untouched.

**Preview first.** `previewImport()` uses the same decision function as the import, reads only, and reports `{ added, updated, unchanged, invalid, duplicates }` plus the decision for each item. A test checks that the preview equals the import's result and that the preview writes nothing.

**No stale previews.** Confirming passes the shown preview to `importBackup()`. Inside the import's transaction the plan is recomputed and compared **per item** (equal counts aren't enough: two items can swap outcomes). If anything differs, e.g. another tab edited an item after the preview, nothing is written and `StalePreviewError` carries the fresh preview, which the UI shows with an explanation so the user can confirm again. Because the check and the writes share one transaction, there's no window between them.

**UI** ("Backup and restore", a quiet link at the foot of the page):
- *Export backup* downloads `capture-backup-YYYY-MM-DD.json` (every item, soft-deleted ones included) and records the time ("Last exported today").
- *Choose backup file…* shows the preview in plain sentences ("Adds 1 new item. Replaces 1 item with a newer version from the file. …") and waits for *Import* or *Cancel*. Import is disabled when there's nothing to add or update. If anything would be replaced, the preview offers to export a backup of this browser first.
- Errors say what's wrong ("This file isn't a backup from this app."); a failed import says nothing was changed.

**After the commit.** `importBackup()` throws only before its transaction commits, when nothing was written, so "nothing was changed" is always true when the UI says it. After the commit nothing throws: telling other tabs can't fail the import, and the index is rebuilt by `refreshIndex()`, which never throws. If a rebuild fails, search is marked stale (`store.searchStale`) and retried with backoff (1 s, 2 s, 4 s … up to 30 s) until it succeeds or the store closes. The result's `searchReady: false` lets the UI say the import finished and search is still catching up. Other tabs' "rebuild everything" messages use the same path.

**Mutation checks.** Removing the import transaction fails the all-or-nothing test; letting ties go to the backup fails the tie and re-import tests; comparing only counts for staleness fails the swapped-items test.

**Not yet:** Markdown export, and the gentle "no recent backup" hint from #4.

## 23. Installable PWA and persistent storage — Accepted

**Scope.** Installability and offline launch only. No accounts, sync or notifications.

**Service worker** (`vite-plugin-pwa`, Workbox `generateSW`; config in `vite.config.ts`):
- Precaches only the built app: HTML, JS, CSS, fonts, icons and the manifest. No runtime caching; the app makes no network requests for data.
- Item data lives in IndexedDB and is never cached or served by the service worker. IndexedDB stays the only source of truth.
- `navigateFallback: index.html`, so the app opens offline from any path.
- **Updates wait for the user.** `registerType: 'prompt'`: a new version installs in the background and a quiet banner offers "Reload to update" or "Later". It never reloads by itself, because that could throw away text being typed. `cleanupOutdatedCaches` removes old app versions.

**Manifest.** Name "Capture", standalone display, 192/512 icons plus a 512 maskable icon. Icons are drawn by `scripts/make-icons.mjs` (Node's zlib only, no image dependencies), so they can be regenerated from the repo.

**Persistent storage** (`src/store/persist.ts`, `src/app/usePersistence.ts`):
- Requested once, after the first capture, fire-and-forget: capture never waits for it, and it never throws.
- One controller per page (`createPersistence`) serializes this. Every capture while a request is in flight, or after one, shares that single request, so `persist()` is called at most once per page. It is not called again on a later visit once the flag says we asked, even before that visit's first check has answered.
- Results apply in the order their lookups started: a slow initial check that answers after a newer request can't overwrite the request's answer.
- State is `granted`, `denied`, `not-asked` or `unsupported`. A local flag records that we asked, so after a reload "not persisted" reads as denied rather than not asked.
- If denied or unsupported, a quiet line in the footer says the browser may clear the data when space runs low and suggests exporting a backup now and then. Nothing blocks or pops up.
- The backup panel states the status honestly. Even when granted it says clearing site data still removes the data; it never says storage is guaranteed.

**Verified against the production build** (`vite preview`):
- *First install*: the service worker activated and precached 12 files (app shell, assets, icons, manifest), with nothing from IndexedDB. The manifest was valid. The first capture triggered the storage request; this browser denied it, and the footer note appeared only then.
- *Offline*: with the server stopped (confirmed unreachable), a reload opened the app from the service worker with its data. Capture, inline edit, typo search, export and import (with preview) all worked.
- *Update with existing data*: after a rebuild with a marked change, reloading showed the banner while the old version kept running. "Reload to update" switched to the new version with all items intact and searchable.

**Known.** `npm audit` reports moderate advisories in Workbox's build-time dependency chain (`minimatch` via `ejs`/`jake`). They don't ship to the browser, and the suggested fix downgrades the plugin, so they're left for now.

---

## 24. End-to-end tests — Accepted

**Split.** Unit tests (Vitest) own the logic: date parsing, the model, merge rules, shortcut mapping. Playwright owns what only a browser shows: real keystrokes and focus, IndexedDB across reloads and tabs, downloads and file inputs, the service worker. An end-to-end test doesn't repeat a unit-test table.

**Setup** (`playwright.config.ts`, `e2e/`):
- Runs against the **production build**, since offline and updates need the real service worker. `npm run e2e` builds first.
- Uses the system's Edge through Playwright's `channel`, so there's no browser download. That also suits this Windows setup, where Application Control blocks some downloaded binaries.
- `e2e/server.mjs` is a small static server that test code (never the page) can switch between two builds, or make drop every connection as if stopped.
- `e2e/global-setup.ts` makes "build b" from the build: a marker in `index.html` plus the matching precache revision in `sw.js`, which is a real update as far as the browser is concerned.
- One worker, because the server's build switch is shared. Each test gets a fresh browser profile.

**What's covered:**
1. *Capture and shortcuts:*
   - Enter saves, keeps focus, and survives a reload. Shift+Enter adds a line.
   - Enter during IME composition doesn't save. Chromium has no scriptable IME, so the test sends the keydown an IME produces, with `isComposing` set.
   - Ctrl+Z undoes the last action outside fields and stays native undo inside them.
   - `/` opens search except while typing. Ctrl+K opens it from the capture bar and keeps half-typed text.
   - j/k/x/e/n, with focus kept or returned after each.
2. *Import safety:*
   - The backup is a real export, downloaded from another profile.
   - The preview comes first; Cancel writes nothing, checked after a reload. Re-importing finds nothing to change.
   - A preview made stale by another tab is refreshed and not applied.
   - A failed transaction: IndexedDB read-write transactions are made to throw. The import reports that nothing was changed, nothing is written, and a retry imports everything.
   - A non-backup file is refused before any preview.
3. *Offline:*
   - Install precaches only built files, and the manifest is valid.
   - With the server dropping connections and the browser offline (checked: a fetch from the page fails), a reload works. Capture, edit, search and export all work, and the backup imports into a second offline profile.
4. *Updates:* the new version is detected while text is half-typed. Nothing reloads; Later keeps version a, even across a plain reload. "Reload to update" brings in version b with all data intact and searchable.
5. *Persistence:* `navigator.storage` is stubbed to control the answer and its timing.
   - No request before the first capture.
   - Three quick captures, with the browser never answering, all save at once and make exactly one request. Checked by mutation: the previous code made three.
   - When denied: the footer note and backup text appear, and a reload doesn't ask again. When granted: no warning, with honest backup text.

---

## 25. Hosting on GitHub Pages — Accepted

**Why.** Installing and offline use need HTTPS (or `localhost`), so trying the app on a phone needs it hosted somewhere. GitHub Pages is free for this public repo and needs no server of our own.

**What's hosted.** Only the built app's files. Item data stays in IndexedDB in the browser it was captured in. Nothing is uploaded, and there's no sync: a phone and a computer each have their own data, and backup export and import moves it between them.

**How:**
- `.github/workflows/pages.yml` runs on every push to `main`. It runs the unit tests (a failing test means no deploy), builds with `BASE_PATH=/claudegpt/`, and deploys with `actions/deploy-pages`.
- `vite.config.ts` reads `BASE_PATH` (default `/`) for Vite's `base` and for the manifest's `start_url` and `scope`. Local development, `vite preview` and the e2e tests keep serving at `/`.
- The repo's Pages source must be set to "GitHub Actions" once, in the repo's settings.

**Verified** with a `/claudegpt/` build served under that path locally:
- The service worker's scope is `/claudegpt/` and it controls the page after a reload.
- The manifest's `start_url` and `scope` are `/claudegpt/`, and its icons load.
- An offline reload shows captured items, and an offline deep link inside the scope opens the app.

**Updates.** Each deploy is a new version. Installed copies show the "new version" banner and wait for the user (#23).

---

## Item schema

The source of truth is `src/model/item.ts`; this copy is for reading.

```ts
type Provenance = 'parsed' | 'user';

/** A value inferred by the parser or set by the user. `value: null` with
 *  source 'user' means the user explicitly removed it (#6). */
type Field<T> = { value: T | null; source: Provenance };

type ParseRef = { at: number; tz: string };   // reference for relative dates (#7)

type Zone =
  | { type: 'iana'; tz: string }                          // user's zone or a named region ("ET")
  | { type: 'offset'; minutes: number; label: string };   // explicit fixed zone ("EST" = -300)

type Due =
  | { type: 'date'; date: string }               // 'YYYY-MM-DD', floating
  | { type: 'instant'; at: number; zone: Zone }; // epoch ms + the zone it was expressed in

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
