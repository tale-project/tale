/**
 * 0.2.96 / 02 — give a `scope: 'project'` app's reconcile SCHEDULE a project.
 *
 * Per-project config means one schedule per bound project; existing installs
 * have a single org-level schedule (`projectId` unset). This assigns each
 * org-level, app-owned schedule to its app's binding so `setAutomationConfig(projectId)`
 * can sync it and lifecycle (create-on-bind / delete-on-unbind) is keyed right.
 * Idempotent — skips a schedule that already has a `projectId`. `down` unsets
 * `projectId` on app-owned schedules.
 *
 * Non-destructive: only sets the new optional `projectId`, never deletes a row.
 * For the rare case of an app bound to several projects, the schedule is assigned
 * to the FIRST binding; the reconcile run itself updates tasks across projects by
 * their external ref, and a per-project schedule for the others materializes on
 * the next (re)bind via `syncAutomationSchedules`.
 */

import type { Id } from '../../../../_generated/dataModel';
import type { MutationCtx } from '../../../../_generated/server';
import { defineDbMigration } from '../../../framework/define';

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
  const row = await (ctx.db as any)
    .query('appInstallations')
    .withIndex('by_org_slug', (q: any) =>
      q.eq('organizationId', organizationId).eq('appSlug', appSlug),
    )
    .first();
  return row !== null;
}

export const migration = defineDbMigration({
  title: 'Assign org-level app schedules to their project binding',
  description:
    'Sets wfSchedules.projectId on each org-level schedule owned by a ' +
    "scope:project app to that app's (first) project binding, so per-project " +
    'config syncs to it. Idempotent — skips a schedule that already has a ' +
    'projectId. Non-destructive. down unsets projectId on app-owned schedules.',
  destructive: false,
  snapshot: 'none',
  formerIds: ['0.2.88/02_app_schedules_per_project'],
  subjects: {
    tables: ['wfSchedules', 'appInstallations', 'appProjectBindings'],
  },
  table: 'wfSchedules',

  async up(ctx, doc) {
    if (doc.projectId !== undefined) return; // already per-project
    const organizationId = str(doc.organizationId);
    const appSlug = appSlugOf(str(doc.workflowSlug));
    if (!organizationId || !appSlug) return;
    if (!(await appInstalled(ctx, organizationId, appSlug))) return;
    const binding = await (ctx.db as any)
      .query('appProjectBindings')
      .withIndex('by_org_slug_project', (q: any) =>
        q.eq('organizationId', organizationId).eq('appSlug', appSlug),
      )
      .first();
    if (!binding) return; // org-scoped app or unbound — leave org-level
    await ctx.db.patch(doc._id as Id<'wfSchedules'>, {
      projectId: binding.projectId,
    });
  },

  async down(ctx, doc) {
    if (doc.projectId === undefined) return;
    const organizationId = str(doc.organizationId);
    const appSlug = appSlugOf(str(doc.workflowSlug));
    if (!organizationId || !appSlug) return;
    if (!(await appInstalled(ctx, organizationId, appSlug))) return;
    await ctx.db.patch(doc._id as Id<'wfSchedules'>, { projectId: undefined });
  },
});
