import { describe, expect, it } from 'vitest';
import { isTypingTarget, shortcutFor } from './shortcuts';

type Target = Parameters<typeof isTypingTarget>[0];
type Mods = Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; isComposing: boolean }>;

const BODY: Target = { tagName: 'BODY' };
const CAPTURE_BAR: Target = { tagName: 'TEXTAREA' };
const INLINE_EDITOR: Target = { tagName: 'TEXTAREA' };
const DATE_EDITOR: Target = { tagName: 'INPUT', type: 'date' };
const TIME_EDITOR: Target = { tagName: 'INPUT', type: 'time' };
const SNOOZE_PICKER: Target = { tagName: 'INPUT', type: 'datetime-local' };
const SEARCH_FIELD: Target = { tagName: 'INPUT', type: 'search' };
const CHECKBOX: Target = { tagName: 'INPUT', type: 'checkbox' };
const ROW_BUTTON: Target = { tagName: 'BUTTON' };

const press = (key: string, target: Target = BODY, mods: Mods = {}) =>
  shortcutFor({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target, ...mods });

describe('isTypingTarget', () => {
  it.each<[string, Target, boolean]>([
    ['textarea', { tagName: 'TEXTAREA' }, true],
    ['text input', { tagName: 'INPUT', type: 'text' }, true],
    ['input with no type', { tagName: 'INPUT' }, true],
    ['date input', DATE_EDITOR, true],
    ['select', { tagName: 'SELECT' }, true],
    ['contenteditable', { tagName: 'DIV', isContentEditable: true }, true],
    ['checkbox', CHECKBOX, false],
    ['button', ROW_BUTTON, false],
    ['body', BODY, false],
    ['nothing focused', null, false],
  ])('%s → %s', (_name, target, expected) => {
    expect(isTypingTarget(target)).toBe(expected);
  });
});

describe('Ctrl/Cmd+Z', () => {
  it('undoes the app’s last action when focus is not in a text field', () => {
    for (const target of [BODY, CHECKBOX, ROW_BUTTON, null]) {
      expect(press('z', target, { ctrlKey: true })).toBe('undo');
      expect(press('z', target, { metaKey: true })).toBe('undo');
    }
  });

  it.each<[string, Target]>([
    ['capture bar', CAPTURE_BAR],
    ['inline text editor', INLINE_EDITOR],
    ['date editor', DATE_EDITOR],
    ['time editor', TIME_EDITOR],
    ['snooze date/time picker', SNOOZE_PICKER],
    ['search field', SEARCH_FIELD],
  ])('leaves native undo alone in the %s', (_name, target) => {
    expect(press('z', target, { ctrlKey: true })).toBeNull();
    expect(press('z', target, { metaKey: true })).toBeNull();
  });

  it('never fires during IME composition', () => {
    expect(press('z', BODY, { ctrlKey: true, isComposing: true })).toBeNull();
  });

  it('leaves Ctrl+Shift+Z (redo) and Ctrl+Alt+Z to the browser', () => {
    expect(press('z', BODY, { ctrlKey: true, shiftKey: true })).toBeNull();
    expect(press('Z', BODY, { ctrlKey: true, shiftKey: true })).toBeNull();
    expect(press('z', BODY, { ctrlKey: true, altKey: true })).toBeNull();
  });
});

describe('search', () => {
  it('"/" opens search when not typing, and types normally in fields', () => {
    expect(press('/')).toBe('search');
    expect(press('/', CHECKBOX)).toBe('search');
    expect(press('/', CAPTURE_BAR)).toBeNull();
    expect(press('/', { tagName: 'DIV', isContentEditable: true })).toBeNull();
  });

  it('Ctrl+K and Cmd+K open search from anywhere, including fields', () => {
    expect(press('k', CAPTURE_BAR, { ctrlKey: true })).toBe('search');
    expect(press('K', BODY, { metaKey: true })).toBe('search');
  });

  it('nothing fires during IME composition', () => {
    expect(press('/', BODY, { isComposing: true })).toBeNull();
    expect(press('k', BODY, { ctrlKey: true, isComposing: true })).toBeNull();
  });
});

describe('single-letter commands', () => {
  it.each([
    ['n', 'capture'],
    ['j', 'next'],
    ['k', 'previous'],
    ['x', 'toggleDone'],
    ['e', 'edit'],
  ])('%s → %s when not typing', (key, command) => {
    expect(press(key)).toBe(command);
    expect(press(key, ROW_BUTTON)).toBe(command);
  });

  it.each([CAPTURE_BAR, INLINE_EDITOR, DATE_EDITOR, SEARCH_FIELD])('are plain letters in fields (%j)', (target) => {
    for (const key of ['n', 'j', 'k', 'x', 'e']) expect(press(key, target)).toBeNull();
  });

  it('never fire with modifiers, Shift, or during composition', () => {
    expect(press('x', BODY, { ctrlKey: true })).toBeNull();
    expect(press('x', BODY, { altKey: true })).toBeNull();
    expect(press('X', BODY, { shiftKey: true })).toBeNull();
    expect(press('x', BODY, { isComposing: true })).toBeNull();
  });

  it('other keys do nothing', () => {
    expect(press('q')).toBeNull();
    expect(press('Enter')).toBeNull();
  });
});
