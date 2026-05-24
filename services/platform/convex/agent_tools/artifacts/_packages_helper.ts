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
 * Checks whether the given string-valued field's literal has fully closed in
 * the raw JSON accumulator. `parsePartialJson` will happily auto-close an
 * in-flight string (e.g. `"path":"c` gets repaired to `"path":"c"`), but
 * acting on those intermediate values is bad in two known cases:
 *   - `path`: every keystroke of the filename would be committed as
 *     `streamingPath`, flickering the canvas FILES panel.
 *   - `artifactId`: every partial ID is fed to a Convex query whose
 *     `v.id("artifacts")` validator rejects it, spamming WARN logs.
 *
 * We require the value's closing `"` to physically exist in the accumulator
 * before treating the field as stable. Once stable it cannot regress in this
 * stream (JSON values are written linearly), so this is a one-way gate.
 */
export function isStringFieldClosed(
  accumulator: string,
  fieldName: string,
): boolean {
  const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const keyMatch = new RegExp(`"${escaped}"\\s*:\\s*"`).exec(accumulator);
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
