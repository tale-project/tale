import { scaffoldOrgFromCatalog } from '../../../convex/organizations/scaffold.ts';

/**
 * Org config-tree scaffolding — the worker-job face of the 0.4 scaffolder.
 * The heavy lifting (`scaffoldOrgFromCatalog`: catalog resolution, per-domain
 * copy semantics, janitor sweep, org-subtree purge) is REUSED from the 0.4
 * module unchanged; only the Convex action wrapper dies. Enqueued as the
 * `org.scaffold` pg-boss job from `afterCreateOrganization` — per-domain
 * copies are idempotent, so at-least-once delivery is safe and a retry heals
 * a partial seed.
 */
export async function scaffoldNewOrganization(args: {
  orgSlug: string;
  cleanFirst?: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const result = await scaffoldOrgFromCatalog({
    orgSlug: args.orgSlug,
    ...(args.cleanFirst !== undefined ? { cleanFirst: args.cleanFirst } : {}),
  });
  if (result.ok) {
    return { ok: true };
  }
  if (result.skipped) {
    // Invalid slug or unset config/catalog roots: retrying cannot succeed
    // until the deployment is fixed; pg-boss's capped retries surface it.
    return {
      ok: false,
      error: 'scaffold skipped (misconfigured or invalid slug)',
    };
  }
  const failed = result.results.filter((r) => !r.ok);
  return {
    ok: false,
    error: failed
      .map((r) => `${r.domain}: ${r.error ?? 'unknown error'}`)
      .join('; '),
  };
}
