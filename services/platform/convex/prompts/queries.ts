import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { getUserNamesBatch } from '../documents/get_user_names_batch';
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

/**
 * Hard cap on rows returned by `listPrompts`. Demo-stage orgs have far fewer
 * than 500 prompts; this is a guard rail against unbounded scans. When hit,
 * we log so an ops/PR review can decide whether to introduce true pagination.
 */
const LIST_PROMPTS_HARD_CAP = 500;

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
    const iterable = ctx.db
      .query('promptTemplates')
      .withIndex('by_organizationId_and_scope', (q) =>
        scope
          ? q.eq('organizationId', args.organizationId).eq('scope', scope)
          : q.eq('organizationId', args.organizationId),
      );

    for await (const prompt of iterable) {
      if (prompt.scope === 'personal' && prompt.createdBy !== user.userId) {
        continue;
      }
      if (!hasTeamAccess(prompt, userTeamIds)) {
        continue;
      }

      results.push(toListItem(prompt));
      if (results.length >= LIST_PROMPTS_HARD_CAP) {
        console.warn(
          `[prompts] listPrompts hit hard cap (${LIST_PROMPTS_HARD_CAP}) for org ${args.organizationId}; older rows omitted.`,
        );
        break;
      }
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

    // Server-side resolve userId → displayName once for the whole result, so
    // the UI can render "Published by Alice" without N+1 lookups.
    const publisherIds = new Set<string>();
    publisherIds.add(prompt.createdBy);
    for (const entry of all) publisherIds.add(entry.publishedBy);
    const nameMap = await getUserNamesBatch(ctx, [...publisherIds]);
    const resolveName = (id: string): string | null => nameMap.get(id) ?? null;

    if (all.length === 0) {
      // Legacy or freshly-seeded row with no inline history yet. Synthesize
      // a v1 from the row's current content so the dialog shows the baseline
      // instead of an empty-state. The JIT seed in `buildNextVersionEntry`
      // promotes this same shape into the persisted array on first edit.
      return {
        current: {
          version: prompt.version ?? 1,
          content: prompt.content,
          publishedAt: prompt._creationTime,
          publishedBy: prompt.createdBy,
          publishedByName: resolveName(prompt.createdBy),
        },
        history: [],
        totalCount: 1,
      };
    }

    const sorted = all
      .slice()
      .sort((a, b) => b.version - a.version)
      .map((entry) => ({
        version: entry.version,
        content: entry.content,
        publishedAt: entry.publishedAt,
        publishedBy: entry.publishedBy,
        publishedByName: resolveName(entry.publishedBy),
        publishNote: entry.publishNote,
      }));
    const [current, ...rest] = sorted;
    return {
      current,
      history: rest,
      totalCount: sorted.length,
    };
  },
});
