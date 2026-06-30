/**
 * DB migration over `wfSchedules`: assign each org-level schedule owned by a
 * `scope: 'project'` app to that app's (first) project binding, so per-project
 * config can sync into it. Both `up` and `down` are idempotent; non-destructive
 * (only sets/clears the optional `projectId`).
 */

import type { Id } from '../../../../_generated/dataModel';
import type { MutationCtx } from '../../../../_generated/server';
import type { DbMigration, MigrationDoc } from '../../../framework/types';
import { meta } from './meta';

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Owning app slug of a workflow slug `<app>/<name>`, else undefined. */
function appSlugOf(workflowSlug: string | undefined): string | undefined {
  if (!workflowSlug) return undefined;
  const slash = workflowSlug.indexOf('/');
  return slash > 0 ? workflowSlug.slice(0, slash) : undefined;
}

async function appInstalled(
  ctx: MutationCtx,
  organizationId: string,
  appSlug: string,
): Promise<boolean> {
  const row = await ctx.db
    .query('appInstallations')
    .withIndex('by_org_slug', (q) =>
      q.eq('organizationId', organizationId).eq('appSlug', appSlug),
    )
    .first();
  return row !== null;
}

export const migration: DbMigration = {
  meta,
  table: 'wfSchedules',

  async up(ctx: MutationCtx, doc: MigrationDoc) {
    if (doc.projectId !== undefined) return; // already per-project
    const organizationId = str(doc.organizationId);
    const appSlug = appSlugOf(str(doc.workflowSlug));
    if (!organizationId || !appSlug) return;
    if (!(await appInstalled(ctx, organizationId, appSlug))) return;
    const binding = await ctx.db
      .query('appProjectBindings')
      .withIndex('by_org_slug_project', (q) =>
        q.eq('organizationId', organizationId).eq('appSlug', appSlug),
      )
      .first();
    if (!binding) return; // org-scoped app or unbound — leave org-level
    await ctx.db.patch(doc._id as Id<'wfSchedules'>, {
      projectId: binding.projectId,
    });
  },

  async down(ctx: MutationCtx, doc: MigrationDoc) {
    if (doc.projectId === undefined) return;
    const organizationId = str(doc.organizationId);
    const appSlug = appSlugOf(str(doc.workflowSlug));
    if (!organizationId || !appSlug) return;
    if (!(await appInstalled(ctx, organizationId, appSlug))) return;
    await ctx.db.patch(doc._id as Id<'wfSchedules'>, { projectId: undefined });
  },
};
