/**
 * Pure function that applies search/replace patches to a string.
 *
 * Each patch must match its `search` block exactly once in the current
 * content — zero matches and multiple matches both fail. Patches apply
 * sequentially: patch N+1 operates on the output of patch N.
 *
 * Used both authoritatively (when `artifact_edit` finishes its tool call)
 * and optimistically (per-patch during streaming, before the tool's
 * `execute` returns). Keeping the function pure makes the second pass safe.
 */

export interface ArtifactPatch {
  search: string;
  replace: string;
}

export type ApplyPatchesResult =
  | { ok: true; content: string }
  | { ok: false; error: string; failedIndex: number };

export function applyPatches(
  content: string,
  patches: readonly ArtifactPatch[],
): ApplyPatchesResult {
  let current = content;
  for (let i = 0; i < patches.length; i += 1) {
    const result = applySinglePatch(current, patches[i]);
    if (!result.ok) {
      return { ok: false, error: result.error, failedIndex: i };
    }
    current = result.content;
  }
  return { ok: true, content: current };
}

export function applySinglePatch(
  content: string,
  patch: ArtifactPatch,
): { ok: true; content: string } | { ok: false; error: string } {
  if (patch.search.length === 0) {
    return {
      ok: false,
      error:
        'search block is empty — refusing to apply (would match anywhere). Provide a non-empty unique snippet.',
    };
  }

  const firstIndex = content.indexOf(patch.search);
  if (firstIndex === -1) {
    return {
      ok: false,
      error: `search block matched 0 times. Either the artifact has changed or the snippet is wrong. Re-read the artifact and emit a snippet that appears verbatim.`,
    };
  }

  // Probe at firstIndex + 1 (not + search.length) so a self-overlapping
  // search string like "aa" inside "aaa" is correctly flagged as ambiguous
  // — the second match starts at index 1, which the wider stride misses.
  const secondIndex = content.indexOf(patch.search, firstIndex + 1);
  if (secondIndex !== -1) {
    return {
      ok: false,
      error: `search block matched more than once. Add surrounding context until the snippet is unique.`,
    };
  }

  const before = content.slice(0, firstIndex);
  const after = content.slice(firstIndex + patch.search.length);
  return { ok: true, content: before + patch.replace + after };
}
