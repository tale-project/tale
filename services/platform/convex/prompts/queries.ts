import { paginationOptsValidator } from 'convex/server';
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
  promptListItemValidator,
  promptScopeValidator,
  promptTemplateValidator,
} from './validators';

type PromptDoc = Doc<'promptTemplates'>;

/** Server-side cap on `paginationOpts.numItems`. Clients can request smaller
 * pages; anything above this is clamped to prevent giant scans. */
const MAX_LIST_PAGE_SIZE = 100;
const DEFAULT_LIST_PAGE_SIZE = 30;

/** List view: strip versionHistory so it doesn't bloat the wire (use
 * getPromptHistory for full history). */
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
    version: prompt.version,
  };
}

function stripVersionHistory(prompt: PromptDoc): PromptDoc {
  const { versionHistory: _vh, ...rest } = prompt;
  return rest;
}

const EMPTY_PAGE = { page: [], isDone: true, continueCursor: '' };

const paginatedListResultValidator = v.object({
  page: v.array(promptListItemValidator),
  isDone: v.boolean(),
  continueCursor: v.string(),
});

/**
 * Paginated org-scoped list. The optional `scope` arg picks a dedicated
 * index so personal-scope filtering is pushed into the scan (no more
 * shrink-to-zero pages after post-paginate filtering). The optional
 * `searchPrefix` filters by case-insensitive title substring on the
 * paginated page — fine at MAX_LIST_PAGE_SIZE granularity; future search
 * indexes can replace this.
 */
export const listPrompts = queryWithRLS({
  args: {
    organizationId: v.string(),
    scope: v.optional(promptScopeValidator),
    searchPrefix: v.optional(v.string()),
    paginationOpts: v.optional(paginationOptsValidator),
  },
  returns: paginatedListResultValidator,
  handler: async (ctx, args) => {
    const user = await getAuthUserIdentity(ctx);
    if (!user) return EMPTY_PAGE;

    const userOrganizations = await getUserOrganizations(ctx, user);
    const membership = userOrganizations.find(
      (m) => m.organizationId === args.organizationId,
    );
    if (!membership) return EMPTY_PAGE;

    const numItems = Math.min(
      Math.max(args.paginationOpts?.numItems ?? DEFAULT_LIST_PAGE_SIZE, 1),
      MAX_LIST_PAGE_SIZE,
    );
    const paginationOpts = {
      cursor: args.paginationOpts?.cursor ?? null,
      numItems,
    };

    const userTeamIds =
      args.scope === 'team' || args.scope === undefined
        ? await getUserTeamIds(ctx, user.userId)
        : [];

    let result: { page: PromptDoc[]; isDone: boolean; continueCursor: string };
    let postFilter: (p: PromptDoc) => boolean;

    if (args.scope === 'personal') {
      // Index-level filter to this user's personal prompts — no post-filter
      // shrinks the page.
      result = await ctx.db
        .query('promptTemplates')
        .withIndex('by_organizationId_and_scope_and_createdBy', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('scope', 'personal')
            .eq('createdBy', user.userId),
        )
        .order('desc')
        .paginate(paginationOpts);
      postFilter = () => true;
    } else if (args.scope === 'team') {
      result = await ctx.db
        .query('promptTemplates')
        .withIndex('by_organizationId_and_scope', (q) =>
          q.eq('organizationId', args.organizationId).eq('scope', 'team'),
        )
        .order('desc')
        .paginate(paginationOpts);
      // Team membership filter can't be expressed in the index — must
      // post-filter. Acceptable: team prompt counts are bounded.
      postFilter = (p) => hasTeamAccess(p, userTeamIds);
    } else if (args.scope === 'global') {
      result = await ctx.db
        .query('promptTemplates')
        .withIndex('by_organizationId_and_scope', (q) =>
          q.eq('organizationId', args.organizationId).eq('scope', 'global'),
        )
        .order('desc')
        .paginate(paginationOpts);
      postFilter = () => true;
    } else {
      // No scope filter — newest-first across all scopes. Personal-scope
      // rows owned by other users and team-scope rows the caller can't
      // access are filtered out in memory (the alternative is per-scope
      // queries merged client-side, which is far more complex).
      result = await ctx.db
        .query('promptTemplates')
        .withIndex('by_organizationId', (q) =>
          q.eq('organizationId', args.organizationId),
        )
        .order('desc')
        .paginate(paginationOpts);
      postFilter = (p) => {
        if (p.scope === 'personal' && p.createdBy !== user.userId) return false;
        if (p.scope === 'team' && !hasTeamAccess(p, userTeamIds)) return false;
        return true;
      };
    }

    const search = args.searchPrefix?.trim().toLowerCase();
    const visiblePage = result.page
      .filter(postFilter)
      .filter((p) => {
        if (!search) return true;
        if (p.title.toLowerCase().includes(search)) return true;
        if (p.description?.toLowerCase().includes(search)) return true;
        return false;
      })
      .map(toListItem);

    return {
      page: visiblePage,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
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

    if (prompt.scope === 'team') {
      const userTeamIds = await getUserTeamIds(ctx, user.userId);
      if (!hasTeamAccess(prompt, userTeamIds)) return null;
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
      // a v1 from the row's current state so the dialog shows the baseline
      // instead of an empty-state. The JIT seed in `buildNextVersionEntry`
      // promotes this same shape into the persisted array on first edit.
      return {
        current: {
          version: prompt.version ?? 1,
          content: prompt.content,
          publishedAt: prompt._creationTime,
          publishedBy: prompt.createdBy,
          publishedByName: resolveName(prompt.createdBy),
          title: prompt.title,
          description: prompt.description,
          category: prompt.category,
          tags: prompt.tags,
          scope: prompt.scope,
          teamId: prompt.teamId,
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
        // Legacy entries (pre-metadata snapshot) fall back to row values so
        // the history dialog always renders a complete state, never
        // "undefined".
        title: entry.title ?? prompt.title,
        description: entry.description ?? prompt.description,
        category: entry.category ?? prompt.category,
        tags: entry.tags ?? prompt.tags,
        scope: entry.scope ?? prompt.scope,
        teamId: entry.teamId ?? prompt.teamId,
      }));
    const [current, ...rest] = sorted;
    return {
      current,
      history: rest,
      totalCount: sorted.length,
    };
  },
});
