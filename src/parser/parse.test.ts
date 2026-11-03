import { describe, expect, it } from 'vitest';
import type { Due, ParseRef } from '../model/item';
import { parseText } from './parse';

const utc = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);

// Tuesday 2026-11-03, 10:00 in Dhaka (+06:00).
const DHAKA: ParseRef = { at: utc(2026, 11, 3, 4), tz: 'Asia/Dhaka' };

const date = (d: string): Due => ({ type: 'date', date: d });
const instant = (at: number, tz: string): Due => ({ type: 'instant', at, zone: { type: 'iana', tz } });
const fixed = (at: number, minutes: number, label: string): Due =>
  ({ type: 'instant', at, zone: { type: 'offset', minutes, label } });

describe('dates', () => {
  it.each<[string, string, ParseRef, Due]>([
    ['relative day', 'call dentist tomorrow', DHAKA, date('2026-11-04')],
    ['abbreviation', 'call dentist tmr', DHAKA, date('2026-11-04')],
    ['weekday + time', 'standup fri 5pm', DHAKA, instant(utc(2026, 11, 6, 11), 'Asia/Dhaka')],
    ['abbreviated day + time', 'tmrw 3pm dentist', DHAKA, instant(utc(2026, 11, 4, 9), 'Asia/Dhaka')],
    ['duration in days', 'renew passport in 2 weeks', DHAKA, date('2026-11-17')],
    ['month + day', 'gift for dec 3', DHAKA, date('2026-12-03')],
    ['casual time of day stays all-day', 'pack tonight', DHAKA, date('2026-11-03')],
    ['weekday + vague time of day stays all-day', 'review monday morning', DHAKA, date('2026-11-09')],
    ['US-style numeric date, already past this year', 'file taxes 3/4', DHAKA, date('2027-03-04')],
    ['US-style numeric date, later this year', 'party 12/25', DHAKA, date('2026-12-25')],
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
  ])('%s: %j', (_name, text, ref, expected) => {
    expect(parseText(text, ref).dates[0]?.due).toEqual(expected);
  });

  describe('explicit zones keep the zone that was typed, not the local one', () => {
    it.each<[string, string, ParseRef, Due]>([
      // Typed in Dhaka (+6); 5pm EST on Tue 3 Nov = 22:00Z.
      ['fixed abbreviation', 'call at 5pm EST', DHAKA, fixed(utc(2026, 11, 3, 22), -300, 'EST')],
      ['lowercase abbreviation', 'call at 5pm est', DHAKA, fixed(utc(2026, 11, 3, 22), -300, 'EST')],
      ['UTC', 'deploy 17:00 UTC', DHAKA, fixed(utc(2026, 11, 3, 17), 0, 'UTC')],
      ['numeric offset', 'call 5pm GMT+3', DHAKA, fixed(utc(2026, 11, 3, 14), 180, 'GMT+3')],
      // "tomorrow" is relative to the user's own day (Wed 4 Nov in Dhaka).
      ['with a relative day', 'tomorrow 9am PST', DHAKA, fixed(utc(2026, 11, 4, 17), -480, 'PST')],
      // chrono tags these "relativeDate"; they must not be mistaken for durations.
      ['with a day-level duration', 'in 2 days at 9am PST', DHAKA, fixed(utc(2026, 11, 5, 17), -480, 'PST')],
      ['with "next week"', 'next week 5pm EST', DHAKA, fixed(utc(2026, 11, 10, 22), -300, 'EST')],
      // EST is a fixed -5 even in July, because that's what was typed.
      [
        'fixed abbreviation in summer stays fixed',
        'call 5pm EST',
        { at: utc(2026, 7, 1, 4), tz: 'Asia/Dhaka' },
        fixed(utc(2026, 7, 1, 22), -300, 'EST'),
      ],
      // "ET" follows New York's DST: noon ET in July is EDT (-4) = 16:00Z.
      [
        'generic US label follows DST',
        'standup noon ET',
        { at: utc(2026, 7, 1, 4), tz: 'Asia/Dhaka' },
        instant(utc(2026, 7, 1, 16), 'America/New_York'),
      ],
      [
        'generic US label in winter',
        'standup noon ET',
        DHAKA,
        instant(utc(2026, 11, 3, 17), 'America/New_York'),
      ],
    ])('%s: %j', (_name, text, ref, expected) => {
      expect(parseText(text, ref).dates[0]?.due).toEqual(expected);
    });
  });

  describe('DST: durations are elapsed time, wall-clock times follow the target date', () => {
    const NY = 'America/New_York';
    it.each<[string, string, ParseRef, Due]>([
      // Fall back, Sun 1 Nov 2026 02:00 EDT → 01:00 EST.
      // 00:30 EDT (04:30Z) + 3h elapsed = 07:30Z (02:30 EST), not 03:30 wall time.
      ['duration across fall-back', 'in 3 hours', { at: utc(2026, 11, 1, 4, 30), tz: NY }, instant(utc(2026, 11, 1, 7, 30), NY)],
      // Spring forward, Sun 8 Mar 2026 02:00 EST → 03:00 EDT.
      // 00:30 EST (05:30Z) + 3h elapsed = 08:30Z (04:30 EDT).
      ['duration across spring-forward', 'in 3 hours', { at: utc(2026, 3, 8, 5, 30), tz: NY }, instant(utc(2026, 3, 8, 8, 30), NY)],
      // Captured Sat 31 Oct 12:00 EDT; Sunday 9am is EST (-5) = 14:00Z.
      ['wall clock across fall-back', 'tomorrow 9am', { at: utc(2026, 10, 31, 16), tz: NY }, instant(utc(2026, 11, 1, 14), NY)],
      // Captured Sat 7 Mar 12:00 EST; Sunday 9am is EDT (-4) = 13:00Z.
      ['wall clock across spring-forward', 'tomorrow 9am', { at: utc(2026, 3, 7, 17), tz: NY }, instant(utc(2026, 3, 8, 13), NY)],
      // A day-level duration with a clock time is wall time, not elapsed time.
      // Captured Fri 30 Oct 12:00 EDT; Sunday 9am is EST = 14:00Z (elapsed-time
      // arithmetic would wrongly give 13:00Z).
      ['day-level duration + time is wall clock', 'in 2 days at 9am', { at: utc(2026, 10, 30, 16), tz: NY }, instant(utc(2026, 11, 1, 14), NY)],
      ['"from now" duration is elapsed', '2 hours from now', { at: utc(2026, 11, 1, 4, 30), tz: NY }, instant(utc(2026, 11, 1, 6, 30), NY)],
      ['"an hour" duration is elapsed', 'in an hour', { at: utc(2026, 11, 1, 4, 30), tz: NY }, instant(utc(2026, 11, 1, 5, 30), NY)],
    ])('%s: %j', (_name, text, ref, expected) => {
      expect(parseText(text, ref).dates[0]?.due).toEqual(expected);
    });
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
