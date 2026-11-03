import { describe, expect, it } from 'vitest';
import type { Item } from './item';
import { createItem, setDue } from './items';
import { isCalendarDate, isValidItem, upgradeShape } from './migrate';

const clock = { now: Date.UTC(2026, 10, 2, 4), tz: 'Asia/Dhaka' };
const timed = createItem('call mom tomorrow 3pm #family !! https://x.com', clock, 'id1');

/** The v1 shape of a timed due date: `tz` directly on the value. */
function legacy(item: Item): Record<string, unknown> {
  const v = item.due!.value as { at: number; zone: { tz: string } };
  return { ...item, due: { ...item.due, value: { type: 'instant', at: v.at, tz: v.zone.tz } } };
}

describe('upgradeShape', () => {
  it('migrates a legacy parsed timed due date', () => {
    expect(upgradeShape(legacy(timed))).toEqual(timed);
  });

  it('migrates a legacy user-owned timed due date (reparse would not touch it)', () => {
    const user = setDue(timed, { type: 'instant', at: 123, zone: { type: 'iana', tz: 'Europe/Paris' } }, clock);
    const migrated = upgradeShape(legacy(user)) as Item;
    expect(migrated.due).toEqual({ value: { type: 'instant', at: 123, zone: { type: 'iana', tz: 'Europe/Paris' } }, source: 'user' });
    expect(isValidItem(migrated)).toBe(true);
  });

  it.each<[string, unknown]>([
    ['current item', timed],
    ['all-day due', createItem('dentist tomorrow', clock, 'id2')],
    ['no due', createItem('a thought', clock, 'id3')],
    ['dismissed due', setDue(timed, null, clock)],
    ['not an object', 42],
    ['null', null],
  ])('leaves %s unchanged', (_name, input) => {
    expect(upgradeShape(input)).toBe(input);
  });
});

const offsetDue = (minutes: number, label: string) => ({
  value: { type: 'instant', at: 1, zone: { type: 'offset', minutes, label } },
  source: 'user',
});

describe('isCalendarDate', () => {
  it.each([
    ['2026-11-03', true],
    ['2028-02-29', true],
    ['2026-12-31', true],
    ['2026-02-29', false],
    ['2026-02-31', false],
    ['2026-04-31', false],
    ['2026-00-10', false],
    ['2026-11-00', false],
    ['2026-1-3', false],
    ['03/11/2026', false],
    [20261103, false],
  ])('%j → %s', (input, expected) => {
    expect(isCalendarDate(input)).toBe(expected);
  });
});

describe('isValidItem', () => {
  it('accepts real items', () => {
    expect(isValidItem(timed)).toBe(true);
    expect(isValidItem(createItem('a thought', clock, 'x'))).toBe(true);
    expect(isValidItem(JSON.parse(JSON.stringify(timed)))).toBe(true);
  });

  // The parser and the validator must agree, or the app's own backups wouldn't import.
  it.each([
    'call at 5pm EST',
    'deploy 17:00 UTC',
    'call 5pm GMT+3',
    'standup noon ET',
    'tomorrow 9am PST',
    'in 2 days at 9am PST',
    'in 3 hours',
    'dentist tomorrow 3pm',
    'gift for dec 3',
    'file taxes 3/4',
    'review monday morning #work !!! https://example.com/a',
  ])('everything the parser produces is valid: %j', (text) => {
    expect(isValidItem(createItem(text, clock, 'p'))).toBe(true);
  });

  it('rejects the legacy shape until it is upgraded', () => {
    expect(isValidItem(legacy(timed))).toBe(false);
  });

  // Each case breaks one nested field of an otherwise valid item.
  const broken: [string, (i: Record<string, unknown>) => void][] = [
    ['textRef null', (i) => (i.textRef = null)],
    ['textRef bad tz', (i) => (i.textRef = { at: 1, tz: 'Not/AZone' })],
    ['textRef missing at', (i) => (i.textRef = { tz: 'UTC' })],
    ['empty id', (i) => (i.id = '')],
    ['numeric id', (i) => (i.id = 7)],
    ['text not a string', (i) => (i.text = null)],
    ['kind null', (i) => (i.kind = null)],
    ['kind value null', (i) => (i.kind = { value: null, source: 'user' })],
    ['kind unknown', (i) => (i.kind = { value: 'event', source: 'parsed' })],
    ['kind bad source', (i) => (i.kind = { value: 'task', source: 'ai' })],
    ['due null', (i) => (i.due = null)],
    ['parsed due with null value', (i) => (i.due = { value: null, source: 'parsed' })],
    ['due bad date', (i) => (i.due = { value: { type: 'date', date: '3 Nov' }, source: 'user' })],
    ['due instant without zone', (i) => (i.due = { value: { type: 'instant', at: 1 }, source: 'user' })],
    ['due bad zone', (i) => (i.due = { value: { type: 'instant', at: 1, zone: { type: 'iana', tz: 'Mars/Base' } }, source: 'user' })],
    ['due bad offset', (i) => (i.due = { value: { type: 'instant', at: 1, zone: { type: 'offset', minutes: 'x', label: 'EST' } }, source: 'user' })],
    ['due impossible date', (i) => (i.due = { value: { type: 'date', date: '2026-02-31' }, source: 'user' })],
    ['due Feb 29 in a common year', (i) => (i.due = { value: { type: 'date', date: '2026-02-29' }, source: 'user' })],
    ['due month 13', (i) => (i.due = { value: { type: 'date', date: '2026-13-01' }, source: 'parsed' })],
    ['offset above +14:00', (i) => (i.due = offsetDue(14 * 60 + 1, 'X'))],
    ['offset below -12:00', (i) => (i.due = offsetDue(-12 * 60 - 1, 'X'))],
    ['fractional offset', (i) => (i.due = offsetDue(60.5, 'X'))],
    ['empty offset label', (i) => (i.due = offsetDue(-300, ''))],
    ['blank offset label', (i) => (i.due = offsetDue(-300, '   '))],
    ['due NaN instant', (i) => (i.due = { value: { type: 'instant', at: NaN, zone: { type: 'iana', tz: 'UTC' } }, source: 'user' })],
    ['due bad ref', (i) => (i.due = { ...(i.due as object), ref: { at: 'now', tz: 'UTC' } })],
    ['priority 4', (i) => (i.priority = { value: 4, source: 'user' })],
    ['url number', (i) => (i.url = { value: 5, source: 'parsed' })],
    ['tags not array', (i) => (i.tags = 'family')],
    ['tag null', (i) => (i.tags = [null])],
    ['tag empty', (i) => (i.tags = [{ value: '', source: 'user' }])],
    ['tag bad dismissed', (i) => (i.tags = [{ value: 'a', source: 'user', dismissed: 'yes' }])],
    ['spans not array', (i) => (i.spans = {})],
    ['span past end of text', (i) => (i.spans = [{ start: 0, end: 999, field: 'tag' }])],
    ['span reversed', (i) => (i.spans = [{ start: 3, end: 1, field: 'tag' }])],
    ['span bad field', (i) => (i.spans = [{ start: 0, end: 1, field: 'colour' }])],
    ['parserVersion missing', (i) => delete i.parserVersion],
    ['status unknown', (i) => (i.status = 'pending')],
    ['capturedAt string', (i) => (i.capturedAt = '2026-11-02')],
    ['updatedAt Infinity', (i) => (i.updatedAt = Infinity)],
    ['deletedAt string', (i) => (i.deletedAt = 'yesterday')],
  ];

  it.each<[string, unknown]>([
    ['offset at +14:00', offsetDue(14 * 60, 'LINT')],
    ['offset at -12:00', offsetDue(-12 * 60, 'AOE')],
    ['quarter-hour offset', offsetDue(345, 'NPT')],
    ['leap day', { value: { type: 'date', date: '2028-02-29' }, source: 'user' }],
  ])('accepts %s', (_name, due) => {
    expect(isValidItem({ ...timed, due })).toBe(true);
  });

  it.each(broken)('rejects %s', (_name, breakIt) => {
    const item = structuredClone(timed) as unknown as Record<string, unknown>;
    breakIt(item);
    expect(isValidItem(item)).toBe(false);
  });
});
