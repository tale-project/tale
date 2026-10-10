/**
 * THE YAML rendering of an automation document: the text the editor's
 * Source view shows and downloads, the two sides of a version's YAML
 * compare, and what a unified patch between two versions is written over —
 * one rendering, so a line number means the same line on every surface.
 *
 * The document as an author or a coding agent writes it: every key in the
 * order it is stored, `ui` and `tests` included; multi-line code and prompts
 * as literal blocks; no line ever folded; a value the document repeats
 * written out each time, never as an anchor and alias it did not hold. The
 * same document always gives the same text, and the text parses back to the
 * document.
 */

import { stringifyYaml } from '../../shared/config/yaml';
import type { Automation } from '../core/types';

/** The document as YAML text. */
export function documentYaml(
  document: Automation | Readonly<Record<string, unknown>>,
): string {
  return stringifyYaml(document, { lineWidth: 0, literalBlocks: true });
}
