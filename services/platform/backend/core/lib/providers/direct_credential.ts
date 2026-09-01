/**
 * The one predicate for "this credential can serve a direct model call":
 * active, and an `api-key` or `env` credential. Both subscription flavors are
 * bound to a vendor harness, so they never qualify (`model_call.ts` refuses
 * them with the full explanation; callers here just skip them).
 *
 * The internal credential query returns `v.any()`, so the shape is narrowed
 * here rather than trusted.
 */
export function directActiveCredential(
  row: unknown,
): { modelAllowlist?: readonly string[] } | null {
  if (row === null || typeof row !== 'object') return null;
  if (!('status' in row) || row.status !== 'active') return null;
  if (
    !('authMethod' in row) ||
    (row.authMethod !== 'api-key' && row.authMethod !== 'env')
  ) {
    return null;
  }
  const allowlist = 'modelAllowlist' in row ? row.modelAllowlist : undefined;
  return Array.isArray(allowlist) &&
    allowlist.every((id) => typeof id === 'string')
    ? { modelAllowlist: allowlist }
    : {};
}
