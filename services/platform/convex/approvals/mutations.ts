import { saveMessage } from '@convex-dev/agent';
import { ConvexError, v } from 'convex/values';

import { isRecord } from '../../lib/utils/type-utils';
import { components, internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { mutation } from '../_generated/server';
import * as AuditLogHelpers from '../audit_logs/helpers';
import { pokeParkedRun } from '../automations/poke';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import * as ApprovalsHelpers from './helpers';
import { approvalStatusValidator } from './validators';

export const updateApprovalStatus = mutation({
  args: {
    approvalId: v.id('approvals'),
    status: approvalStatusValidator,
    comments: v.optional(v.string()),
    /** When true (reject + comments), triggers agent to respond with updated parameters */
    triggerAgentResponse: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({ code: 'UNAUTHENTICATED' });
    }

    const approval = await ctx.db.get(args.approvalId);
    if (!approval) {
      throw new ConvexError({ code: 'NOT_FOUND' });
    }

    // Review-gate rows are NOT generically completable: their respond
    // mutations carry the permission checks (document-write / project-edit),
    // the feedback-required rule, and the state transition itself — settling
    // one here would flip the approval row while the reviewed resource never
    // moves. Typed refusal pointing at the dedicated door.
    if (approval.resourceType === 'document_record_review') {
      throw new ConvexError({
        code: 'APPROVAL_REQUIRES_DEDICATED_RESPOND',
        message:
          'Controlled-record reviews are answered via documents.records.respondToDocumentRecordReview.',
        resourceType: approval.resourceType,
      });
    }
    if (approval.resourceType === 'task_review') {
      throw new ConvexError({
        code: 'APPROVAL_REQUIRES_DEDICATED_RESPOND',
        message:
          'Task reviews are answered via tasks.review_mutations.respondToTaskReview.',
        resourceType: approval.resourceType,
      });
    }

    await getOrganizationMember(ctx, approval.organizationId);

    const previousStatus = approval.status;

    await ApprovalsHelpers.updateApprovalStatus(ctx, {
      approvalId: args.approvalId,
      status: args.status,
      approvedBy: authUser.userId,
      comments: args.comments,
    });

    const action =
      args.status === 'executing' ? 'approve_request' : 'reject_request';

    await AuditLogHelpers.logSuccess(ctx, {
      auditCtx: {
        organizationId: approval.organizationId,
        actor: {
          id: authUser.userId,
          email: authUser.email,
          type: 'user',
        },
      },
      action,
      category: 'workflow',
      resourceType: 'approval',
      resourceId: String(args.approvalId),
      resourceName: approval.resourceType,
      previousState: { status: previousStatus },
      newState: { status: args.status, comments: args.comments },
    });

    // A workflow node parked behind this approval resumes NOW, approved or
    // rejected — the decision is the event; the run's own poll is only its
    // backstop. The gate row's metadata names the run; anything stale is a
    // silent no-op inside the poke.
    if (approval.resourceType === 'connector_operation') {
      const runId = isRecord(approval.metadata)
        ? approval.metadata.runId
        : undefined;
      if (typeof runId === 'string') {
        await pokeParkedRun(ctx, {
          organizationId: approval.organizationId,
          runId,
        });
      }
    }

    // GDPR Art 17 erasure-specific dispatch: when the approval flips to
    // `executing`, hand off to the cooling-off + scheduling path. The
    // erasure mutation enforces filer ≠ approver as a hard refusal
    // (defense-in-depth above this UI gate).
    if (args.status === 'executing' && approval.resourceType === 'erasure') {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- approvals.resourceId is `v.string()` for the generic table; for the 'erasure' resourceType it's always an Id<'gdprErasureRequests'>.
      const requestId = approval.resourceId as Id<'gdprErasureRequests'>;
      await ctx.runMutation(
        internal.governance.erasure.confirmAndScheduleErasure,
        { requestId, approverId: authUser.userId },
      );
    }

    // Write system message to thread on rejection (skip for feedback — the frontend
    // sends the user's feedback as a regular chat message instead)
    if (
      args.status === 'rejected' &&
      approval.threadId &&
      !args.triggerAgentResponse
    ) {
      const reason = args.comments
        ? `Reason: ${args.comments}`
        : 'No reason provided.';
      await saveMessage(ctx, components.agent, {
        threadId: approval.threadId,
        message: {
          role: 'system',
          content: `[APPROVAL_REJECTED]\nThe user manually rejected the ${approval.resourceType.replace(/_/g, ' ')} request.\n${reason}\n\nInstructions:\n- Acknowledge that the user rejected this request\n- Do NOT speculate about technical errors or failures\n- Ask if they would like to try a different approach`,
        },
      });
    }

    return null;
  },
});

export const removeRecommendedProduct = mutation({
  args: {
    approvalId: v.id('approvals'),
    productId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({ code: 'UNAUTHENTICATED' });
    }

    const approval = await ctx.db.get(args.approvalId);
    if (!approval) {
      throw new ConvexError({ code: 'NOT_FOUND' });
    }

    await getOrganizationMember(ctx, approval.organizationId);

    await ApprovalsHelpers.removeRecommendedProduct(ctx, {
      approvalId: args.approvalId,
      productId: args.productId,
    });

    await AuditLogHelpers.logSuccess(ctx, {
      auditCtx: {
        organizationId: approval.organizationId,
        actor: {
          id: authUser.userId,
          email: authUser.email,
          type: 'user',
        },
      },
      action: 'remove_recommended_product',
      category: 'workflow',
      resourceType: 'approval',
      resourceId: String(args.approvalId),
      resourceName: approval.resourceType,
      metadata: { productId: args.productId },
    });

    return null;
  },
});
