import { ConvexError, v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import { mutation } from '../_generated/server';
import {
  authorizeSupportWrite,
  recordCaseActivity,
  requireCaseInOrg,
  SUPPORT_CASE_COMMENT_MAX,
  SUPPORT_CASE_DESCRIPTION_MAX,
  SUPPORT_CASE_REQUESTER_EMAIL_MAX,
  SUPPORT_CASE_REQUESTER_NAME_MAX,
  validateCommentBody,
  validateOptionalText,
  validateSubject,
} from './helpers';
import {
  supportCaseActorTypeValidator,
  supportCasePriorityValidator,
  supportCaseStatusValidator,
} from './schema';

/**
 * Write side of the customer support portal (issue #1923): create / manage
 * (status, priority, assignee) / escalate / comment. Every handler authorizes
 * through {@link authorizeSupportWrite} and records an activity row so the case
 * has a complete history. Human callers are attributed as `user`; this API is
 * the staff-facing surface.
 */

/** Open a new support case. */
export const createCase = mutation({
  args: {
    organizationId: v.string(),
    subject: v.string(),
    description: v.optional(v.string()),
    priority: v.optional(supportCasePriorityValidator),
    customerId: v.optional(v.id('customers')),
    requesterEmail: v.optional(v.string()),
    requesterName: v.optional(v.string()),
    slaDueAt: v.optional(v.number()),
    assigneeType: v.optional(supportCaseActorTypeValidator),
    assigneeId: v.optional(v.string()),
  },
  returns: v.object({ caseId: v.id('supportCases') }),
  handler: async (ctx, args): Promise<{ caseId: Id<'supportCases'> }> => {
    const authUser = await authorizeSupportWrite(ctx, args.organizationId);

    const subject = validateSubject(args.subject);
    const description = validateOptionalText(
      args.description,
      SUPPORT_CASE_DESCRIPTION_MAX,
      'description_too_long',
    );
    const requesterEmail = validateOptionalText(
      args.requesterEmail,
      SUPPORT_CASE_REQUESTER_EMAIL_MAX,
      'requester_email_too_long',
    );
    const requesterName = validateOptionalText(
      args.requesterName,
      SUPPORT_CASE_REQUESTER_NAME_MAX,
      'requester_name_too_long',
    );
    // Assignee is polymorphic and set/cleared together (mirrors `tasks`).
    if ((args.assigneeType === undefined) !== (args.assigneeId === undefined)) {
      throw new ConvexError({
        code: 'invalid_assignee',
        message: 'assigneeType and assigneeId must be set together.',
      });
    }

    // Validate the linked customer is in the same org (no cross-org linkage).
    if (args.customerId) {
      const customer = await ctx.db.get(args.customerId);
      if (!customer || customer.organizationId !== args.organizationId) {
        throw new ConvexError({
          code: 'invalid_customer',
          message: 'Customer not found in this organization.',
        });
      }
    }

    const now = Date.now();
    const caseId = await ctx.db.insert('supportCases', {
      organizationId: args.organizationId,
      subject,
      description,
      status: 'open',
      priority: args.priority,
      escalationLevel: 0,
      assigneeType: args.assigneeType,
      assigneeId: args.assigneeId,
      customerId: args.customerId,
      requesterEmail,
      requesterName,
      slaDueAt: args.slaDueAt,
      commentCount: 0,
      statusChangedAt: now,
      createdBy: authUser.userId,
      createdByType: 'user',
      createdAt: now,
      updatedAt: now,
    });

    await recordCaseActivity(ctx, {
      organizationId: args.organizationId,
      caseId,
      actorType: 'user',
      actorId: authUser.userId,
      action: 'created',
      toValue: 'open',
      at: now,
    });

    return { caseId };
  },
});

/**
 * Manage a case: update any of subject / description / priority / status /
 * assignee / SLA. Only the provided fields change. Status and
 * assignee changes are recorded on the activity timeline and stamp the
 * corresponding lifecycle timestamps.
 */
export const updateCase = mutation({
  args: {
    organizationId: v.string(),
    caseId: v.id('supportCases'),
    subject: v.optional(v.string()),
    description: v.optional(v.string()),
    priority: v.optional(supportCasePriorityValidator),
    status: v.optional(supportCaseStatusValidator),
    slaDueAt: v.optional(v.number()),
    // Assignee: pass both to (re)assign, or `assigneeType: 'none'` to unassign.
    assignee: v.optional(
      v.union(
        v.object({
          type: supportCaseActorTypeValidator,
          id: v.string(),
        }),
        v.object({ type: v.literal('none') }),
      ),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await authorizeSupportWrite(ctx, args.organizationId);
    const supportCase = await requireCaseInOrg(
      ctx,
      args.caseId,
      args.organizationId,
    );

    const now = Date.now();
    const patch: Record<string, unknown> = { updatedAt: now };

    if (args.subject !== undefined) {
      patch.subject = validateSubject(args.subject);
    }
    if (args.description !== undefined) {
      patch.description = validateOptionalText(
        args.description,
        SUPPORT_CASE_DESCRIPTION_MAX,
        'description_too_long',
      );
    }
    if (args.priority !== undefined) patch.priority = args.priority;
    if (args.slaDueAt !== undefined) patch.slaDueAt = args.slaDueAt;

    // Status transition: stamp lifecycle timestamps + record activity.
    if (args.status !== undefined && args.status !== supportCase.status) {
      patch.status = args.status;
      patch.statusChangedAt = now;
      // Stamp the timestamp the new state owns and clear the ones that no longer
      // apply, so SLA reporting stays honest on every transition (including
      // `closed → resolved`, which must drop the stale `closedAt`).
      if (args.status === 'resolved') {
        patch.resolvedAt = now;
        patch.closedAt = undefined;
      } else if (args.status === 'closed') {
        patch.closedAt = now;
      } else {
        // Reopening (open / pending) clears both terminal timestamps.
        patch.resolvedAt = undefined;
        patch.closedAt = undefined;
      }
      await recordCaseActivity(ctx, {
        organizationId: args.organizationId,
        caseId: args.caseId,
        actorType: 'user',
        actorId: authUser.userId,
        action: 'status_changed',
        fromValue: supportCase.status,
        toValue: args.status,
        at: now,
      });
    }

    // Assignee (re)assignment / unassignment, recorded on the timeline.
    if (args.assignee !== undefined) {
      const prev = supportCase.assigneeId;
      if (args.assignee.type === 'none') {
        patch.assigneeType = undefined;
        patch.assigneeId = undefined;
      } else {
        patch.assigneeType = args.assignee.type;
        patch.assigneeId = args.assignee.id;
      }
      const next = args.assignee.type === 'none' ? undefined : args.assignee.id;
      if (prev !== next) {
        await recordCaseActivity(ctx, {
          organizationId: args.organizationId,
          caseId: args.caseId,
          actorType: 'user',
          actorId: authUser.userId,
          action: 'assignee_changed',
          fromValue: prev,
          toValue: next,
          at: now,
        });
      }
    }

    await ctx.db.patch(args.caseId, patch);
    return null;
  },
});

/**
 * Escalate a case: bump the escalation level by one and stamp `escalatedAt`.
 * Escalation is orthogonal to status — an escalated case stays `open`. An
 * optional `note` is posted as an internal comment so the reason is captured.
 */
export const escalateCase = mutation({
  args: {
    organizationId: v.string(),
    caseId: v.id('supportCases'),
    note: v.optional(v.string()),
  },
  returns: v.object({ escalationLevel: v.number() }),
  handler: async (ctx, args): Promise<{ escalationLevel: number }> => {
    const authUser = await authorizeSupportWrite(ctx, args.organizationId);
    const supportCase = await requireCaseInOrg(
      ctx,
      args.caseId,
      args.organizationId,
    );
    if (supportCase.status === 'closed') {
      throw new ConvexError({
        code: 'case_closed',
        message: 'A closed case cannot be escalated; reopen it first.',
      });
    }

    const now = Date.now();
    const fromLevel = supportCase.escalationLevel ?? 0;
    const toLevel = fromLevel + 1;

    await ctx.db.patch(args.caseId, {
      escalationLevel: toLevel,
      escalatedAt: now,
      updatedAt: now,
    });

    const note = validateOptionalText(
      args.note,
      SUPPORT_CASE_COMMENT_MAX,
      'note_too_long',
    );
    if (note) {
      await ctx.db.insert('supportCaseComments', {
        organizationId: args.organizationId,
        caseId: args.caseId,
        authorType: 'user',
        authorId: authUser.userId,
        body: note,
        internal: true,
        createdAt: now,
      });
      await ctx.db.patch(args.caseId, {
        commentCount: (supportCase.commentCount ?? 0) + 1,
      });
    }

    await recordCaseActivity(ctx, {
      organizationId: args.organizationId,
      caseId: args.caseId,
      actorType: 'user',
      actorId: authUser.userId,
      action: 'escalated',
      fromValue: String(fromLevel),
      toValue: String(toLevel),
      at: now,
    });

    return { escalationLevel: toLevel };
  },
});

/** Post a comment on a case (customer-visible by default; `internal` for a
 * staff-only note). Maintains the denormalized `commentCount` and stamps
 * `firstRespondedAt` on the first staff reply. */
export const addComment = mutation({
  args: {
    organizationId: v.string(),
    caseId: v.id('supportCases'),
    body: v.string(),
    internal: v.optional(v.boolean()),
  },
  returns: v.object({ commentId: v.id('supportCaseComments') }),
  handler: async (
    ctx,
    args,
  ): Promise<{ commentId: Id<'supportCaseComments'> }> => {
    const authUser = await authorizeSupportWrite(ctx, args.organizationId);
    const supportCase = await requireCaseInOrg(
      ctx,
      args.caseId,
      args.organizationId,
    );

    const body = validateCommentBody(args.body);

    const now = Date.now();
    const commentId = await ctx.db.insert('supportCaseComments', {
      organizationId: args.organizationId,
      caseId: args.caseId,
      authorType: 'user',
      authorId: authUser.userId,
      body,
      internal: args.internal,
      createdAt: now,
    });

    const patch: Record<string, unknown> = {
      commentCount: (supportCase.commentCount ?? 0) + 1,
      updatedAt: now,
    };
    // A public reply on a case that hasn't been responded to yet sets the SLA
    // first-response milestone.
    if (!args.internal && supportCase.firstRespondedAt === undefined) {
      patch.firstRespondedAt = now;
    }
    await ctx.db.patch(args.caseId, patch);

    return { commentId };
  },
});

/** Edit a comment's body. Only the author may edit. */
export const editComment = mutation({
  args: {
    organizationId: v.string(),
    commentId: v.id('supportCaseComments'),
    body: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await authorizeSupportWrite(ctx, args.organizationId);
    const comment = await ctx.db.get(args.commentId);
    if (!comment || comment.organizationId !== args.organizationId) {
      throw new ConvexError({
        code: 'not_found',
        message: 'Comment not found.',
      });
    }
    if (comment.authorId !== authUser.userId) {
      throw new ConvexError({
        code: 'forbidden',
        message: 'Only the author can edit this comment.',
      });
    }
    const body = validateCommentBody(args.body);
    await ctx.db.patch(args.commentId, { body, editedAt: Date.now() });
    return null;
  },
});

/** Delete a comment (hard delete) and decrement the case's `commentCount`.
 * Only the author may delete. */
export const deleteComment = mutation({
  args: {
    organizationId: v.string(),
    commentId: v.id('supportCaseComments'),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await authorizeSupportWrite(ctx, args.organizationId);
    const comment = await ctx.db.get(args.commentId);
    if (!comment || comment.organizationId !== args.organizationId) {
      throw new ConvexError({
        code: 'not_found',
        message: 'Comment not found.',
      });
    }
    if (comment.authorId !== authUser.userId) {
      throw new ConvexError({
        code: 'forbidden',
        message: 'Only the author can delete this comment.',
      });
    }
    const supportCase = await ctx.db.get(comment.caseId);
    await ctx.db.delete(args.commentId);
    if (supportCase) {
      await ctx.db.patch(comment.caseId, {
        commentCount: Math.max(0, (supportCase.commentCount ?? 0) - 1),
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});
