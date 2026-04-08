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

    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      matches.push({
        patternName: pattern.name,
        start: match.index,
        end: match.index + match[0].length,
        matchedText: match[0],
        replacement: pattern.replacement,
      });
    }
  }

  matches.sort((a, b) => a.start - b.start);
  return matches;
}
