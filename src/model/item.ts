// Item schema. See docs/DECISIONS.md ("Item schema") for the rationale behind each field.

export type Provenance = 'parsed' | 'user';

/** A value inferred by the parser or set by the user. `value: null` with
 *  source 'user' means the user explicitly removed it (DECISIONS #6). */
export type Field<T> = { value: T | null; source: Provenance };

/** The moment and IANA zone relative expressions were resolved against (#7). */
export type ParseRef = { at: number; tz: string };

/** The zone a timed due date was expressed in. */
export type Zone =
  | { type: 'iana'; tz: string } // the user's zone, or a named zone like "ET"
  | { type: 'offset'; minutes: number; label: string }; // explicit fixed zone, e.g. "EST" = -300

export type Due =
  | { type: 'date'; date: string } // 'YYYY-MM-DD', floating calendar date
  | { type: 'instant'; at: number; zone: Zone }; // epoch ms + the zone it was expressed in

/** `ref` is present only on parsed values. */
export type DueField = Field<Due> & { ref?: ParseRef };

export type Kind = 'task' | 'note' | 'link';
export type Priority = 1 | 2 | 3;

export type Tag = { value: string; source: Provenance; dismissed?: boolean };

export type SpanField = 'due' | 'tag' | 'priority' | 'url';
export type Span = { start: number; end: number; field: SpanField };

export type Item = {
  id: string; // ULID
  rawText: string; // exactly as captured; never modified (#5)
  text: string; // current text; user-editable
  /** Reference for parsing `text`: capture time, then the time of the last text edit. */
  textRef: ParseRef;

  kind: Field<Kind>; // value is never null
  due?: DueField;
  priority?: Field<Priority>;
  url?: Field<string>;
  tags: Tag[]; // per-tag provenance (#6)

  /** Parser matches over `text` for values currently applied from parsing. */
  spans: Span[];
  parserVersion: number;

  status: 'open' | 'done' | 'archived';
  completedAt?: number;
  snoozedUntil?: number;

  capturedAt: number; // never changes (#9)
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
};

/** Visible tags: everything except dismissed markers. */
export function activeTags(item: Pick<Item, 'tags'>): string[] {
  return item.tags.filter((t) => !t.dismissed).map((t) => t.value);
}
