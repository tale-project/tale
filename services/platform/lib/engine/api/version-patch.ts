/**
 * A unified patch between two texts — two versions' YAML (`documentYaml`) —
 * as MCP's `diff_versions` and the REST compare answer it in their
 * `unified` format.
 *
 * The patch is jsdiff's `createTwoFilesPatch` with file headers only, the
 * shape `git diff` and `patch` read: `--- v4` and `+++ v5`, then each hunk
 * with `context` unchanged lines around its changes. Two equal texts have no
 * patch (`''`). A patch longer than `maxBytes` (UTF-8) stops at the last
 * whole line that fits and says it was cut; such a patch shows what changed
 * but no longer applies.
 */

import { createTwoFilesPatch, FILE_HEADERS_ONLY } from 'diff';

export interface UnifiedPatchOptions {
  /** The name each side goes by in the headers: `v4`, `v5`. */
  fromLabel: string;
  toLabel: string;
  /** Unchanged lines kept around each change: 3. */
  context?: number;
  /** The longest patch answered, in UTF-8 bytes: 262 144. */
  maxBytes?: number;
}

export interface UnifiedPatch {
  patch: string;
  truncated: boolean;
}

/** The longest patch answered by default, in UTF-8 bytes. */
export const MAX_PATCH_BYTES = 262_144;

/** The longest prefix of `text` made of whole lines that fits `maxBytes`. */
function wholeLinesWithin(text: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  let kept = 0;
  let bytes = 0;
  for (let start = 0; start < text.length;) {
    const newline = text.indexOf('\n', start);
    const end = newline === -1 ? text.length : newline + 1;
    const size = encoder.encode(text.slice(start, end)).length;
    if (bytes + size > maxBytes) break;
    bytes += size;
    kept = end;
    start = end;
  }
  return text.slice(0, kept);
}

/** The unified patch that turns `before` into `after`. */
export function unifiedPatch(
  before: string,
  after: string,
  options: UnifiedPatchOptions,
): UnifiedPatch {
  if (before === after) return { patch: '', truncated: false };
  const patch = createTwoFilesPatch(
    options.fromLabel,
    options.toLabel,
    before,
    after,
    undefined,
    undefined,
    { context: options.context ?? 3, headerOptions: FILE_HEADERS_ONLY },
  );
  const maxBytes = options.maxBytes ?? MAX_PATCH_BYTES;
  if (new TextEncoder().encode(patch).length <= maxBytes) {
    return { patch, truncated: false };
  }
  return { patch: wholeLinesWithin(patch, maxBytes), truncated: true };
}
