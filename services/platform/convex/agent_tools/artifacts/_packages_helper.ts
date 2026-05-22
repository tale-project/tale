/**
 * Shared helper used by the `artifact_file_create` / `artifact_file_update` tools to union
 * `packages_add` into an artifact's persistent `runPackages` list as a
 * best-effort side-effect.
 *
 * Best-effort: a failure to update packages is logged but does not flip the
 * caller's success status. Returns a human-readable suffix the caller can
 * append to its success message (empty string when no-op).
 */

import type { ToolCtx } from '@convex-dev/agent';

import { internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';

export async function applyPackagesAddIfAny(
  ctx: ToolCtx,
  artifactId: Id<'artifacts'>,
  isRunnable: boolean,
  packagesAdd: readonly string[] | undefined,
): Promise<string> {
  if (!isRunnable) return '';
  if (packagesAdd === undefined || packagesAdd.length === 0) return '';
  try {
    const result = await ctx.runMutation(
      internal.artifacts.internal_mutations.addArtifactPackages,
      { artifactId, packagesAdd: [...packagesAdd] },
    );
    if (result.added.length === 0) return '';
    return ` Added ${result.added.length} package${result.added.length === 1 ? '' : 's'} to runPackages: ${result.added.join(', ')}.`;
  } catch (err) {
    console.warn('[packages_add] addArtifactPackages failed:', err);
    return '';
  }
}

/**
 * Checks whether the `path` field's string literal has fully closed in the
 * raw JSON accumulator. `parsePartialJson` will happily auto-close an
 * in-flight string (e.g. `"path":"c` gets repaired to `"path":"c"`), but
 * that means every intermediate state of the LLM typing the filename
 * would otherwise be committed as `streamingPath` — producing visible
 * filename flicker in the canvas FILES panel.
 *
 * We require the value's closing `"` to physically exist in the accumulator
 * before treating the path as stable. Once stable it cannot regress in this
 * stream (JSON values are written linearly), so this is a one-way gate.
 */
export function isPathFieldClosed(accumulator: string): boolean {
  const keyMatch = /"path"\s*:\s*"/.exec(accumulator);
  if (!keyMatch) return false;
  let i = keyMatch.index + keyMatch[0].length;
  while (i < accumulator.length) {
    const ch = accumulator[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '"') return true;
    i += 1;
  }
  return false;
}
