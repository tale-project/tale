import type { Sql } from 'postgres';

import { withConfigWriteLock } from '../../core/lib/config_store/write_lock.ts';
import {
  clearOrgConfigLeftovers,
  scaffoldOrgFromCatalog,
} from '../../core/organizations/scaffold.ts';
import type { TaskPayloads } from '../../jobs/tasks.ts';

export { clearOrgConfigLeftovers };

/**
 * The `org.scaffold` payload an organization's creation queues. The purge of
 * a leftover tree already ran at create time (`clearOrgConfigLeftovers`), so
 * the job only fills in the catalog files the org lacks: a config file a
 * client or an automation writes between the create and the job's run is
 * kept, never wiped by a late `cleanFirst`.
 */
export function orgCreateScaffoldPayload(
  orgSlug: string,
): TaskPayloads['org.scaffold'] {
  return { orgSlug, fillMissing: true };
}

/**
 * Org config-tree scaffolding — the worker-job face of the 0.4 scaffolder.
 * The heavy lifting (`scaffoldOrgFromCatalog`: catalog resolution, per-domain
 * copy semantics, janitor sweep, org-subtree purge) is REUSED from the 0.4
 * module unchanged; only the Convex action wrapper dies. Enqueued as the
 * `org.scaffold` pg-boss job from `afterCreateOrganization` — per-domain
 * copies are idempotent, so at-least-once delivery is safe and a retry heals
 * a partial seed.
 *
 * The run holds the org's whole-subtree write lock. Idempotent per domain is
 * not the same as safe to run twice at once: `cleanFirst` renames the subtree
 * out from under a concurrent seed, and a reseed racing itself across two
 * workers copies into a directory the other is replacing.
 */
export async function scaffoldNewOrganization(args: {
  sql: Sql;
  orgSlug: string;
  cleanFirst?: boolean;
  /** Seed only the catalog files the org lacks, keeping every file already
   *  there — the org-create job ({@link orgCreateScaffoldPayload}). */
  fillMissing?: boolean;
  /** Reseed: overwrite each domain's files from the builtin catalog instead
   *  of skipping a directory that already has content. `tale deploy
   *  --override-all` only. */
  override?: boolean;
  /** Raise instead of returning a skip when the deployment is misconfigured —
   *  an operator running a factory reseed must not get a silent no-op. */
  strict?: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const result = await withConfigWriteLock(args.sql, args.orgSlug, 'org', () =>
    scaffoldOrgFromCatalog({
      orgSlug: args.orgSlug,
      ...(args.cleanFirst !== undefined ? { cleanFirst: args.cleanFirst } : {}),
      ...(args.fillMissing !== undefined
        ? { fillMissing: args.fillMissing }
        : {}),
      ...(args.override !== undefined ? { override: args.override } : {}),
      ...(args.strict !== undefined ? { strict: args.strict } : {}),
    }),
  );
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
