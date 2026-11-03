# Product

> Working name: **TBD**. Status: pre-implementation draft, under review.

## One-line pitch

The fastest way to get a thought out of your head, and the fastest way to find it again.

## Philosophy

**Capture now, decide later.** Most organizers make you classify at the moment of capture: task or note, which project, which list. That decision is where people give up. Here, capture is one text box. Structure is inferred, shown, and correctable — never demanded.

## Principles

These are the tie-breakers when a feature decision is unclear.

1. **Capture is instant.** Open → type → Enter. Under 2 seconds, no modal, no form, no required field beyond the text itself.
2. **Retrieval matters as much as capture.** Anything captured must be findable by search and must appear in the right time-based view, with no organizing required.
3. **Your words are sacred.** The original input is stored permanently and never overwritten by parsing. Parsed data is a layer on top of the text, not a replacement for it.
4. **Parsing is transparent.** The user always sees what was detected (date, tags, priority, link) and can correct any of it in one action. A correction always wins over the parser, permanently.
5. **No maintenance required.** The app stays useful even if the user never tags, never triages, never reviews. No mandatory inbox-zero, no unread counts, no red badges, no streaks, no organizational guilt. Organizing tools exist; using them is optional.
6. **Local-first and private.** Works offline, no account, data stays on the device, export is always one click away.
7. **Usefulness over feature count.** A feature earns its place by making capture or retrieval better. Otherwise it waits.

## Who it's for

Someone who currently texts themselves, keeps a "misc" note that grows forever, or has abandoned several todo apps because keeping them organized became a job.

## Core concepts

- **Item** — the only entity. Everything captured is an item. An item has its original text plus inferred, correctable metadata.
- **Kind** — `task`, `note`, or `link`. Inferred from the text; changeable. Labels like "idea" or "errand" are tags, not kinds.
- **Tags** — flat, optional, written inline as `#tag`.
- **Time** — an item may have a due date (all-day or timed). Time is what drives the default views.

## Capture syntax (MVP)

Free text, with these recognized inline:

| Input | Detected as |
|---|---|
| `tomorrow`, `fri 5pm`, `in 2 weeks`, `dec 3` | due date (resolved at capture time) |
| `#groceries` | tag |
| `!`, `!!`, `!!!` | priority 1–3 |
| `https://…` | link (kind becomes `link` if the URL is most of the input) |
| a due date or an action-like phrase | kind `task`; otherwise `note` |

While typing, detected spans are highlighted inline and summarized as chips under the input (e.g. `📅 Fri 7 Nov, 17:00` · `#groceries`). Clicking a chip edits or removes it. After saving, the same chips appear on the item and stay editable.

The text itself is always shown as written — syntax is highlighted, never hidden.

**How edits behave:**
- Relative dates are resolved when you type them. Editing an item resolves *newly typed* dates from the moment of the edit; fixing a typo elsewhere won't move an existing date.
- Remove syntax from the text and its detected value goes away with it.
- Anything you set or remove by hand stays that way, whatever the text says.

## MVP views

| View | Contents | Notes |
|---|---|---|
| **Inbox** | Open, unsnoozed items with no due date, captured in the last 7 days | A convenience, not an obligation. No count badge. Items quietly age out after 7 days (they remain in Everything and search). |
| **Today** | Open items due today, plus an "Earlier" section for past-due open items | "Earlier" is collapsed and neutral-colored — no red, no counter shaming. Completed items leave immediately. |
| **Upcoming** | Open items with future due dates, grouped by day | |
| **Everything** | All non-archived items, newest first, with completed items in their own section | Filterable by kind and tag. Includes snoozed items. |
| **Search** | Global, from anywhere (`/` or `Ctrl+K`), separate from capture | Results on every keystroke. |

Snoozed items are hidden from Inbox, Today and Upcoming until the snooze ends. Snooze presets: Later today, Tomorrow, Next week, Pick date/time.

## MVP features

- Single capture bar with live, transparent parsing
- Inline correction of any parsed field (date, kind, tags, priority)
- Edit, complete, snooze, archive, delete (soft delete with undo)
- Instant full-text, fuzzy search across text, tags, and URLs
- Keyboard-first operation; usable on mobile
- Installable PWA, fully offline
- JSON export and import (plus Markdown export)
- Persistent-storage request and visible backup/export affordance

## Explicitly not in MVP

| Postponed | Why |
|---|---|
| Reminder notifications | Browsers can't reliably notify when the app is closed without a push server. Until then, "reminder" means "appears in Today/Upcoming", and we say so honestly. |
| Accounts, sync, sharing | Needs a backend. Data model is designed to allow it later (see DECISIONS). |
| Link previews | Requires a server (CORS). |
| Attachments, images | Storage and eviction complexity. |
| Projects, nesting, custom views, kanban | Organizational overhead; conflicts with principle 5. |
| Rich text editor | Plain text keeps capture fast and parsing reliable. |
| AI features | Deterministic parsing is faster, offline, and predictable. An LLM fallback for ambiguous input may come later, opt-in. |
| Recurring items | Valuable but not trivial; revisit after MVP. |

## Success criteria for MVP

- Keystroke-to-saved in under 2 seconds from app open.
- Search results update in under 50 ms per keystroke with 10,000 items.
- Parser test suite covers the documented syntax with table-driven cases, including timezone and DST edges.
- Zero data loss paths: every destructive action is undoable; export is always available.
- The app is useful to someone who never tags or triages anything.
