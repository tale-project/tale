import type { MutationCtx, QueryCtx } from '../_generated/server';

/**
 * The workflow slugs an installed automation owns in this org, read from the
 * AUTHORITATIVE `wfInstallations` ownership ledger — every automation workflow's row is
 * stamped with `automationSlug` at install (see `automations/install_actions.ts registerWorkflow`
 * and `workflows/schema.ts`).
 *
 * This is the correct source for "which of the automation's schedules to touch". The
 * `automationInstallations.resources` ledger must NOT be used: it records only the
 * FAN-OUT domains (currently just `integrations`, see `automations/install_fs.ts`
 * FANOUT_DOMAINS); workflows/agents copy under the automation dir as shell and never
 * appear there. Deriving workflow slugs from `resources` therefore always yields
 * an empty list, which silently skips every schedule (the automation's per-install
 * config never reaches its scheduled workflows' `variables`).
 */
export async function automationWorkflowSlugs(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
  automationSlug: string,
): Promise<string[]> {
  const slugs: string[] = [];
  for await (const row of ctx.db
    .query('wfInstallations')
    .withIndex('by_org', (q) => q.eq('organizationId', organizationId))) {
    if (row.automationSlug === automationSlug) slugs.push(row.workflowSlug);
  }
  return slugs;
}
