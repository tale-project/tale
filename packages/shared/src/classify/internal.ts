/**
 * Helpers shared across the per-source classifiers. node-free.
 */

import { stripAnsi } from '../terminal/ansi';

/** Health-check access logs are pure noise; pattern lifted from the old terminal.ts. */
export const HEALTH_CHECK = /"GET \/health[^"]*"\s+200/;

/** `  svc-1  | the actual line` → `the actual line` (compose aggregates with a prefix). */
function stripComposePrefix(line: string): string {
  const m = line.match(/^\s*\S+?-\d+\s*\|\s?(.*)$/);
  return m ? m[1] : line;
}

/** Strip ANSI then the compose service prefix — the common pre-clean for docker streams. */
export function cleanComposeLine(line: string): string {
  return stripComposePrefix(stripAnsi(line));
}

// The platform container's status emoji (❌ U+274C, ⚠ U+26A0 +VS16, ✅ U+2705,
// 🎉 U+1F389) and a few common log emoji. The reporter's bracketed marker already
// conveys severity and emoji render inconsistently across terminals, so they are
// stripped from surfaced text — NEVER re-emitted.
const STATUS_EMOJI =
  /[❌⚠✅\u{1f389}\u{1f680}\u{1f527}\u{1f4cb}\u{1f5d1}\u{2728}]️?/gu;

/** Remove status emoji and collapse the whitespace they leave behind. */
export function stripStatusEmoji(line: string): string {
  return line
    .replace(STATUS_EMOJI, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
