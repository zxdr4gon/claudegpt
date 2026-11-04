# Using Capture

Capture is for getting a thought out of your head in two seconds and finding it again later. You type, press Enter, and you're done. Nothing has to be sorted, filed or reviewed.

**Open it:** https://zxdr4gon.github.io/claudegpt/

## Install it (optional, recommended)

Installing gives it its own icon and window, and it opens even with no internet.

- **Android (Chrome or Edge):** open the link, tap the **⋮** menu, then **Install app** (or **Add to Home screen**).
- **iPhone or iPad (Safari):** open the link, tap **Share**, then **Add to Home Screen**.
- **Windows or Mac (Edge or Chrome):** open the link and click the install icon at the right end of the address bar, or choose **⋮ → Apps → Install Capture**.

After it's installed once, it works fully offline.

## Capturing

Type in the box at the top and press **Enter**. On a phone, tap **Save**.

- **Shift+Enter** starts a new line instead of saving.
- The box clears straight away, so you can keep typing the next thought.
- Whatever you type is saved exactly as written. Nothing you type is ever rewritten.

As you type, Capture highlights what it recognises and shows it as small chips under the box:

| Type this | And it understands |
|---|---|
| `tomorrow`, `fri 5pm`, `in 2 weeks`, `dec 3`, `monday morning` | a due date (and time, if you gave one) |
| `3pm ET`, `9am PT`, `10:00 GMT+2` | a time in another time zone |
| `#groceries`, `#work` | a tag (as many as you like) |
| `!`, `!!`, `!!!` | priority: low, medium, high |
| `https://…` | a link |

**Examples:**
- `call dentist tomorrow 3pm #health`
- `pay rent dec 1 !!`
- `https://example.com/article read later #reading`
- `idea: a shelf above the desk`, a plain note with no date

Relative dates like "tomorrow" or "in 2 weeks" are worked out at the moment you save, so they won't drift later.

Each item is a **task** (it has a date or reads like something to do), a **note**, or a **link**. Capture guesses, and you can change it.

## Fixing what it guessed

Every item shows its chips: date, tags, priority and link. **Click a chip** to change or remove it:
- **Date:** *Change date…* (pick a date, and a time if you want) or *Remove date*.
- **Tag:** *Remove tag*.
- **Priority:** pick another level, or *Remove priority*.
- **Link:** open it, or *Remove link*.

A chip's menu says whether the value was **detected from the text** or **set by you**. Anything you set or remove by hand stays that way, even if you later edit the text. *Reset to the text* hands control back to what the text says.

## Editing text

Click an item's text to edit it in place:
- **Enter** saves, and **Shift+Enter** adds a line.
- **Escape** cancels.
- Clicking away also saves.

Editing only re-reads newly typed dates. Fixing a typo elsewhere won't move an existing date. If you delete the word "tomorrow" from the text, its date goes away too, unless you had set the date by hand.

## The views

The tabs under the capture box:

- **Inbox:** things captured in the last 7 days that have no date. It's a convenience, not a to-do pile: items quietly leave it after a week and are still in Everything and Search. There are no counts and no badges.
- **Today:** what's due today, including times already passed. Items due on earlier days sit in a collapsed **Earlier** section with no red and no counters. Completed items leave Today at once.
- **Upcoming:** future items, grouped by day.
- **Everything:** all your items, newest first, with completed ones in their own **Completed** section. Snoozed items are here too.

## Actions on an item

- **Checkbox:** mark as done. Tick it again in Everything to reopen it.
- **⋯ (More actions):**
  - **Snooze until:**
    - *Later today:* the start of the next hour.
    - *Tomorrow:* 9:00.
    - *Next week:* Monday 9:00.
    - *Pick date/time…*
    - *Clear snooze* removes a snooze. Snoozed items stay out of Inbox, Today and Upcoming until then.
  - **Archive:** out of every view, but you can still find it with Search if you tick *Include archived*. *Unarchive* brings it back.
  - **Delete:** removes it. Undo straight away if it was a mistake (see below).

## Undo

Every change shows a small message at the bottom with an **Undo** button, and **Ctrl+Z** (**Cmd+Z** on a Mac) does the same. Inside a text box, Ctrl+Z is the box's own undo instead.

Undo is careful: if the item has changed since (for example in another tab), it tells you rather than overwriting the newer version.

## Search

Click **Search**, or press **/** or **Ctrl+K** (Cmd+K) from anywhere.

- Results update as you type and forgive small typos (`dentst` finds "dentist").
- It searches text, tags and links.
- Every word must match: `rent 1st` finds items with both.
- Tick **Include archived** to search archived items too.
- **Escape** closes search.

## Keyboard shortcuts

These work when you're not typing in a box:

| Key | Does |
|---|---|
| `n` | jump to the capture box |
| `/` or `Ctrl+K` | search |
| `j` / `k` | next / previous item |
| `x` | mark the selected item done (or not done) |
| `e` | edit the selected item's text |
| `Ctrl+Z` | undo the last change |

## Your data: where it lives and how to keep it safe

- **Everything stays in this browser on this device.** There's no account and no server, and nothing is uploaded. The website only delivers the app itself.
- **Each device and browser has its own separate data.** Your phone and your computer don't see each other's items.
- **The browser may clear the data** in some cases: very low storage, or you clearing site data or browsing history. Capture asks the browser to keep it, and if the browser says no, a quiet line at the bottom of the page tells you.

**Back up now and then:** at the bottom of the page, click **Backup and restore**, then **Export backup**. That downloads a `capture-backup-YYYY-MM-DD.json` file. Keep it somewhere safe, such as cloud storage or email to yourself.

**To restore or move to another device:**
1. Open Capture on the other device.
2. Go to **Backup and restore → Choose backup file…** and pick the file.
3. It shows exactly what will happen first: how many items will be added, replaced or left alone. Nothing changes until you click **Import**.
4. Importing merges rather than wiping: for each item, the newer version wins.

## Updates

When a new version is ready, a small banner says **A new version of Capture is ready.**
- **Reload to update** switches to it now.
- **Later** keeps using the current version. You'll be offered it again next time.

It never reloads on its own, so you won't lose something half-typed. Updates never touch your items.

## Not yet (on purpose)

Capture doesn't do these yet:
- **No reminders or notifications:** "due" means it shows up in Today and Upcoming.
- **No syncing between devices:** use backup and restore.
- **No recurring items.**
- **No filtering of Everything by kind or tag yet:** use Search for now.
- **No Markdown export yet.**

If something feels slow, confusing or like busywork, write it down. That's exactly the feedback this first week is for.
