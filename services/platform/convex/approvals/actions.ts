'use node';

import { ConvexError, v, type Infer } from 'convex/values';

import { jsonValueValidator } from '../../lib/shared/schemas/utils/json-value';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import { action } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import type { AuthenticatedUser } from '../lib/rls/types';

type JsonValue = Infer<typeof jsonValueValidator>;

async function verifyApprovalAccess(
  ctx: ActionCtx,
  approvalId: Id<'approvals'>,
  authUser: AuthenticatedUser,
) {
  const approval = await ctx.runQuery(
    internal.approvals.internal_queries.getApprovalById,
    { approvalId },
  );
  if (!approval) {
    throw new Error('Approval not found');
  }
  await ctx.runQuery(
    internal.approvals.internal_queries.verifyOrganizationMembership,
    {
      organizationId: approval.organizationId,
      userId: authUser.userId,
      // Pass identity email/name through as-is (optional). `?? ''` would
      // disable getOrganizationMember's email-fallback (empty string is falsy).
      email: authUser.email,
      name: authUser.name,
    },
  );
}

export const executeApprovedIntegrationOperation = action({
  args: {
    approvalId: v.id('approvals'),
  },
  returns: jsonValueValidator,
  handler: async (ctx, args): Promise<JsonValue> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    await verifyApprovalAccess(ctx, args.approvalId, authUser);

    // The executor for this approval type belongs to the retired AI backend.
    // Access checks above still ran; performing the operation is impossible
    // until the owning feature is rebuilt, so fail with a typed error the UI
    // can render instead of a generic crash.
    throw new ConvexError({
      code: 'FEATURE_OFFLINE',
      message:
        'This approval cannot be executed right now: the feature behind it is offline while the platform AI backend is rewritten.',
    });
  },
});

export const executeApprovedAutomationRun = action({
  args: {
    approvalId: v.id('approvals'),
  },
  returns: jsonValueValidator,
  handler: async (ctx, args): Promise<JsonValue> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    await verifyApprovalAccess(ctx, args.approvalId, authUser);

    // The executor for this approval type belongs to the retired AI backend.
    // Access checks above still ran; performing the operation is impossible
    // until the owning feature is rebuilt, so fail with a typed error the UI
    // can render instead of a generic crash.
    throw new ConvexError({
      code: 'FEATURE_OFFLINE',
      message:
        'This approval cannot be executed right now: the feature behind it is offline while the platform AI backend is rewritten.',
    });
  },
});

export const executeApprovedAutomationCreation = action({
  args: {
    approvalId: v.id('approvals'),
  },
  returns: jsonValueValidator,
  handler: async (ctx, args): Promise<JsonValue> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    await verifyApprovalAccess(ctx, args.approvalId, authUser);

    // The executor for this approval type belongs to the retired AI backend.
    // Access checks above still ran; performing the operation is impossible
    // until the owning feature is rebuilt, so fail with a typed error the UI
    // can render instead of a generic crash.
    throw new ConvexError({
      code: 'FEATURE_OFFLINE',
      message:
        'This approval cannot be executed right now: the feature behind it is offline while the platform AI backend is rewritten.',
    });
  },
});

export const executeApprovedDocumentWrite = action({
  args: {
    approvalId: v.id('approvals'),
  },
  returns: jsonValueValidator,
  handler: async (ctx, args): Promise<JsonValue> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    await verifyApprovalAccess(ctx, args.approvalId, authUser);

    // The executor for this approval type belongs to the retired AI backend.
    // Access checks above still ran; performing the operation is impossible
    // until the owning feature is rebuilt, so fail with a typed error the UI
    // can render instead of a generic crash.
    throw new ConvexError({
      code: 'FEATURE_OFFLINE',
      message:
        'This approval cannot be executed right now: the feature behind it is offline while the platform AI backend is rewritten.',
    });
  },
});

export const executeApprovedKnowledgeWrite = action({
  args: {
    approvalId: v.id('approvals'),
  },
  returns: jsonValueValidator,
  handler: async (ctx, args): Promise<JsonValue> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    await verifyApprovalAccess(ctx, args.approvalId, authUser);

    // The executor for this approval type belongs to the retired AI backend.
    // Access checks above still ran; performing the operation is impossible
    // until the owning feature is rebuilt, so fail with a typed error the UI
    // can render instead of a generic crash.
    throw new ConvexError({
      code: 'FEATURE_OFFLINE',
      message:
        'This approval cannot be executed right now: the feature behind it is offline while the platform AI backend is rewritten.',
    });
  },
});

export const executeApprovedAutomationUpdate = action({
  args: {
    approvalId: v.id('approvals'),
  },
  returns: jsonValueValidator,
  handler: async (ctx, args): Promise<JsonValue> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    await verifyApprovalAccess(ctx, args.approvalId, authUser);

    // The executor for this approval type belongs to the retired AI backend.
    // Access checks above still ran; performing the operation is impossible
    // until the owning feature is rebuilt, so fail with a typed error the UI
    // can render instead of a generic crash.
    throw new ConvexError({
      code: 'FEATURE_OFFLINE',
      message:
        'This approval cannot be executed right now: the feature behind it is offline while the platform AI backend is rewritten.',
    });
  },
});
