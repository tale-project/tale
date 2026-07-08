import { v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import { query } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';

/**
 * Reactive install state for every automation installed in the org — powers the hub's
 * Install/Installed/Reinstall badges and the per-automation readiness checklist. Kept
 * DB-only (no manifest/FS read) so it stays a live query: the automation's required
 * integrations are denormalized onto the install row, and "connected" is read
 * straight off `integrationCredentials`. The missing-file integrity check
 * (which needs the filesystem) lives in the `verifyAutomationIntegrity` action, whose
 * result is reflected here via the row's `status`.
 *
 * State here is strictly ORG-LEVEL — one entry per installed automation. A project-scoped
 * automation's project memberships live in `automationProjectBindings` (see `listAutomationBindings`
 * for the hub, `listProjectAutomations` for a project's nav strip).
 */
export const getAutomationInstallState = query({
  args: { organizationId: v.string() },
  returns: v.array(
    v.object({
      automationSlug: v.string(),
      status: v.union(v.literal('active'), v.literal('broken')),
      installedAt: v.number(),
      /** Required integrations that are NOT yet connected (setup steps). */
      blockedIntegrations: v.array(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return [];
    await getOrganizationMember(ctx, args.organizationId, authUser);

    const isConnected = async (slug: string): Promise<boolean> => {
      const cred = await ctx.db
        .query('integrationCredentials')
        .withIndex('by_organizationId_and_slug', (q) =>
          q.eq('organizationId', args.organizationId).eq('slug', slug),
        )
        .first();
      return cred !== null && cred.isActive && cred.status === 'active';
    };

    const out: Array<{
      automationSlug: string;
      status: 'active' | 'broken';
      installedAt: number;
      blockedIntegrations: string[];
    }> = [];
    for await (const row of ctx.db
      .query('automationInstallations')
      .withIndex('by_org', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      const blocked: string[] = [];
      for (const slug of row.requiredIntegrations) {
        if (!(await isConnected(slug))) blocked.push(slug);
      }
      out.push({
        automationSlug: row.automationSlug,
        status: row.status,
        installedAt: row.installedAt,
        blockedIntegrations: blocked,
      });
    }
    return out;
  },
});

/**
 * The automations bound to a given project — drives the in-project nav entry for each
 * project-scoped automation installed into it. Cheap + reactive (no FS): each binding
 * reads its automation's display name + status THROUGH to the org install row, so those
 * fields can never drift per-binding.
 */
export const listProjectAutomations = query({
  args: { projectId: v.id('projects') },
  returns: v.array(
    v.object({
      automationSlug: v.string(),
      automationName: v.string(),
      status: v.union(v.literal('active'), v.literal('broken')),
    }),
  ),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return [];
    const project = await ctx.db.get(args.projectId);
    if (!project) return [];
    // Project-inherited access: a member who can read the project can see its automations.
    await getOrganizationMember(ctx, project.organizationId, authUser);

    const out: Array<{
      automationSlug: string;
      automationName: string;
      status: 'active' | 'broken';
    }> = [];
    for await (const binding of ctx.db
      .query('automationProjectBindings')
      .withIndex('by_project', (q) => q.eq('projectId', args.projectId))) {
      const org = await ctx.db
        .query('automationInstallations')
        .withIndex('by_org_slug', (q) =>
          q
            .eq('organizationId', binding.organizationId)
            .eq('automationSlug', binding.automationSlug),
        )
        .first();
      // A binding without its org row shouldn't happen (I7); skip defensively.
      if (!org) continue;
      out.push({
        automationSlug: binding.automationSlug,
        automationName: org.automationName ?? binding.automationSlug,
        status: org.status,
      });
    }
    return out;
  },
});

/**
 * The projects a (project-scoped) automation is bound to — feeds the org-level automation
 * page's membership hub (the list of bound projects + per-project Remove). Names
 * are read live so a renamed project shows its current name.
 */
export const listAutomationBindings = query({
  args: { organizationId: v.string(), automationSlug: v.string() },
  returns: v.array(
    v.object({
      projectId: v.id('projects'),
      projectName: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return [];
    await getOrganizationMember(ctx, args.organizationId, authUser);

    const out: Array<{ projectId: Id<'projects'>; projectName: string }> = [];
    for await (const binding of ctx.db
      .query('automationProjectBindings')
      .withIndex('by_org_slug_project', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('automationSlug', args.automationSlug),
      )) {
      const project = await ctx.db.get(binding.projectId);
      // Skip a binding whose project was deleted (the project-delete guard
      // blocks this) so the hub never lists a ghost project.
      if (!project) continue;
      out.push({ projectId: binding.projectId, projectName: project.name });
    }
    return out;
  },
});
