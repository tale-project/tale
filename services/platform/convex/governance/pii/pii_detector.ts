import { execWithBudget } from '../regex_safety';
import type { PiiPattern } from './pii_patterns';

export interface PiiMatch {
  patternName: string;
  start: number;
  end: number;
  matchedText: string;
  replacement: string;
}

export function detectPii(text: string, patterns: PiiPattern[]): PiiMatch[] {
  const matches: PiiMatch[] = [];

  for (const pattern of patterns) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    const budgeted = execWithBudget(regex, text);
    for (const m of budgeted) {
      matches.push({
        patternName: pattern.name,
        start: m.index,
        end: m.index + m.length,
        matchedText: m.matchedText,
        replacement: pattern.replacement,
      });
    }
  }

  // Merge overlapping matches so the masker (which splices using original
  // indices into a mutating string) never sees two ranges sharing a span.
  // Without this, e.g. `phone` matching a 14-char prefix of a 19-char
  // creditCard match leaves both in the list, the second splice's `match.end`
  // points past where the string has shifted, and adjacent text — sometimes
  // the next replacement token entirely — gets eaten. Policy: longest match
  // wins; on equal length, earlier insertion (i.e. earlier pattern in
  // BUILT_IN_PII_PATTERNS) wins.
  matches.sort(
    (a, b) => a.start - b.start || b.end - b.start - (a.end - a.start),
  );
  const kept: PiiMatch[] = [];
  for (const m of matches) {
    const last = kept[kept.length - 1];
    if (!last || m.start >= last.end) {
      kept.push(m);
    } else if (m.end - m.start > last.end - last.start) {
      kept[kept.length - 1] = m;
    }
  }
  return kept;
}
