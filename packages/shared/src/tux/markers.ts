/**
 * Maps a semantic marker kind to its styled (colored + glyph) form. Shared by
 * the line emitters and the step terminals so the `[ ✓ ]`/`[ ! ]`/`[ x ]`
 * vocabulary is defined in exactly one place.
 *
 * node-free-ish (pure; takes the palette/markers as args).
 */

import type { Markers, Palette } from '../terminal/index';

export type MarkerKind = 'done' | 'info' | 'warn' | 'error' | 'question';

/** The colored marker glyph for a kind, e.g. `\x1b[32m[ ✓ ]\x1b[0m`. */
export function styledMarker(
  kind: MarkerKind,
  palette: Palette,
  markers: Markers,
): string {
  const styled: Record<MarkerKind, string> = {
    done: `${palette.green}${markers.done}${palette.reset}`,
    info: `${palette.dim}${markers.info}${palette.reset}`,
    warn: `${palette.yellow}${markers.warn}${palette.reset}`,
    error: `${palette.red}${markers.error}${palette.reset}`,
    question: `${palette.cyan}${markers.question}${palette.reset}`,
  };
  return styled[kind];
}
