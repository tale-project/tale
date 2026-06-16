import { saveMessage } from '@convex-dev/agent';
import { ConvexError, v } from 'convex/values';

import { isRecord } from '../../lib/utils/type-guards';
import { components } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import {
  internalMutation,
  type MutationCtx,
  mutation,
} from '../_generated/server';
import { canAccessThread } from '../lib/rls/auth/can_access_thread';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { startQueuedTurn } from '../threads/message_queue';

// The resumed turn's prompt AND its visible user bubble (honest transcript).
// English on purpose: it is agent input. `<reason>` is filled per-call.
function returnPrompt(reason: string): string {
  return (
    'Control of the browser has been returned to you. A human handled: ' +
    reason +
    '. The live browser is now at the resulting state — look at the page, ' +
    'verify the step is done, and continue the task.'
  );
}

// No-human fallback prompt: nobody took control within the park window.
function noHumanPrompt(reason: string): string {
  return (
    'No human was available to take control of the browser for: ' +
    reason +
    '. If you can complete the task without that browser step, proceed; ' +
    'otherwise stop and report that this step needs human assistance.'
  );
}

/** Resume the agent in the SAME Claude session after a handoff resolves. Shared
 * by the human return and the no-human auto-return: saves the visible user
 * bubble, enqueues it, and starts the turn through the queue idle path (which
 * `--resume`s the existing session). The browser state the human (or nobody)
 * left behind is recovered out-of-band — the headed Chromium is session-
 * persistent and the resumed turn reattaches to it over CDP. */
async function resumeAfterHandoff(
  ctx: MutationCtx,
  meta: Doc<'threadMetadata'>,
  args: {
    organizationId: string;
    agentSlug: string;
    userId: string;
    userEmail: string;
    userName: string;
    prompt: string;
  },
): Promise<void> {
  const now = Date.now();
  const { messageId } = await saveMessage(ctx, components.agent, {
    threadId: meta.threadId,
    message: { role: 'user', content: args.prompt },
  });
  await ctx.db.insert('chatMessageQueue', {
    organizationId: args.organizationId,
    threadId: meta.threadId,
    userId: args.userId,
    userEmail: args.userEmail,
    userName: args.userName,
    agentSlug: args.agentSlug,
    messageId,
    text: args.prompt,
    status: 'queued' as const,
    createdAt: now,
  });
  const queued = await ctx.db
    .query('chatMessageQueue')
    .withIndex('by_threadId_status', (q) =>
      q.eq('threadId', meta.threadId).eq('status', 'queued'),
    )
    .collect();
  await startQueuedTurn(ctx, meta, queued);
}

/**
 * Take control of the live browser for a pending handoff: claim the single-
 * controller lease so a `?control=1` screencast connection is authorized to the
 * WRITABLE x11vnc. Called by the screencast-auth oracle (http.ts) for a control
 * upgrade. v1 control boundary is the thread OWNER (stricter than the view
 * boundary — a writable browser is more powerful than a mirror), matching how
 * only the owner approves a plan. Idempotent for the same holder (reconnects
 * re-acquire); refuses a second concurrent controller.
 */
export const claimHumanControlLease = internalMutation({
  args: {
    threadId: v.string(),
    userId: v.string(),
  },
  returns: v.object({
    ok: v.boolean(),
    reason: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    // The caller (screencast-auth oracle) already ran the org-scoped
    // canAccessThread view boundary; here we derive everything from the thread
    // itself and additionally require OWNERSHIP for control.
    const meta = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .first();
    if (!meta) {
      return { ok: false, reason: 'no_thread' };
    }
    // Owner-only control in v1 (a shared viewer can watch, not drive).
    if (meta.userId !== args.userId) {
      return { ok: false, reason: 'forbidden' };
    }
    // Control is only meaningful while the agent has actually asked for it.
    const approval = await ctx.db
      .query('approvals')
      .withIndex('by_threadId_status_resourceType', (q) =>
        q
          .eq('threadId', args.threadId)
          .eq('status', 'pending')
          .eq('resourceType', 'external_agent_human_control'),
      )
      .first();
    if (!approval) {
      return { ok: false, reason: 'no_request' };
    }
    const metadata = isRecord(approval.metadata) ? approval.metadata : {};
    const holder =
      typeof metadata.controlHolderUserId === 'string'
        ? metadata.controlHolderUserId
        : undefined;
    if (holder !== undefined && holder !== args.userId) {
      return { ok: false, reason: 'held_by_other' };
    }
    if (holder !== args.userId) {
      await ctx.db.patch(approval._id, {
        metadata: { ...metadata, controlHolderUserId: args.userId },
      });
    }
    return { ok: true };
  },
});

/**
 * Return control to the agent (the human clicked "Return control" or closed the
 * pane). Resolves the handoff approval and resumes the same Claude session.
 * Owner-only + pending-only (Convex OCC on the approval row serializes this
 * against the no-human auto-return, so only one of them resumes the turn).
 */
export const returnHumanControl = mutation({
  args: {
    approvalId: v.id('approvals'),
    organizationId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({ code: 'UNAUTHENTICATED' });
    }
    const approval = await ctx.db.get(args.approvalId);
    if (
      !approval ||
      approval.organizationId !== args.organizationId ||
      approval.resourceType !== 'external_agent_human_control' ||
      approval.threadId === undefined
    ) {
      throw new ConvexError({ code: 'NOT_FOUND' });
    }
    if (approval.status !== 'pending') {
      // The no-human auto-return (or a double-click) already resolved it.
      throw new ConvexError({ code: 'ALREADY_RESOLVED' });
    }
    const meta = await canAccessThread(
      ctx,
      approval.threadId,
      authUser,
      args.organizationId,
    );
    if (!meta || meta.userId !== authUser.userId) {
      throw new ConvexError({ code: 'NOT_FOUND' });
    }
    if (meta.generationStatus === 'generating') {
      throw new ConvexError({ code: 'TURN_RUNNING' });
    }
    const metadata = isRecord(approval.metadata) ? approval.metadata : {};
    const agentSlug =
      typeof metadata.agentSlug === 'string'
        ? metadata.agentSlug
        : meta.agentSlug;
    if (agentSlug === undefined) {
      throw new ConvexError({ code: 'NOT_FOUND' });
    }
    const reason =
      typeof metadata.reason === 'string'
        ? metadata.reason
        : 'the browser step';

    const now = Date.now();
    await ctx.db.patch(approval._id, {
      status: 'completed',
      approvedBy: authUser.userId,
      reviewedAt: now,
      executedAt: now,
      metadata: { ...metadata, resolution: 'returned' },
    });
    await resumeAfterHandoff(ctx, meta, {
      organizationId: args.organizationId,
      agentSlug,
      userId: authUser.userId,
      userEmail: authUser.email ?? '',
      userName: authUser.name ?? '',
      prompt: returnPrompt(reason),
    });
    return null;
  },
});

/**
 * No-human fallback (scheduled by createHumanControlRequest). If the handoff is
 * still pending after the park window, resume the agent with a "nobody was
 * available" steer so an unattended (scheduled / always-on) run can't park
 * forever. A no-op if a human already returned control (status no longer
 * pending) — OCC serializes this against returnHumanControl.
 */
export const autoReturnHumanControl = internalMutation({
  args: {
    approvalId: v.id('approvals'),
    organizationId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const approval = await ctx.db.get(args.approvalId);
    if (
      !approval ||
      approval.organizationId !== args.organizationId ||
      approval.resourceType !== 'external_agent_human_control' ||
      approval.threadId === undefined ||
      approval.status !== 'pending'
    ) {
      // Already resolved (human returned control) or superseded — nothing to do.
      return null;
    }
    // Hoist out of the closure below: TS drops `approval.threadId` narrowing
    // inside the withIndex callback (property narrowing isn't kept across a
    // function boundary), but a local const carries it.
    const threadId = approval.threadId;
    const meta = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', threadId))
      .first();
    if (!meta) return null;
    // Don't resume on top of a live turn (defensive — a handoff turn is idle by
    // construction, but a recovery resume could have re-armed it).
    if (meta.generationStatus === 'generating') return null;

    const metadata = isRecord(approval.metadata) ? approval.metadata : {};
    const agentSlug =
      typeof metadata.agentSlug === 'string'
        ? metadata.agentSlug
        : meta.agentSlug;
    if (agentSlug === undefined) return null;
    const reason =
      typeof metadata.reason === 'string'
        ? metadata.reason
        : 'the browser step';
    const requestedBy =
      typeof metadata.requestedBy === 'string'
        ? metadata.requestedBy
        : (meta.userId ?? '');

    await ctx.db.patch(approval._id, {
      status: 'completed',
      reviewedAt: Date.now(),
      metadata: { ...metadata, resolution: 'no_human_timeout' },
    });
    await resumeAfterHandoff(ctx, meta, {
      organizationId: args.organizationId,
      agentSlug,
      userId: requestedBy,
      userEmail: '',
      userName: '',
      prompt: noHumanPrompt(reason),
    });
    return null;
  },
});
