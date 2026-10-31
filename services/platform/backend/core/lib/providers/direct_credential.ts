/**
 * The one predicate for "this credential can serve a direct model call":
 * active, and an `api-key` or `env` credential. Both subscription flavors are
 * bound to a vendor harness, so they never qualify (`model_call.ts` refuses
 * them with the full explanation; callers here just skip them).
 *
 * The internal credential query returns `v.any()`, so the shape is narrowed
 * here rather than trusted. `endpointUrl` is the credential's own endpoint
 * (an Azure resource, a per-credential connector), which a direct call goes
 * to instead of the provider's base URL.
 */
export function directActiveCredential(
  row: unknown,
): { modelAllowlist?: readonly string[]; endpointUrl?: string } | null {
  if (row === null || typeof row !== 'object') return null;
  if (!('status' in row) || row.status !== 'active') return null;
  if (
    !('authMethod' in row) ||
    (row.authMethod !== 'api-key' && row.authMethod !== 'env')
  ) {
    return null;
  }
  const allowlist = 'modelAllowlist' in row ? row.modelAllowlist : undefined;
  const endpointUrl = 'endpointUrl' in row ? row.endpointUrl : undefined;
  return {
    ...(Array.isArray(allowlist) &&
    allowlist.every((id) => typeof id === 'string')
      ? { modelAllowlist: allowlist }
      : {}),
    ...(typeof endpointUrl === 'string' && endpointUrl !== ''
      ? { endpointUrl }
      : {}),
  };
}
