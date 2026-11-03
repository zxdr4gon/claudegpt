import type { Item } from './item';

export const INBOX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Inbox (DECISIONS #11): open, no due date, not actively snoozed, and captured
 * within the last 7 days. A snooze that has expired no longer excludes an item.
 */
export function isInInbox(item: Item, now: number): boolean {
  if (item.deletedAt != null || item.status !== 'open') return false;
  if (item.due?.value != null) return false;
  if (item.snoozedUntil != null && item.snoozedUntil > now) return false;
  return now - item.capturedAt < INBOX_WINDOW_MS;
}
