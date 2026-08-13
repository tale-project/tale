/**
 * Per-user notification preferences (tri-state: undefined → system default ON).
 *
 * `taskReview` is the odd one out: it's a human-in-the-loop safety signal,
 * so the settings UI locks its toggle always-on and both notification
 * dispatch paths ignore whatever is stored for it (#2651 — see
 * `notify.ts::isAllowed` / `notify_task_reviews.ts::prefAllows`).
 * `setNotificationPreferences` mirrors that on the write side: it never
 * persists a client-supplied value for `taskReview`, so a stale `false` row
 * (written by a direct/legacy caller that predates the lock, or one that
 * still sends it) can't be written or re-accumulated — the field is simply
 * dropped from every patch/insert, which also self-heals any existing
 * stale row on its next write. No migration needed since the stored value
 * is never read.
 */

import { v } from 'convex/values';

import { mutation, query } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';

const prefsValidator = v.object({
  taskAssigned: v.optional(v.boolean()),
  taskStatusChanged: v.optional(v.boolean()),
  taskCommented: v.optional(v.boolean()),
  mention: v.optional(v.boolean()),
  taskDeadlines: v.optional(v.boolean()),
  taskReview: v.optional(v.boolean()),
  escalation: v.optional(v.boolean()),
  automationAlerts: v.optional(v.boolean()),
  // RETIRED — the workforce digest emitter and its Settings toggle are gone;
  // accepted + returned only while stored rows drain (0.3.5 ships the strip
  // migration and drops it here and from the table schema).
  digest: v.optional(v.boolean()),
  conversationMessages: v.optional(v.boolean()),
  actionableEmail: v.optional(v.boolean()),
});

export const getNotificationPreferences = query({
  args: { organizationId: v.string() },
  returns: prefsValidator,
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');
    const member = await getOrganizationMember(
      ctx,
      args.organizationId,
      authUser,
    );
    const row = await ctx.db
      .query('notificationPreferences')
      .withIndex('by_userId_organizationId', (q) =>
        q.eq('userId', member.userId).eq('organizationId', args.organizationId),
      )
      .first();
    return {
      taskAssigned: row?.taskAssigned,
      taskStatusChanged: row?.taskStatusChanged,
      taskCommented: row?.taskCommented,
      mention: row?.mention,
      taskDeadlines: row?.taskDeadlines,
      taskReview: row?.taskReview,
      escalation: row?.escalation,
      automationAlerts: row?.automationAlerts,
      digest: row?.digest,
      conversationMessages: row?.conversationMessages,
      actionableEmail: row?.actionableEmail,
    };
  },
});

export const setNotificationPreferences = mutation({
  args: {
    organizationId: v.string(),
    taskAssigned: v.optional(v.boolean()),
    taskStatusChanged: v.optional(v.boolean()),
    taskCommented: v.optional(v.boolean()),
    mention: v.optional(v.boolean()),
    taskDeadlines: v.optional(v.boolean()),
    taskReview: v.optional(v.boolean()),
    escalation: v.optional(v.boolean()),
    automationAlerts: v.optional(v.boolean()),
    digest: v.optional(v.boolean()),
    conversationMessages: v.optional(v.boolean()),
    actionableEmail: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');
    const member = await getOrganizationMember(
      ctx,
      args.organizationId,
      authUser,
    );
    const existing = await ctx.db
      .query('notificationPreferences')
      .withIndex('by_userId_organizationId', (q) =>
        q.eq('userId', member.userId).eq('organizationId', args.organizationId),
      )
      .first();
    const patch = {
      taskAssigned: args.taskAssigned,
      taskStatusChanged: args.taskStatusChanged,
      taskCommented: args.taskCommented,
      mention: args.mention,
      taskDeadlines: args.taskDeadlines,
      // Never persist a client-supplied `taskReview` value (#2651): the
      // toggle is locked always-on in the UI and both dispatch paths ignore
      // whatever is stored, so accepting-but-dropping it here is what keeps
      // a direct/legacy write from (re-)creating a stale `false` row.
      taskReview: undefined,
      escalation: args.escalation,
      automationAlerts: args.automationAlerts,
      digest: args.digest,
      conversationMessages: args.conversationMessages,
      actionableEmail: args.actionableEmail,
      updatedAt: Date.now(),
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert('notificationPreferences', {
        userId: member.userId,
        organizationId: args.organizationId,
        ...patch,
      });
    }
    return null;
  },
});
