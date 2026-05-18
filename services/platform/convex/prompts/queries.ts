import { paginationOptsValidator } from 'convex/server';
import { ConvexError } from 'convex/values';
import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { internalQuery } from '../_generated/server';
import { getUserNamesBatch } from '../documents/get_user_names_batch';
import { getUserTeamIds } from '../lib/get_user_teams';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { requireAuthenticatedUser } from '../lib/rls/auth/require_authenticated_user';
import { queryWithRLS } from '../lib/rls/helpers/query_with_rls';
import { getUserOrganizations } from '../lib/rls/organization/get_user_organizations';
import { validateOrganizationAccess } from '../lib/rls/organization/validate_organization_access';
import { hasTeamAccess } from '../lib/team_access';
import {
  assertCategoryScopeMatchesPromptScope,
  toCategoryAccessShape,
} from './category_access';
import { assertPromptSizes, normalizePromptFields } from './size_guards';
import {
  promptHistoryResultValidator,
  promptListItemValidator,
  promptScopeValidator,
  promptTemplateValidator,
} from './validators';
import { synthesizeLegacyV1Entry } from './version_history';

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
    categoryId: prompt.categoryId,
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

/** True if the row is visible to normal user reads. Rows soft-deleted by
 * the retention pipeline (trashed / expired) are surfaced only through the
 * admin Trash UI — not through listPrompts / getPrompt. Rows missing the
 * field (legacy or freshly created) are treated as active. */
export function isActivePrompt(p: PromptDoc): boolean {
  const status = p.lifecycleStatus ?? 'active';
  return status === 'active';
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
 * `search` runs case-insensitive substring matching on title, description,
 * category, and any tag of the paginated page — content is intentionally
 * excluded (too large for in-memory scan). `categories` and `tags` further
 * narrow the page to rows that match at least one selected facet. Future
 * Convex `searchIndex` work can replace the substring filter.
 */
export const listPrompts = queryWithRLS({
  args: {
    organizationId: v.string(),
    scope: v.optional(promptScopeValidator),
    search: v.optional(v.string()),
    /**
     * Legacy string-based facet filter. Kept for backward compatibility
     * during the `promptCategories` transition — clients should prefer
     * `categoryIds`. When both are supplied, a row matches if it
     * satisfies either filter.
     */
    categories: v.optional(v.array(v.string())),
    /** Id-based category filter. Matches against `promptTemplates.categoryId`. */
    categoryIds: v.optional(v.array(v.id('promptCategories'))),
    tags: v.optional(v.array(v.string())),
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
      postFilter = isActivePrompt;
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
      postFilter = (p) => isActivePrompt(p) && hasTeamAccess(p, userTeamIds);
    } else if (args.scope === 'global') {
      result = await ctx.db
        .query('promptTemplates')
        .withIndex('by_organizationId_and_scope', (q) =>
          q.eq('organizationId', args.organizationId).eq('scope', 'global'),
        )
        .order('desc')
        .paginate(paginationOpts);
      postFilter = isActivePrompt;
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
        if (!isActivePrompt(p)) return false;
        if (p.scope === 'personal' && p.createdBy !== user.userId) return false;
        if (p.scope === 'team' && !hasTeamAccess(p, userTeamIds)) return false;
        return true;
      };
    }

    const search = args.search?.trim().toLowerCase();
    const wantedCategories =
      args.categories && args.categories.length > 0
        ? new Set(args.categories)
        : null;
    const wantedCategoryIds =
      args.categoryIds && args.categoryIds.length > 0
        ? new Set(args.categoryIds)
        : null;
    const wantedTags =
      args.tags && args.tags.length > 0 ? new Set(args.tags) : null;

    const matchesSearch = (p: PromptDoc): boolean => {
      if (!search) return true;
      if (p.title.toLowerCase().includes(search)) return true;
      if (p.description?.toLowerCase().includes(search)) return true;
      if (p.category?.toLowerCase().includes(search)) return true;
      if (p.tags?.some((t) => t.toLowerCase().includes(search))) return true;
      return false;
    };
    // Either filter shape is honored. A row passes when (a) no filter is
    // set on either side, OR (b) it matches the id filter (modern path),
    // OR (c) it matches the legacy string filter. Clients in transition
    // will typically send one or the other, not both.
    const matchesCategory = (p: PromptDoc): boolean => {
      if (!wantedCategories && !wantedCategoryIds) return true;
      if (
        wantedCategoryIds &&
        p.categoryId &&
        wantedCategoryIds.has(p.categoryId)
      ) {
        return true;
      }
      if (
        wantedCategories &&
        p.category !== undefined &&
        wantedCategories.has(p.category)
      ) {
        return true;
      }
      return false;
    };
    const matchesTag = (p: PromptDoc): boolean =>
      !wantedTags || (p.tags?.some((t) => wantedTags.has(t)) ?? false);

    const visiblePage = result.page
      .filter(postFilter)
      .filter(matchesSearch)
      .filter(matchesCategory)
      .filter(matchesTag)
      .map(toListItem);

    // Client contract: `page` may be empty while `isDone` is false when every
    // row in the underlying paginate slice was post-filtered out (team
    // access, search, lifecycle, category/tag). Callers must keep paging on
    // `continueCursor` until `isDone === true`; the library dialog wires a
    // small `useEffect` that auto-advances on empty pages so users don't get
    // stranded on apparently-empty filtered results.
    return {
      page: visiblePage,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/**
 * Facets the library dialog renders into its filter popovers:
 *  - `categories`: every `promptCategories` row visible to the caller,
 *    bucketed by scope (personal-mine, team-mine, global). Replaces the
 *    legacy prompt-scan because categories now live in their own table.
 *  - `legacyCategoryStrings`: distinct `category` strings still on
 *    `promptTemplates` rows that haven't been lazy-migrated yet.
 *    Surfaces during the transition so the filter UI doesn't drop
 *    legacy values; can be removed once the cleanup migration lands.
 *  - `tags`: still derived from `promptTemplates`. Capped by
 *    `FACET_SCAN_LIMIT` to bound the scan.
 */
const FACET_SCAN_LIMIT = 500;

const facetCategoryValidator = v.object({
  _id: v.id('promptCategories'),
  scope: promptScopeValidator,
  teamId: v.optional(v.string()),
  name: v.string(),
});

export const listPromptFacets = queryWithRLS({
  args: {
    organizationId: v.string(),
  },
  returns: v.object({
    categories: v.array(facetCategoryValidator),
    legacyCategoryStrings: v.array(v.string()),
    tags: v.array(v.string()),
    scanned: v.number(),
    scanCapped: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const user = await getAuthUserIdentity(ctx);
    const empty = {
      categories: [] as Array<{
        _id: Doc<'promptCategories'>['_id'];
        scope: 'global' | 'team' | 'personal';
        teamId?: string;
        name: string;
      }>,
      legacyCategoryStrings: [] as string[],
      tags: [] as string[],
      scanned: 0,
      scanCapped: false,
    };
    if (!user) return empty;

    const userOrganizations = await getUserOrganizations(ctx, user);
    const membership = userOrganizations.find(
      (m) => m.organizationId === args.organizationId,
    );
    if (!membership) return empty;

    const userTeamIds = await getUserTeamIds(ctx, user.userId);
    const userTeamSet = new Set(userTeamIds);

    // Categories come straight from promptCategories (no scan cap — the
    // table is small relative to promptTemplates). Filter applies the
    // same visibility rules as the picker: own personal, own teams,
    // and every global.
    const visibleCategories: Array<{
      _id: Doc<'promptCategories'>['_id'];
      scope: 'global' | 'team' | 'personal';
      teamId?: string;
      name: string;
    }> = [];
    for await (const row of ctx.db
      .query('promptCategories')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      if (row.scope === 'global') {
        visibleCategories.push({
          _id: row._id,
          scope: row.scope,
          name: row.name,
        });
      } else if (row.scope === 'team') {
        if (row.teamId && userTeamSet.has(row.teamId)) {
          visibleCategories.push({
            _id: row._id,
            scope: row.scope,
            teamId: row.teamId,
            name: row.name,
          });
        }
      } else if (row.scope === 'personal') {
        if (row.createdBy === user.userId) {
          visibleCategories.push({
            _id: row._id,
            scope: row.scope,
            name: row.name,
          });
        }
      }
    }
    visibleCategories.sort((a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
    );

    // Tags + legacy strings still come from a prompt scan. The legacy
    // string set will trend toward empty as the lazy migration touches
    // rows; it goes away with the cleanup migration.
    const legacyStrings = new Set<string>();
    const tags = new Set<string>();
    let scanned = 0;
    let scanCapped = false;

    for await (const row of ctx.db
      .query('promptTemplates')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .order('desc')) {
      scanned++;
      if (scanned > FACET_SCAN_LIMIT) {
        scanCapped = true;
        scanned = FACET_SCAN_LIMIT;
        break;
      }
      if (!isActivePrompt(row)) continue;
      if (row.scope === 'personal' && row.createdBy !== user.userId) continue;
      if (row.scope === 'team' && !hasTeamAccess(row, userTeamIds)) continue;
      // Only collect legacy strings on rows that haven't been migrated
      // (i.e. no categoryId yet) — otherwise the row's structured
      // category appears as a duplicate entry.
      if (row.category && !row.categoryId) legacyStrings.add(row.category);
      if (row.tags) for (const t of row.tags) tags.add(t);
    }

    return {
      categories: visibleCategories,
      legacyCategoryStrings: [...legacyStrings].sort(),
      tags: [...tags].sort(),
      scanned,
      scanCapped,
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
    // Soft-deleted by retention: hidden from normal reads; admin sees it
    // via the Trash UI queries instead.
    if (!isActivePrompt(prompt)) return null;

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
    if (!isActivePrompt(prompt)) return null;

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
      // a v1 from the row's current state via the shared helper so the dialog
      // and `resolveRestoreTarget` always read the same shape. The JIT seed
      // in `buildNextVersionEntry` later promotes this into the persisted
      // array on first edit.
      const v1 = synthesizeLegacyV1Entry(prompt);
      return {
        current: {
          ...v1,
          publishedByName: resolveName(v1.publishedBy),
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
        categoryId: entry.categoryId ?? prompt.categoryId,
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

/**
 * Lightweight lookup used by the chat to mark which of the user's own
 * messages have been saved as a prompt. Caller passes the `sourceMessageIds`
 * currently rendered in the chat; we return only the `(promptId,
 * sourceMessageId)` pairs that match. Bounding the output by the visible
 * message set keeps wire size constant regardless of save-history length.
 *
 * Returns `[]` when `sourceMessageIds` is empty so the chat can short-circuit
 * before paying any iteration cost.
 */
export const getSavedSourceMessageIds = queryWithRLS({
  args: {
    organizationId: v.string(),
    sourceMessageIds: v.array(v.string()),
  },
  returns: v.array(
    v.object({
      promptId: v.id('promptTemplates'),
      sourceMessageId: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    if (args.sourceMessageIds.length === 0) return [];

    const user = await getAuthUserIdentity(ctx);
    if (!user) return [];

    const userOrganizations = await getUserOrganizations(ctx, user);
    const membership = userOrganizations.find(
      (m) => m.organizationId === args.organizationId,
    );
    if (!membership) return [];

    const wanted = new Set(args.sourceMessageIds);

    const out: Array<{
      promptId: Doc<'promptTemplates'>['_id'];
      sourceMessageId: string;
    }> = [];
    for await (const row of ctx.db
      .query('promptTemplates')
      .withIndex('by_org_createdBy', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('createdBy', user.userId),
      )) {
      if (!isActivePrompt(row)) continue;
      if (!row.sourceMessageId) continue;
      if (!wanted.has(row.sourceMessageId)) continue;
      out.push({ promptId: row._id, sourceMessageId: row.sourceMessageId });
    }
    return out;
  },
});

/**
 * Pre-flight validation for the `savePrompt` action. Runs before the LLM
 * title-generation call so a caller supplying a wrong `organizationId` /
 * `teamId` / oversize content doesn't burn provider tokens before the
 * downstream mutation rejects. The mutation re-validates everything — this
 * is a fast-fail, not a security gate.
 */
export const validateSaveArgs = internalQuery({
  args: {
    organizationId: v.string(),
    content: v.string(),
    description: v.optional(v.string()),
    scope: promptScopeValidator,
    teamId: v.optional(v.string()),
    category: v.optional(v.string()),
    /**
     * Optional structured category id. Validated here as a cheap
     * fast-fail before `savePrompt` pays for title generation — a
     * deleted, cross-org, or scope-incompatible id throws now instead
     * of slipping through to `createPrompt`. `createPrompt` still
     * re-validates on the write path; this is a UX guard, not the
     * security boundary.
     */
    categoryId: v.optional(v.id('promptCategories')),
    tags: v.optional(v.array(v.string())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedUser(ctx);
    await validateOrganizationAccess(ctx, args.organizationId, undefined, user);
    const teamIds = await getUserTeamIds(ctx, user.userId);
    if (args.scope === 'team') {
      if (!args.teamId) {
        throw new ConvexError({
          code: 'forbidden',
          message: 'Team-scoped prompts must specify a team',
        });
      }
      if (!teamIds.includes(args.teamId)) {
        throw new ConvexError({
          code: 'forbidden',
          message: 'You are not a member of this team',
        });
      }
    }
    if (args.categoryId) {
      const cat = await ctx.db.get(args.categoryId);
      if (!cat || cat.organizationId !== args.organizationId) {
        throw new ConvexError({
          code: 'not_found',
          message: 'Category not found',
        });
      }
      assertCategoryScopeMatchesPromptScope({
        promptScope: args.scope,
        promptTeamId: args.scope === 'team' ? args.teamId : undefined,
        category: toCategoryAccessShape(cat),
        userId: user.userId,
        userTeamIds: teamIds,
      });
    }
    const normalized = normalizePromptFields({
      content: args.content,
      description: args.description,
      category: args.category,
      tags: args.tags,
    });
    assertPromptSizes(normalized);
    return null;
  },
});
