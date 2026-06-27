import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { query } from '../_generated/server';
import { authorizeSupportRead, loadCaseInOrg } from './helpers';
import {
  supportCaseActorTypeValidator,
  supportCasePriorityValidator,
  supportCaseStatusValidator,
} from './schema';

/**
 * Read side of the customer support portal (issue #1923). Every handler runs
 * through {@link authorizeSupportRead}; a non-member / unauthenticated caller
 * gets an empty result, never another org's data.
 */

/**
 * Support cases are ORG-scoped — staff see every case in the org, the largest
 * cardinality surface here — so the board scan is bounded and flags `truncated`,
 * exactly like the analogous `tasks` board (`TASK_BOARD_CAP`), to stay off the
 * 1s query-budget cliff rather than scanning an unbounded result set.
 */
const SUPPORT_CASE_BOARD_CAP = 2000;
/** Per-case activity timeline cap (mirrors `tasks` `TASK_ACTIVITY_CAP`). */
const SUPPORT_CASE_ACTIVITY_CAP = 500;

/** Whole-row projection for a case. Kept ⊇ the schema so Convex's strict return
 * validation never throws on a stored field (the empty-board failure mode
 * documented in `tasks/queries.test.ts`). */
export const supportCaseRowValidator = v.object({
  _id: v.id('supportCases'),
  _creationTime: v.number(),
  organizationId: v.string(),
  subject: v.string(),
  description: v.optional(v.string()),
  status: supportCaseStatusValidator,
  priority: v.optional(supportCasePriorityValidator),
  escalationLevel: v.optional(v.number()),
  escalatedAt: v.optional(v.number()),
  assigneeType: v.optional(supportCaseActorTypeValidator),
  assigneeId: v.optional(v.string()),
  customerId: v.optional(v.id('customers')),
  requesterEmail: v.optional(v.string()),
  requesterName: v.optional(v.string()),
  slaDueAt: v.optional(v.number()),
  firstRespondedAt: v.optional(v.number()),
  resolvedAt: v.optional(v.number()),
  closedAt: v.optional(v.number()),
  commentCount: v.optional(v.number()),
  statusChangedAt: v.optional(v.number()),
  createdBy: v.string(),
  createdByType: supportCaseActorTypeValidator,
  createdAt: v.number(),
  updatedAt: v.number(),
  archivedAt: v.optional(v.number()),
});

export const supportCaseCommentValidator = v.object({
  _id: v.id('supportCaseComments'),
  _creationTime: v.number(),
  organizationId: v.string(),
  caseId: v.id('supportCases'),
  authorType: supportCaseActorTypeValidator,
  authorId: v.string(),
  body: v.string(),
  internal: v.optional(v.boolean()),
  createdAt: v.number(),
  editedAt: v.optional(v.number()),
});

export const supportCaseActivityValidator = v.object({
  _id: v.id('supportCaseActivity'),
  _creationTime: v.number(),
  organizationId: v.string(),
  caseId: v.id('supportCases'),
  actorType: supportCaseActorTypeValidator,
  actorId: v.string(),
  action: v.string(),
  fromValue: v.optional(v.string()),
  toValue: v.optional(v.string()),
  createdAt: v.number(),
});

/**
 * List an organization's support cases, newest activity first. Filters are
 * applied in-handler; the common "by status" view is index-served. Archived
 * (soft-deleted) cases are excluded unless `includeArchived` is set. The scan is
 * bounded at {@link SUPPORT_CASE_BOARD_CAP}; `truncated` is `true` when the org
 * has more matching cases than the cap returned.
 */
export const listCases = query({
  args: {
    organizationId: v.string(),
    status: v.optional(supportCaseStatusValidator),
    assigneeId: v.optional(v.string()),
    customerId: v.optional(v.id('customers')),
    escalatedOnly: v.optional(v.boolean()),
    includeArchived: v.optional(v.boolean()),
  },
  returns: v.object({
    cases: v.array(supportCaseRowValidator),
    truncated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const authUser = await authorizeSupportRead(ctx, args.organizationId);
    if (!authUser) return { cases: [], truncated: false };

    const rows: Doc<'supportCases'>[] = [];
    let truncated = false;
    const statusFilter = args.status;
    const iterator = statusFilter
      ? ctx.db
          .query('supportCases')
          .withIndex('by_org_status', (q) =>
            q
              .eq('organizationId', args.organizationId)
              .eq('status', statusFilter),
          )
      : ctx.db
          .query('supportCases')
          .withIndex('by_organization', (q) =>
            q.eq('organizationId', args.organizationId),
          );

    for await (const supportCase of iterator) {
      if (!args.includeArchived && supportCase.archivedAt !== undefined)
        continue;
      if (args.assigneeId && supportCase.assigneeId !== args.assigneeId)
        continue;
      if (args.customerId && supportCase.customerId !== args.customerId)
        continue;
      if (args.escalatedOnly && !(supportCase.escalationLevel ?? 0)) continue;
      rows.push(supportCase);
      if (rows.length >= SUPPORT_CASE_BOARD_CAP) {
        truncated = true;
        break;
      }
    }

    rows.sort((a, b) => b.updatedAt - a.updatedAt);
    return { cases: rows, truncated };
  },
});

/** Get one case (org-scoped); `null` when missing, cross-org, or unauthorized. */
export const getCase = query({
  args: { organizationId: v.string(), caseId: v.id('supportCases') },
  returns: v.union(supportCaseRowValidator, v.null()),
  handler: async (ctx, args) => {
    const authUser = await authorizeSupportRead(ctx, args.organizationId);
    if (!authUser) return null;
    return await loadCaseInOrg(ctx, args.caseId, args.organizationId);
  },
});

/**
 * List a case's comments oldest-first. `includeInternal` defaults to true
 * (staff view); a customer-facing caller passes `false` to hide staff-only
 * notes.
 */
export const listCaseComments = query({
  args: {
    organizationId: v.string(),
    caseId: v.id('supportCases'),
    includeInternal: v.optional(v.boolean()),
  },
  returns: v.array(supportCaseCommentValidator),
  handler: async (ctx, args) => {
    const authUser = await authorizeSupportRead(ctx, args.organizationId);
    if (!authUser) return [];
    const supportCase = await loadCaseInOrg(
      ctx,
      args.caseId,
      args.organizationId,
    );
    if (!supportCase) return [];

    const includeInternal = args.includeInternal ?? true;
    const rows: Doc<'supportCaseComments'>[] = [];
    for await (const comment of ctx.db
      .query('supportCaseComments')
      .withIndex('by_case', (q) => q.eq('caseId', args.caseId))) {
      if (!includeInternal && comment.internal) continue;
      rows.push(comment);
    }
    return rows;
  },
});

/**
 * List a case's activity timeline oldest-first, bounded at
 * {@link SUPPORT_CASE_ACTIVITY_CAP} so a long-lived case can't blow the query
 * budget (mirrors the `tasks` activity feed's `.take(TASK_ACTIVITY_CAP)`).
 */
export const listCaseActivity = query({
  args: { organizationId: v.string(), caseId: v.id('supportCases') },
  returns: v.array(supportCaseActivityValidator),
  handler: async (ctx, args) => {
    const authUser = await authorizeSupportRead(ctx, args.organizationId);
    if (!authUser) return [];
    const supportCase = await loadCaseInOrg(
      ctx,
      args.caseId,
      args.organizationId,
    );
    if (!supportCase) return [];

    return await ctx.db
      .query('supportCaseActivity')
      .withIndex('by_case', (q) => q.eq('caseId', args.caseId))
      .take(SUPPORT_CASE_ACTIVITY_CAP);
  },
});
