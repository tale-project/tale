import { v } from 'convex/values';

import { buildExclusionSet } from '../../lib/shared/platform/exclude_by';
import { collectFilteredPage } from '../../lib/shared/platform/filtered_pagination';
import { isRecord } from '../../lib/utils/type-utils';
import { api, internal } from '../_generated/api';
import { action } from '../_generated/server';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';

/**
 * Public, org-gated wrapper to LIST GitHub issues for an app surface. Integration
 * operations dispatch through an internal action (the connector runs server-side;
 * the org's token never reaches the client), so there's no public function to
 * bind to directly — this is the thin, read-only entry an app's view binds to via
 * `capabilities.functions`. Scoped to `list_issues` (no write ops) by design.
 *
 * One-shot (not reactive): GitHub is the source of truth. Selecting an issue to
 * create a task (createTaskFromExternalIssue) materializes it into the reactive
 * `tasks` table, which the rest of the view reads live.
 */
export const listGitHubIssues = action({
  args: {
    organizationId: v.string(),
    owner: v.string(),
    repo: v.string(),
    state: v.optional(v.string()),
    page: v.optional(v.number()),
    perPage: v.optional(v.number()),
  },
  returns: v.any(),
  // oxlint-disable-next-line typescript/no-explicit-any -- third-party issue shape at the API boundary
  handler: async (ctx, args): Promise<any> => {
    await requireOrgMembershipById(ctx, args.organizationId);
    return await ctx.runAction(
      internal.agent_tools.integrations.internal_actions.executeIntegration,
      {
        organizationId: args.organizationId,
        integrationName: 'github',
        operation: 'list_issues',
        params: {
          owner: args.owner,
          repo: args.repo,
          state: args.state ?? 'open',
          per_page: Math.min(Math.max(args.perPage ?? 30, 1), 100),
          page: Math.max(args.page ?? 1, 1),
        },
        skipApprovalCheck: true,
      },
    );
  },
});

/** GitHub is paged at 100 (its max) per upstream call to minimize round-trips. */
const SOURCE_PAGE_SIZE = 100;
/**
 * Per-request RESOURCE guard, NOT a correctness cap: one call won't scan more
 * than this many upstream pages before handing back a cursor. If the budget is
 * spent before `perPage` visible rows accumulate, we return what we have plus the
 * cursor — the client's "Load more" resumes exactly where we stopped, so the page
 * is always a correct prefix of the filtered stream and never dead-ends.
 */
const REQUEST_PAGE_BUDGET = 10;

const issueCursorValidator = v.object({
  /** 1-indexed GitHub page to resume from. */
  sourcePage: v.number(),
  /** Index within that page of the first not-yet-emitted row. */
  sourceOffset: v.number(),
});

/**
 * List GitHub issues that are NOT yet tracked as tasks in this project, paged by
 * VISIBLE rows. Does the filter+paginate anti-join SERVER-side: it pulls upstream
 * pages, drops rows failing `rowWhen` (e.g. pull requests) and rows whose
 * `rowKeyTemplate` key already exists in the project's tasks, and keeps pulling
 * until it has filled a `perPage` page of visible rows (or the source/budget is
 * exhausted). So "page 1" is genuinely a full page of actionable issues — the
 * first paint is never a misleadingly-empty page of already-handled issues.
 *
 * Returns `{ data, pagination: { hasNextPage, nextCursor } }` — the same envelope
 * shape the generic list block already understands, plus an opaque cursor. The
 * client keeps its reactive `excludeBy` as a thin live top-up (so a task created
 * after this snapshot hides its row immediately), but correctness/fullness of the
 * page is owned here, where filtering and pagination live in one layer.
 */
export const listUntrackedGitHubIssues = action({
  args: {
    organizationId: v.string(),
    owner: v.string(),
    repo: v.string(),
    state: v.optional(v.string()),
    projectId: v.id('projects'),
    externalSystem: v.string(),
    /** `when_predicate` grammar, evaluated server-side (e.g. `!pull_request`). */
    rowWhen: v.optional(v.string()),
    /** `{field}` template rebuilding a row's task key (e.g. `owner/repo#{number}`). */
    rowKeyTemplate: v.string(),
    /** Page size in VISIBLE (post-filter) rows. */
    perPage: v.number(),
    cursor: v.optional(issueCursorValidator),
  },
  returns: v.object({
    data: v.array(v.any()),
    pagination: v.object({
      hasNextPage: v.boolean(),
      nextCursor: v.union(issueCursorValidator, v.null()),
    }),
  }),
  // oxlint-disable-next-line typescript/no-explicit-any -- third-party issue shape at the API boundary
  handler: async (ctx, args): Promise<any> => {
    await requireOrgMembershipById(ctx, args.organizationId);

    // The COMPLETE (untruncated) set of issue keys already materialized into this
    // project's tasks — gated by the query's own project RLS.
    const excluded = buildExclusionSet(
      await ctx.runQuery(api.tasks.queries.listExternalKeysByProject, {
        projectId: args.projectId,
        externalSystem: args.externalSystem,
      }),
      '',
    );

    return await collectFilteredPage({
      fetchSourcePage: async (page) => {
        const res: unknown = await ctx.runAction(
          internal.agent_tools.integrations.internal_actions.executeIntegration,
          {
            organizationId: args.organizationId,
            integrationName: 'github',
            operation: 'list_issues',
            params: {
              owner: args.owner,
              repo: args.repo,
              state: args.state ?? 'open',
              per_page: SOURCE_PAGE_SIZE,
              page,
            },
            skipApprovalCheck: true,
          },
        );
        const pagination = isRecord(res) ? res.pagination : undefined;
        return {
          rows: isRecord(res) && Array.isArray(res.data) ? res.data : [],
          hasNext: isRecord(pagination) && pagination.hasNextPage === true,
        };
      },
      excluded,
      rowKeyTemplate: args.rowKeyTemplate,
      // owner/repo come from the app's per-install config (resolved client-side
      // into these args); the issue row carries only `number`, so merge them in
      // so the key matches the externalId the create path wrote from the same
      // config (e.g. `{owner}/{repo}#{number}`).
      templateScope: { owner: args.owner, repo: args.repo },
      rowWhen: args.rowWhen,
      perPage: args.perPage,
      cursor: args.cursor,
      pageBudget: REQUEST_PAGE_BUDGET,
    });
  },
});
