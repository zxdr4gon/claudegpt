// Global keyboard shortcuts (DECISIONS #17, #21). They never fire during IME
// composition, and never take over a key that types or edits text in a field.

/** Input types that accept typed text (a checkbox or button doesn't). */
const TEXT_INPUT_TYPES = new Set([
  'text', 'search', 'email', 'url', 'tel', 'password', 'number',
  'date', 'time', 'datetime-local', 'month', 'week',
]);

type TargetLike = { tagName?: string; type?: string; isContentEditable?: boolean } | null;

/** True when keystrokes on this element are typing, not commands. */
export function isTypingTarget(target: TargetLike): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName?.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return TEXT_INPUT_TYPES.has((target.type ?? 'text').toLowerCase());
  return false;
}

export type Command =
  | 'search' // `/`, Ctrl/Cmd+K
  | 'undo' // Ctrl/Cmd+Z
  | 'capture' // n: focus the capture bar
  | 'next' // j: next item
  | 'previous' // k: previous item
  | 'toggleDone' // x: complete or reopen the focused item
  | 'edit'; // e: edit the focused item's text

type KeyLike = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  target: TargetLike;
};

const LETTERS: Record<string, Command> = {
  n: 'capture',
  j: 'next',
  k: 'previous',
  x: 'toggleDone',
  e: 'edit',
};

/**
 * Which command a key press means, if any.
 * - Ctrl/Cmd+K opens search from anywhere: it never types a character.
 * - Ctrl/Cmd+Z undoes the app's last action, but inside a text field it stays
 *   the field's own undo. Ctrl+Shift+Z (redo) is left to the browser.
 * - `/` and single letters only act when not typing, and never with modifiers.
 */
export function shortcutFor(e: KeyLike): Command | null {
  if (e.isComposing) return null;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (mod && !e.altKey && !e.shiftKey && key === 'k') return 'search';
  if (mod && !e.altKey && !e.shiftKey && key === 'z') return isTypingTarget(e.target) ? null : 'undo';
  if (mod || e.altKey || isTypingTarget(e.target)) return null;
  if (e.key === '/') return 'search';
  if (e.shiftKey) return null;
  return LETTERS[e.key] ?? null;
}
