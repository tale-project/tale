/**
 * A unified patch between two texts — two versions' YAML (`documentYaml`) —
 * as MCP's `diff_versions` and the REST compare answer it in their
 * `unified` format.
 *
 * The patch is `@tale/ui`'s `toUnifiedPatch`, the same bytes the app's
 * "Copy patch" writes: jsdiff's `createTwoFilesPatch` with file headers
 * only, the shape `git diff` and `patch` read — `--- v4` and `+++ v5`, then
 * each hunk with `context` unchanged lines around its changes. Two equal
 * texts have no patch (`''`). Two texts more than 2 000 lines apart give
 * one hunk replacing the whole text, which bounds the work two unrelated
 * documents cost. A patch longer than `maxBytes` (UTF-8) stops at the last
 * whole line that fits and says it was cut; such a patch shows what changed
 * but no longer applies.
 */

import { toUnifiedPatch, type UnifiedPatch } from '@tale/ui/code-diff/compute';

export { MAX_PATCH_BYTES, type UnifiedPatch } from '@tale/ui/code-diff/compute';

export interface UnifiedPatchOptions {
  /** The name each side goes by in the headers: `v4`, `v5`. */
  fromLabel: string;
  toLabel: string;
  /** Unchanged lines kept around each change: 3. */
  context?: number;
  /** The longest patch answered, in UTF-8 bytes: 262 144. */
  maxBytes?: number;
}

/** The unified patch that turns `before` into `after`. */
export function unifiedPatch(
  before: string,
  after: string,
  options: UnifiedPatchOptions,
): UnifiedPatch {
  return toUnifiedPatch(before, after, {
    from: options.fromLabel,
    to: options.toLabel,
    context: options.context,
    maxBytes: options.maxBytes,
  });
}
