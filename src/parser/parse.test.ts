import { describe, expect, it } from 'vitest';
import type { Due, ParseRef } from '../model/item';
import { parseText } from './parse';

const utc = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);

// Tuesday 2026-11-03, 10:00 in Dhaka (+06:00).
const DHAKA: ParseRef = { at: utc(2026, 11, 3, 4), tz: 'Asia/Dhaka' };

const date = (d: string): Due => ({ type: 'date', date: d });
const instant = (at: number, tz: string): Due => ({ type: 'instant', at, tz });

describe('dates', () => {
  it.each<[string, string, ParseRef, Due]>([
    ['relative day', 'call dentist tomorrow', DHAKA, date('2026-11-04')],
    ['abbreviation', 'call dentist tmr', DHAKA, date('2026-11-04')],
    ['weekday + time', 'standup fri 5pm', DHAKA, instant(utc(2026, 11, 6, 11), 'Asia/Dhaka')],
    ['abbreviated day + time', 'tmrw 3pm dentist', DHAKA, instant(utc(2026, 11, 4, 9), 'Asia/Dhaka')],
    ['duration in days', 'renew passport in 2 weeks', DHAKA, date('2026-11-17')],
    ['month + day', 'gift for dec 3', DHAKA, date('2026-12-03')],
    ['casual time of day stays all-day', 'pack tonight', DHAKA, date('2026-11-03')],
    ['explicit zone', 'call at 5pm EST', DHAKA, instant(utc(2026, 11, 3, 22), 'Asia/Dhaka')],
    [
      // 02:30 local on Nov 4 in Dhaka is still Nov 3 in UTC; "tomorrow" is Nov 5.
      'local date differs from UTC date',
      'tomorrow',
      { at: utc(2026, 11, 3, 20, 30), tz: 'Asia/Dhaka' },
      date('2026-11-05'),
    ],
    [
      // 22:00 on Nov 3 in New York is already Nov 4 in UTC; "tomorrow" is Nov 4.
      'local date behind UTC date',
      'tomorrow',
      { at: utc(2026, 11, 4, 3), tz: 'America/New_York' },
      date('2026-11-04'),
    ],
    [
      // Captured Sat Oct 31 (EDT, -4). Sunday 9am is after the switch to EST (-5).
      'wall time across DST uses the target date offset',
      'tomorrow 9am',
      { at: utc(2026, 10, 31, 16), tz: 'America/New_York' },
      instant(utc(2026, 11, 1, 14), 'America/New_York'),
    ],
    [
      // 00:30 EDT + 3h of elapsed time = 02:30 EST = 07:30Z.
      'duration across DST is elapsed time',
      'in 3 hours',
      { at: utc(2026, 11, 1, 4, 30), tz: 'America/New_York' },
      instant(utc(2026, 11, 1, 7, 30), 'America/New_York'),
    ],
  ])('%s: %j', (_name, text, ref, expected) => {
    expect(parseText(text, ref).dates[0]?.due).toEqual(expected);
  });

  it('records the matched span and text', () => {
    const [d] = parseText('buy milk tomorrow #shop', DHAKA).dates;
    expect(d).toMatchObject({ start: 9, end: 17, text: 'tomorrow' });
  });

  it('returns every date expression in text order', () => {
    const r = parseText('dentist fri, then gym tomorrow', DHAKA);
    expect(r.dates.map((d) => d.text)).toEqual(['fri', 'tomorrow']);
  });

  it.each(['do it now', 'I may go', 'buy 2 apples', 'second thing'])('no date in %j', (text) => {
    expect(parseText(text, DHAKA).dates).toEqual([]);
  });

  it('ignores dates inside tags and URLs', () => {
    const r = parseText('#monday notes https://example.com/tomorrow', DHAKA);
    expect(r.dates).toEqual([]);
  });

  it('does not depend on the host timezone', () => {
    // vitest runs with TZ=Pacific/Chatham; results above are already host-independent,
    // this just makes the assumption explicit.
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Pacific/Chatham');
  });
});

describe('tags', () => {
  it.each<[string, string[]]>([
    ['#groceries buy milk', ['groceries']],
    ['buy milk #Groceries #urgent', ['groceries', 'urgent']],
    ['idea #side-project', ['side-project']],
    ['trailing dash #foo-', ['foo']],
    ['unicode #café', ['café']],
    ['(#inside parens)', ['inside']],
    ['not a tag: issue#12 or #12', []],
    ['url fragment https://example.com/#frag', []],
  ])('%j → %j', (text, expected) => {
    expect(parseText(text, DHAKA).tags.map((t) => t.value)).toEqual(expected);
  });

  it('spans cover the # and the name', () => {
    expect(parseText('a #Bc', DHAKA).tags[0]).toMatchObject({ start: 2, end: 5 });
  });
});

describe('priority', () => {
  it.each<[string, number | undefined]>([
    ['! fix bug', 1],
    ['fix bug !!', 2],
    ['fix !!! bug', 3],
    ['wow!', undefined],
    ['fix bug !!!!', undefined],
    ['first ! then !!', 1],
  ])('%j → %s', (text, expected) => {
    expect(parseText(text, DHAKA).priority?.value).toBe(expected);
  });
});

describe('urls', () => {
  it.each<[string, string | undefined]>([
    ['https://example.com/article', 'https://example.com/article'],
    ['see https://example.com/a.', 'https://example.com/a'],
    ['(see https://example.com/a)', 'https://example.com/a'],
    ['https://en.wikipedia.org/wiki/Foo_(bar)', 'https://en.wikipedia.org/wiki/Foo_(bar)'],
    ['no link here', undefined],
  ])('%j → %s', (text, expected) => {
    expect(parseText(text, DHAKA).url?.value).toBe(expected);
  });
});
