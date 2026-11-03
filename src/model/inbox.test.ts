import { describe, expect, it } from 'vitest';
import { INBOX_WINDOW_MS, isInInbox } from './inbox';
import type { Item } from './item';
import { createItem, setDue } from './items';

const NOW = Date.UTC(2026, 10, 10, 12);
const DAY = 24 * 60 * 60 * 1000;
const clock = { now: NOW - DAY, tz: 'Asia/Dhaka' };
const item = (patch: Partial<Item> = {}): Item => ({ ...createItem('a thought', clock, 'id'), ...patch });

describe('isInInbox', () => {
  it.each<[string, Partial<Item>, boolean]>([
    ['fresh, open, undated', {}, true],
    ['captured 6 days ago', { capturedAt: NOW - 6 * DAY }, true],
    ['captured exactly 7 days ago', { capturedAt: NOW - INBOX_WINDOW_MS }, false],
    ['captured 8 days ago', { capturedAt: NOW - 8 * DAY }, false],
    ['done', { status: 'done' }, false],
    ['archived', { status: 'archived' }, false],
    ['deleted', { deletedAt: NOW - 1 }, false],
    ['actively snoozed', { snoozedUntil: NOW + 1 }, false],
    ['snooze has expired', { snoozedUntil: NOW - 1 }, true],
    ['snooze ends exactly now', { snoozedUntil: NOW }, true],
  ])('%s → %s', (_name, patch, expected) => {
    expect(isInInbox(item(patch), NOW)).toBe(expected);
  });

  it('uses capture time, not last edit', () => {
    expect(isInInbox(item({ capturedAt: NOW - 8 * DAY, updatedAt: NOW }), NOW)).toBe(false);
  });

  it('dated items are excluded; a dismissed date is not a date', () => {
    const dated = createItem('dentist tomorrow', clock, 'id');
    expect(isInInbox(dated, NOW)).toBe(false);
    expect(isInInbox(setDue(dated, null, clock), NOW)).toBe(true);
  });
});
