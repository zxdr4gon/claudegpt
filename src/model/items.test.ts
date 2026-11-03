import { describe, expect, it } from 'vitest';
import { activeTags, type Item } from './item';
import {
  addTag,
  createItem,
  editText,
  removeTag,
  reparse,
  resetField,
  resetTag,
  setDue,
  setKind,
  setPriority,
  type Clock,
} from './items';

const utc = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);
const TZ = 'Asia/Dhaka';
// Monday 2 Nov, Wednesday 4 Nov 2026, 10:00 in Dhaka.
const MON: Clock = { now: utc(2026, 11, 2, 4), tz: TZ };
const WED: Clock = { now: utc(2026, 11, 4, 4), tz: TZ };
const FRI: Clock = { now: utc(2026, 11, 6, 4), tz: TZ };

const capture = (text: string, clock = MON) => createItem(text, clock, 'test-id');
const dueDate = (item: Item) => (item.due?.value?.type === 'date' ? item.due.value.date : item.due?.value);
const spanTexts = (item: Item) => item.spans.map((s) => `${s.field}:${item.text.slice(s.start, s.end)}`);

describe('capture', () => {
  it('stores raw text, references and parsed values', () => {
    const item = capture('call dentist tomorrow #health !!');
    expect(item).toMatchObject({
      rawText: 'call dentist tomorrow #health !!',
      text: 'call dentist tomorrow #health !!',
      textRef: { at: MON.now, tz: TZ },
      kind: { value: 'task', source: 'parsed' },
      due: { value: { type: 'date', date: '2026-11-03' }, source: 'parsed', ref: { at: MON.now, tz: TZ } },
      priority: { value: 2, source: 'parsed' },
      tags: [{ value: 'health', source: 'parsed' }],
      capturedAt: MON.now,
      createdAt: MON.now,
      updatedAt: MON.now,
      parserVersion: 1,
      status: 'open',
    });
    expect(spanTexts(item)).toEqual(['due:tomorrow', 'tag:#health', 'priority:!!']);
  });

  it.each<[string, string]>([
    ['idea: shelf-life tracker #side-project', 'note'],
    ['note: tomorrow is a holiday', 'note'],
    ['todo: groceries', 'task'],
    ['buy milk', 'task'],
    ['the sky was nice', 'note'],
    ['https://example.com/article', 'link'],
    ['great read https://example.com/article #reading', 'link'],
    ['read https://example.com/article tomorrow', 'task'],
    [
      'long thoughts about this article and why it matters so much https://example.com',
      'link',
    ],
  ])('kind of %j is %s', (text, kind) => {
    expect(capture(text).kind.value).toBe(kind);
  });

  it('only the first date expression becomes the due date', () => {
    const item = capture('dentist fri, then gym tomorrow');
    expect(dueDate(item)).toBe('2026-11-06');
    expect(spanTexts(item)).toEqual(['due:fri']);
  });
});

describe('editing text: date resolution (DECISIONS #7)', () => {
  it('fixing a typo elsewhere keeps the original due date and reference', () => {
    const item = editText(capture('call dentsit tomorrow'), 'call dentist tomorrow', WED);
    expect(dueDate(item)).toBe('2026-11-03'); // Tuesday, not Thursday
    expect(item.due?.ref).toEqual({ at: MON.now, tz: TZ });
    expect(item.textRef).toEqual({ at: WED.now, tz: TZ });
  });

  it('typo fixes on both sides of the date in one edit keep it', () => {
    const item = editText(capture('cal mom tomorrow abt bday'), 'call mom tomorrow about bday', WED);
    expect(dueDate(item)).toBe('2026-11-03');
    expect(item.due?.ref?.at).toBe(MON.now);
  });

  it('moving text around the date by prefixing keeps it', () => {
    const item = editText(capture('dentist tomorrow'), 'URGENT: dentist tomorrow', WED);
    expect(dueDate(item)).toBe('2026-11-03');
  });

  it('changing the date expression resolves from the edit time', () => {
    const item = editText(capture('dentist tomorrow'), 'dentist friday', WED);
    expect(dueDate(item)).toBe('2026-11-06');
    expect(item.due?.ref).toEqual({ at: WED.now, tz: TZ });
  });

  it('extending the date expression resolves from the edit time', () => {
    const item = editText(capture('dentist tomorrow'), 'dentist tomorrow 3pm', WED);
    // Thursday 5 Nov, 15:00 Dhaka.
    expect(item.due?.value).toEqual({ type: 'instant', at: utc(2026, 11, 5, 9), zone: { type: 'iana', tz: TZ } });
  });

  it('retyping the same word inside it counts as a change', () => {
    const item = editText(capture('dentist tomorrow'), 'dentist tomorr ow', WED);
    // "tomorr ow" is no longer a date expression at all.
    expect(item.due).toBeUndefined();
  });

  it('a duplicate expression does not inherit the deleted one’s resolution', () => {
    // Monday: first "tomorrow" (Tue) is the due date. Wednesday: delete it, so the
    // second "tomorrow" becomes primary. It must resolve from Wednesday (Thu).
    const item = editText(capture('tomorrow prep, tomorrow review'), 'prep, tomorrow review', WED);
    expect(dueDate(item)).toBe('2026-11-05');
    expect(item.due?.ref?.at).toBe(WED.now);
  });

  it('a new earlier date becomes primary and resolves from the edit time', () => {
    const item = editText(capture('gym friday'), 'tomorrow: gym friday', WED);
    expect(dueDate(item)).toBe('2026-11-05');
    expect(spanTexts(item)).toEqual(['due:tomorrow']);
  });

  it('adding a date to an item without one uses the edit time', () => {
    const item = editText(capture('dentist'), 'dentist tomorrow', WED);
    expect(dueDate(item)).toBe('2026-11-05');
  });

  it('removing the date expression removes the parsed due date', () => {
    const item = editText(capture('dentist tomorrow'), 'dentist', WED);
    expect(item.due).toBeUndefined();
    expect(item.spans).toEqual([]);
  });

  it('survives several edits in a row', () => {
    let item = capture('call dentsit tomorrow');
    item = editText(item, 'call dentist tomorrow', WED);
    item = editText(item, 'call the dentist tomorrow', FRI);
    expect(dueDate(item)).toBe('2026-11-03');
  });

  it('editing to identical text is a no-op', () => {
    const item = capture('dentist tomorrow');
    expect(editText(item, 'dentist tomorrow', WED)).toBe(item);
  });

  it('editing in a different timezone resolves new dates there', () => {
    // Wednesday 10:00 Dhaka is still Tuesday 23:00 in New York.
    const item = editText(capture('dentist'), 'dentist tomorrow', { now: WED.now, tz: 'America/New_York' });
    expect(dueDate(item)).toBe('2026-11-04');
    expect(item.due?.ref?.tz).toBe('America/New_York');
  });
});

describe('editing text: other parsed fields (DECISIONS #14)', () => {
  it('stale parsed fields are removed', () => {
    const item = editText(capture('fix bug !! #work https://x.com/1'), 'fix bug', WED);
    expect(item.priority).toBeUndefined();
    expect(item.url).toBeUndefined();
    expect(item.tags).toEqual([]);
  });

  it('parsed kind is recomputed', () => {
    let item = capture('the sky was nice');
    expect(item.kind.value).toBe('note');
    item = editText(item, 'the sky was nice, paint it tomorrow', WED);
    expect(item.kind.value).toBe('task');
  });

  it('raw text and capture time never change', () => {
    let item = capture('first');
    item = editText(item, 'second', WED);
    item = setKind(item, 'note', FRI);
    expect(item.rawText).toBe('first');
    expect(item.capturedAt).toBe(MON.now);
    expect(item.createdAt).toBe(MON.now);
    expect(item.updatedAt).toBe(FRI.now);
  });
});

describe('user-owned fields are never modified by parsing', () => {
  it('user due date survives removal of the date text', () => {
    let item = setDue(capture('dentist tomorrow'), { type: 'date', date: '2026-12-01' }, MON);
    item = editText(item, 'dentist', WED);
    expect(item.due).toEqual({ value: { type: 'date', date: '2026-12-01' }, source: 'user' });
    expect(item.spans).toEqual([]);
  });

  it('a dismissed due date stays dismissed when dates are typed', () => {
    let item = setDue(capture('dentist tomorrow'), null, MON);
    expect(item.due).toEqual({ value: null, source: 'user' });
    item = editText(item, 'dentist friday 3pm', WED);
    expect(item.due).toEqual({ value: null, source: 'user' });
    expect(item.spans.some((s) => s.field === 'due')).toBe(false);
  });

  it('resetting the due date goes back to the text, resolved from the last edit', () => {
    let item = setDue(capture('dentist tomorrow'), null, MON);
    item = editText(item, 'dentist friday', WED);
    item = resetField(item, 'due', FRI);
    expect(dueDate(item)).toBe('2026-11-06');
    expect(item.due?.ref?.at).toBe(WED.now);
  });

  it('user kind survives edits', () => {
    let item = setKind(capture('buy milk'), 'note', MON);
    item = editText(item, 'buy milk tomorrow', WED);
    expect(item.kind).toEqual({ value: 'note', source: 'user' });
    item = resetField(item, 'kind', WED);
    expect(item.kind).toEqual({ value: 'task', source: 'parsed' });
  });

  it('user priority survives edits; dismissed priority blocks re-detection', () => {
    let item = setPriority(capture('fix bug'), 3, MON);
    item = editText(item, 'fix bug !', WED);
    expect(item.priority).toEqual({ value: 3, source: 'user' });
    item = setPriority(item, null, WED);
    item = editText(item, 'fix bug !!', FRI);
    expect(item.priority).toEqual({ value: null, source: 'user' });
  });

  it('a user due date still makes an item a task', () => {
    const item = setDue(capture('the sky was nice'), { type: 'date', date: '2026-12-01' }, MON);
    expect(item.kind.value).toBe('task');
  });
});

describe('tags: per-tag provenance', () => {
  it('removing one parsed tag leaves the others parsed', () => {
    const item = removeTag(capture('plan #a #b'), 'a', MON);
    expect(item.tags).toEqual([
      { value: 'a', source: 'user', dismissed: true },
      { value: 'b', source: 'parsed' },
    ]);
    expect(activeTags(item)).toEqual(['b']);
    expect(spanTexts(item)).toEqual(['tag:#b']);
  });

  it('a dismissed tag is not resurrected by text that still contains it', () => {
    let item = removeTag(capture('plan #a #b'), 'a', MON);
    item = editText(item, 'plan more #a #b', WED);
    expect(activeTags(item)).toEqual(['b']);
    item = editText(item, 'plan #b #A again', FRI);
    expect(activeTags(item)).toEqual(['b']);
  });

  it('parsed tags removed from the text disappear; user tags stay', () => {
    let item = addTag(capture('plan #a #b'), 'Mine', MON);
    item = editText(item, 'plan #a', WED);
    expect(item.tags).toEqual([
      { value: 'mine', source: 'user' },
      { value: 'a', source: 'parsed' },
    ]);
  });

  it('re-adding a dismissed tag makes it user-owned and active', () => {
    let item = removeTag(capture('plan #a'), 'a', MON);
    item = addTag(item, '#a', WED);
    expect(item.tags).toEqual([{ value: 'a', source: 'user' }]);
    expect(item.spans).toEqual([]); // user value, not a parsed match
  });

  it('adding a tag that is already active is a no-op', () => {
    const item = capture('plan #a');
    expect(addTag(item, 'A', WED)).toBe(item);
  });

  it('resetting a tag hands it back to the text', () => {
    let item = removeTag(capture('plan #a'), 'a', MON);
    item = resetTag(item, 'a', WED);
    expect(item.tags).toEqual([{ value: 'a', source: 'parsed' }]);
  });

  it('duplicate tag syntax yields one tag and highlights both', () => {
    const item = capture('#a and #A');
    expect(item.tags).toEqual([{ value: 'a', source: 'parsed' }]);
    expect(spanTexts(item)).toEqual(['tag:#a', 'tag:#A']);
  });
});

describe('reparse (parser upgrades)', () => {
  it('is deterministic and independent of the current time', () => {
    let item = capture('call dentsit tomorrow 3pm #health');
    item = editText(item, 'call dentist tomorrow 3pm #health', WED);
    const once = reparse(item);
    expect(once).toEqual(item);
    expect(reparse(once)).toEqual(once);
  });

  it('re-resolves dates against their stored references', () => {
    const item = editText(capture('dentist tomorrow, gym'), 'dentist tomorrow, gym later', WED);
    // Simulate an old record whose stored due value is stale.
    const stale: Item = { ...item, due: { ...item.due!, value: { type: 'date', date: '1999-01-01' } } };
    expect(dueDate(reparse(stale))).toBe('2026-11-03');
  });
});
