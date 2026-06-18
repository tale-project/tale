/**
 * Pure, testable formatting helpers for the term core.
 *
 * node-free; no I/O, no clock — just `(value) -> string`.
 */

import { visibleWidth } from './width';

/** Human elapsed time: `0.4s`, `12s`, `1m04s`. */
export function formatElapsed(ms: number): string {
  if (ms < 0) ms = 0;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m${seconds.toString().padStart(2, '0')}s`;
}

/**
 * Right-pad `text` to `width` VISIBLE columns (wide-char- and ANSI-aware), so a
 * table column aligns even with CJK keys or colored cells. Never truncates — a
 * value already at/over `width` is returned unchanged.
 */
export function padCell(text: string, width: number): string {
  const pad = width - visibleWidth(text);
  return pad > 0 ? text + ' '.repeat(pad) : text;
}
