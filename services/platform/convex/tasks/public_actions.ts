import { v } from 'convex/values';

import { api, internal } from '../_generated/api';
import { action } from '../_generated/server';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';

/**
 * Public, org-gated wrapper to create a task BOUND to an external issue
 * (`externalSystem`/`externalId`/`externalUrl`). The upsert that carries the
 * external ref is internal-only and needs an actor, so this thin action supplies
 * the authenticated user as the actor and defaults the destination project to
 * the org's project. Idempotent on (org, system, externalId) — picking the same
 * issue twice updates rather than duplicates. The created task is reactive, so
 * the rest of the view (the tasks Collection) reflects it live.
 */
export const createTaskFromExternalIssue = action({
  args: {
    organizationId: v.string(),
    externalSystem: v.string(),
    externalId: v.string(),
    title: v.string(),
    externalUrl: v.optional(v.string()),
    description: v.optional(v.string()),
    labels: v.optional(v.array(v.string())),
  },
  returns: v.object({ taskId: v.string(), created: v.boolean() }),
  handler: async (ctx, args): Promise<{ taskId: string; created: boolean }> => {
    const { userId } = await requireOrgMembershipById(ctx, args.organizationId);

    const projects = await ctx.runQuery(api.projects.queries.listProjects, {
      organizationId: args.organizationId,
    });
    const project = projects.find((p) => p.isOrgWide) ?? projects[0];
    if (!project) {
      throw new Error('No project available — create a project first');
    }

    const result = await ctx.runMutation(
      internal.tasks.internal_mutations.agentUpsertTaskByExternalRef,
      {
        organizationId: args.organizationId,
        actorId: userId,
        projectId: project._id,
        externalSystem: args.externalSystem,
        externalId: args.externalId,
        title: args.title,
        externalUrl: args.externalUrl,
        description: args.description,
        labels: args.labels,
        externalState: 'open',
      },
    );
    return { taskId: result.taskId, created: result.created };
  },
});
