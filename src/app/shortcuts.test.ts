import { describe, expect, it } from 'vitest';
import { isTypingTarget, shortcutFor } from './shortcuts';

const key = (k: string, target: Parameters<typeof isTypingTarget>[0] = { tagName: 'BODY' }, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; isComposing: boolean }> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  target,
  ...mods,
});

describe('isTypingTarget', () => {
  it.each<[string, Parameters<typeof isTypingTarget>[0], boolean]>([
    ['textarea', { tagName: 'TEXTAREA' }, true],
    ['text input', { tagName: 'INPUT', type: 'text' }, true],
    ['input with no type', { tagName: 'INPUT' }, true],
    ['date input', { tagName: 'INPUT', type: 'date' }, true],
    ['select', { tagName: 'SELECT' }, true],
    ['contenteditable', { tagName: 'DIV', isContentEditable: true }, true],
    ['checkbox', { tagName: 'INPUT', type: 'checkbox' }, false],
    ['button', { tagName: 'BUTTON' }, false],
    ['body', { tagName: 'BODY' }, false],
    ['nothing focused', null, false],
  ])('%s → %s', (_name, target, expected) => {
    expect(isTypingTarget(target)).toBe(expected);
  });
});

describe('shortcutFor', () => {
  it('"/" opens search when not typing', () => {
    expect(shortcutFor(key('/'))).toBe('search');
    expect(shortcutFor(key('/', { tagName: 'INPUT', type: 'checkbox' }))).toBe('search');
  });

  it('"/" types normally in fields', () => {
    expect(shortcutFor(key('/', { tagName: 'TEXTAREA' }))).toBeNull();
    expect(shortcutFor(key('/', { tagName: 'INPUT', type: 'text' }))).toBeNull();
    expect(shortcutFor(key('/', { tagName: 'DIV', isContentEditable: true }))).toBeNull();
  });

  it('Ctrl+K and Cmd+K open search from anywhere, including fields', () => {
    expect(shortcutFor(key('k', { tagName: 'TEXTAREA' }, { ctrlKey: true }))).toBe('search');
    expect(shortcutFor(key('K', { tagName: 'BODY' }, { metaKey: true }))).toBe('search');
  });

  it('nothing fires during IME composition', () => {
    expect(shortcutFor(key('/', { tagName: 'BODY' }, { isComposing: true }))).toBeNull();
    expect(shortcutFor(key('k', { tagName: 'BODY' }, { ctrlKey: true, isComposing: true }))).toBeNull();
  });

  it('other keys and modifier combinations do nothing', () => {
    expect(shortcutFor(key('k'))).toBeNull();
    expect(shortcutFor(key('/', { tagName: 'BODY' }, { ctrlKey: true }))).toBeNull();
    expect(shortcutFor(key('k', { tagName: 'BODY' }, { ctrlKey: true, altKey: true }))).toBeNull();
  });
});
