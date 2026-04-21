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

  matches.sort((a, b) => a.start - b.start);
  return matches;
}
