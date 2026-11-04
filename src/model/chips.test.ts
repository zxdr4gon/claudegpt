import { describe, expect, it } from 'vitest';
import { chipsFor, dueFromInputs } from './chips';
import { addTag, createItem, editText, removeTag, setDue, setKind, setPriority, setUrl, type Clock } from './items';

const NOW: Clock = { now: Date.UTC(2026, 10, 3, 4), tz: 'Asia/Dhaka' };
const capture = (text: string) => createItem(text, NOW, 'c');
const summary = (chips: ReturnType<typeof chipsFor>) =>
  chips.map((c) => `${c.field}:${c.source}${c.dismissed ? ':dismissed' : ''}${c.text ? `:${c.text}` : ''}`);

describe('chipsFor', () => {
  it('lists parsed values in a stable order', () => {
    const item = capture('call dentist tomorrow #health #teeth !! https://x.com');
    expect(summary(chipsFor(item))).toEqual([
      'due:parsed',
      'tag:parsed:health',
      'tag:parsed:teeth',
      'priority:parsed',
      'url:parsed',
    ]);
  });

  it('adds the kind chip only when asked', () => {
    const item = capture('buy milk');
    expect(summary(chipsFor(item))).toEqual([]);
    expect(chipsFor(item, { includeKind: true })[0]).toMatchObject({ field: 'kind', kind: 'task', source: 'parsed' });
    expect(chipsFor(setKind(item, 'note', NOW), { includeKind: true })[0]).toMatchObject({ kind: 'note', source: 'user' });
  });

  it('marks user-set values as user-owned', () => {
    let item = setDue(capture('dentist'), { type: 'date', date: '2026-12-01' }, NOW);
    item = addTag(item, 'errands', NOW);
    item = setPriority(item, 3, NOW);
    expect(summary(chipsFor(item))).toEqual(['due:user', 'tag:user:errands', 'priority:user']);
  });

  it('shows a dismissed value, struck, while the text still contains it', () => {
    let item = capture('dentist tomorrow #health !! https://x.com');
    item = setDue(item, null, NOW);
    item = removeTag(item, 'health', NOW);
    item = setPriority(item, null, NOW);
    item = setUrl(item, null, NOW);
    expect(summary(chipsFor(item))).toEqual([
      'due:user:dismissed:tomorrow',
      'tag:user:dismissed:health',
      'priority:user:dismissed:!!',
      'url:user:dismissed:https://x.com',
    ]);
  });

  it('drops a dismissed value once the text no longer contains it', () => {
    let item = capture('dentist tomorrow #health');
    item = setDue(item, null, NOW);
    item = removeTag(item, 'health', NOW);
    item = editText(item, 'dentist', NOW);
    expect(chipsFor(item)).toEqual([]);
  });

  it('a removed user-added tag that never was in the text leaves no chip', () => {
    const item = removeTag(addTag(capture('dentist'), 'errands', NOW), 'errands', NOW);
    expect(chipsFor(item)).toEqual([]);
  });
});

describe('dueFromInputs', () => {
  const TZ = 'Asia/Dhaka';
  it('no time means all-day', () => {
    expect(dueFromInputs('2026-12-01', '', TZ)).toEqual({ type: 'date', date: '2026-12-01' });
  });
  it('a time makes an instant in the viewer zone', () => {
    expect(dueFromInputs('2026-12-01', '15:30', TZ)).toEqual({
      type: 'instant',
      at: Date.UTC(2026, 11, 1, 9, 30),
      zone: { type: 'iana', tz: TZ },
    });
  });
  it.each([
    ['', ''],
    ['2026-02-31', ''],
    ['2026-13-01', '10:00'],
    ['2026-12-01', '25:00'],
    ['2026-12-01', '10:60'],
    ['tomorrow', ''],
  ])('rejects %j %j', (date, time) => {
    expect(dueFromInputs(date, time, TZ)).toBeNull();
  });
});
