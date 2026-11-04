// Global keyboard shortcuts (DECISIONS #17). They never fire while the user is
// typing in a field or composing text with an input method.

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

type KeyLike = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
  target: TargetLike;
};

/**
 * Which command a key press means, if any.
 * - `/` opens search, but only when not typing (it's a character in a field).
 * - Ctrl/Cmd+K opens search from anywhere: it never types a character.
 */
export function shortcutFor(e: KeyLike): 'search' | null {
  if (e.isComposing) return null;
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') return 'search';
  if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTypingTarget(e.target)) return 'search';
  return null;
}
