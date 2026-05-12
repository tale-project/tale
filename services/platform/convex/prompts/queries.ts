import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { getUserTeamIds } from '../lib/get_user_teams';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { queryWithRLS } from '../lib/rls/helpers/query_with_rls';
import { getUserOrganizations } from '../lib/rls/organization/get_user_organizations';
import { hasTeamAccess } from '../lib/team_access';
import {
  promptHistoryResultValidator,
  promptScopeValidator,
  promptTemplateListItemValidator,
  promptTemplateValidator,
} from './validators';

type PromptDoc = Doc<'promptTemplates'>;

/** List view: strip versionHistory (use getPromptHistory for that). */
function toListItem(prompt: PromptDoc) {
  return {
    _id: prompt._id,
    _creationTime: prompt._creationTime,
    organizationId: prompt.organizationId,
    createdBy: prompt.createdBy,
    title: prompt.title,
    content: prompt.content,
    description: prompt.description,
    scope: prompt.scope,
    teamId: prompt.teamId,
    category: prompt.category,
    tags: prompt.tags,
    usageCount: prompt.usageCount,
    sourceMessageId: prompt.sourceMessageId,
    lifecycleStatus: prompt.lifecycleStatus,
    statusChangedAt: prompt.statusChangedAt,
    version: prompt.version,
  };
}

function stripVersionHistory(prompt: PromptDoc): PromptDoc {
  const { versionHistory: _vh, ...rest } = prompt;
  return rest;
}

export const listPrompts = queryWithRLS({
  args: {
    organizationId: v.string(),
    scope: v.optional(promptScopeValidator),
  },
  returns: v.array(promptTemplateListItemValidator),
  handler: async (ctx, args) => {
    const user = await getAuthUserIdentity(ctx);
    if (!user) return [];

    const userOrganizations = await getUserOrganizations(ctx, user);
    const membership = userOrganizations.find(
      (m) => m.organizationId === args.organizationId,
    );
    if (!membership) return [];

    const userTeamIds = await getUserTeamIds(ctx, user.userId);
    const results = [];

    const { scope } = args;
    const iterable = scope
      ? ctx.db
          .query('promptTemplates')
          .withIndex('by_organizationId_and_scope', (q) =>
            q.eq('organizationId', args.organizationId).eq('scope', scope),
          )
      : ctx.db
          .query('promptTemplates')
          .withIndex('by_organizationId', (q) =>
            q.eq('organizationId', args.organizationId),
          );

    for await (const prompt of iterable) {
      if (prompt.lifecycleStatus === 'expired') {
        continue;
      }
      if (prompt.scope === 'personal' && prompt.createdBy !== user.userId) {
        continue;
      }
      if (!hasTeamAccess(prompt, userTeamIds)) {
        continue;
      }

      results.push(toListItem(prompt));
    }

    return results;
  },
});

export const getPrompt = queryWithRLS({
  args: {
    promptId: v.id('promptTemplates'),
  },
  returns: v.union(promptTemplateValidator, v.null()),
  handler: async (ctx, args) => {
    const prompt = await ctx.db.get(args.promptId);
    if (!prompt) return null;
    if (prompt.lifecycleStatus === 'expired') return null;

    const user = await getAuthUserIdentity(ctx);
    if (!user) return null;

    if (prompt.scope === 'personal' && prompt.createdBy !== user.userId) {
      return null;
    }

    if (prompt.scope === 'team') {
      const userTeamIds = await getUserTeamIds(ctx, user.userId);
      if (!hasTeamAccess(prompt, userTeamIds)) return null;
    }

    const userOrganizations = await getUserOrganizations(ctx, user);
    const membership = userOrganizations.find(
      (m) => m.organizationId === prompt.organizationId,
    );
    const isAdmin =
      membership?.role === 'admin' || membership?.role === 'owner';
    const canSeeHistory = prompt.createdBy === user.userId || isAdmin;

    return canSeeHistory ? prompt : stripVersionHistory(prompt);
  },
});

export const getPromptHistory = queryWithRLS({
  args: {
    promptId: v.id('promptTemplates'),
  },
  returns: v.union(promptHistoryResultValidator, v.null()),
  handler: async (ctx, args) => {
    const prompt = await ctx.db.get(args.promptId);
    if (!prompt) return null;
    if (prompt.lifecycleStatus === 'expired') return null;

    const user = await getAuthUserIdentity(ctx);
    if (!user) return null;

    // Mirror getPrompt's personal-scope gate: an org admin who is not the
    // creator must not be able to read another user's personal-scope prompt
    // history just by knowing its id.
    if (prompt.scope === 'personal' && prompt.createdBy !== user.userId) {
      return null;
    }

    const userOrganizations = await getUserOrganizations(ctx, user);
    const membership = userOrganizations.find(
      (m) => m.organizationId === prompt.organizationId,
    );
    if (!membership) return null;

    const isAdmin = membership.role === 'admin' || membership.role === 'owner';
    if (prompt.createdBy !== user.userId && !isAdmin) return null;

    const all = prompt.versionHistory ?? [];
    if (all.length === 0) return null;

    const sorted = all.slice().sort((a, b) => b.version - a.version);
    const [current, ...rest] = sorted;
    return {
      current,
      history: rest,
      totalCount: sorted.length,
    };
  },
});
