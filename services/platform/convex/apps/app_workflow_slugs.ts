import type { MutationCtx, QueryCtx } from '../_generated/server';

/**
 * The workflow slugs an installed app owns in this org, read from the
 * AUTHORITATIVE `wfInstallations` ownership ledger — every app workflow's row is
 * stamped with `appSlug` at install (see `apps/install_actions.ts registerWorkflow`
 * and `workflows/schema.ts`).
 *
 * This is the correct source for "which of the app's schedules to touch". The
 * `appInstallations.resources` ledger must NOT be used: it records only the
 * FAN-OUT domains (currently just `integrations`, see `apps/install_fs.ts`
 * FANOUT_DOMAINS); workflows/agents copy under the app dir as shell and never
 * appear there. Deriving workflow slugs from `resources` therefore always yields
 * an empty list, which silently skips every schedule (the app's per-install
 * config never reaches its scheduled workflows' `variables`).
 */
export async function appWorkflowSlugs(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
  appSlug: string,
): Promise<string[]> {
  const slugs: string[] = [];
  for await (const row of ctx.db
    .query('wfInstallations')
    .withIndex('by_org', (q) => q.eq('organizationId', organizationId))) {
    if (row.appSlug === appSlug) slugs.push(row.workflowSlug);
  }
  return slugs;
}
