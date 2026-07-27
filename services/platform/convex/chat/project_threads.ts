/**
 * The project page's Chats tab: the caller's own conversations in the
 * project, and the ones other members shared with it. One access gate — the
 * same `assertProjectAccessForChat` every chat↔project touchpoint uses — and
 * one indexed walk; author names resolve in a single batched pass.
 */

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { query } from '../_generated/server';
import { getUserNamesBatch } from '../documents/get_user_names_batch';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';

/** More rows than any tab wants to render — a budget, not pagination. */
const PROJECT_THREADS_CAP = 200;

const projectThreadValidator = v.object({
  id: v.id('threads'),
  title: v.optional(v.string()),
  updatedAt: v.number(),
  sharedWithProject: v.optional(v.boolean()),
  userId: v.string(),
  authorName: v.union(v.string(), v.null()),
});

export const listThreadsForProject = query({
  args: { organizationId: v.string(), projectId: v.string() },
  returns: v.object({
    mine: v.array(projectThreadValidator),
    shared: v.array(projectThreadValidator),
  }),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');
    await getOrganizationMember(ctx, args.organizationId, authUser);

    const projectId = ctx.db.normalizeId('projects', args.projectId);
    if (!projectId) return { mine: [], shared: [] };
    const access = await ctx.runQuery(
      internal.projects.internal_queries.assertProjectAccessForChat,
      {
        projectId,
        organizationId: args.organizationId,
        userId: authUser.userId,
      },
    );
    if (!access.allowed) return { mine: [], shared: [] };

    const rows = await ctx.db
      .query('threads')
      .withIndex('by_org_project', (q) =>
        q.eq('organizationId', args.organizationId).eq('projectId', projectId),
      )
      .order('desc')
      .take(PROJECT_THREADS_CAP);

    const visible = rows.filter(
      (thread) =>
        thread.lifecycleStatus === undefined && thread.hidden === undefined,
    );
    const mine = visible.filter((thread) => thread.userId === authUser.userId);
    const shared = visible.filter(
      (thread) =>
        thread.userId !== authUser.userId && thread.sharedWithProject === true,
    );

    const names = await getUserNamesBatch(
      ctx,
      shared.map((thread) => thread.userId),
    );
    const project = (thread: (typeof visible)[number]) => ({
      id: thread._id,
      title: thread.title,
      updatedAt: thread.updatedAt,
      sharedWithProject: thread.sharedWithProject,
      userId: thread.userId,
      authorName: names.get(thread.userId) ?? null,
    });
    return { mine: mine.map(project), shared: shared.map(project) };
  },
});
