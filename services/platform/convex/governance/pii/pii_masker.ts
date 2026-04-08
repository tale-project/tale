import type { PiiMatch } from './pii_detector';

/**
 * Replace all detected PII matches in the text with their corresponding
 * replacement strings, processing from end to start so indices stay valid.
 */
export function maskPii(text: string, matches: PiiMatch[]): string {
  // Process replacements from end to start to preserve indices
  const sorted = [...matches].sort((a, b) => b.start - a.start);

  let result = text;
  for (const match of sorted) {
    result =
      result.slice(0, match.start) +
      match.replacement +
      result.slice(match.end);
  }

  return result;
}
