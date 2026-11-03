// Tracks where a range of the old text ended up after an edit, so an
// untouched date expression keeps its original resolution (DECISIONS #7).

import type { Range } from './parse';

/** Above this many changed characters per side we skip the diff and treat the range as edited. */
const MAX_DIFF = 2000;

/**
 * Where `range` of `oldText` lives in `newText`, if every character in it
 * survived the edit unchanged and still sits together. Otherwise null.
 */
export function trackRange(oldText: string, newText: string, range: Range): Range | null {
  if (oldText === newText) return range;

  let prefix = 0;
  const maxPrefix = Math.min(oldText.length, newText.length);
  while (prefix < maxPrefix && oldText[prefix] === newText[prefix]) prefix++;
  let suffix = 0;
  const maxSuffix = maxPrefix - prefix;
  while (
    suffix < maxSuffix &&
    oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]
  ) {
    suffix++;
  }

  if (range.end <= prefix) return range;
  const shift = newText.length - oldText.length;
  if (range.start >= oldText.length - suffix) {
    return { start: range.start + shift, end: range.end + shift };
  }

  // The range touches the changed middle. Diff the middles to see whether its
  // characters were kept (e.g. typos fixed on both sides of it in one edit).
  const a = oldText.slice(prefix, oldText.length - suffix);
  const b = newText.slice(prefix, newText.length - suffix);
  if (a.length > MAX_DIFF || b.length > MAX_DIFF) return null;
  const map = lcsMap(a, b);

  let start = -1;
  for (let i = range.start; i < range.end; i++) {
    let j: number;
    if (i < prefix) j = i;
    else if (i >= oldText.length - suffix) j = i + shift;
    else {
      const m = map[i - prefix]!;
      if (m < 0) return null;
      j = m + prefix;
    }
    if (start < 0) start = j;
    else if (j !== start + (i - range.start)) return null;
  }
  return { start, end: start + (range.end - range.start) };
}

/** For each index of `a`, its matched index in `b` under one LCS, or -1. */
function lcsMap(a: string, b: string): Int32Array {
  const n = a.length;
  const m = b.length;
  const w = m + 1;
  const dp = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] =
        a[i] === b[j]
          ? dp[(i + 1) * w + j + 1]! + 1
          : Math.max(dp[(i + 1) * w + j]!, dp[i * w + j + 1]!);
    }
  }
  const map = new Int32Array(n).fill(-1);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      map[i] = j;
      i++;
      j++;
    } else if (dp[(i + 1) * w + j]! >= dp[i * w + j + 1]!) i++;
    else j++;
  }
  return map;
}
