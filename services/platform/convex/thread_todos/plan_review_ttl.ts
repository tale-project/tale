import { saveMessage } from '@convex-dev/agent';
import { v } from 'convex/values';

import { components } from '../_generated/api';
import { internalMutation } from '../_generated/server';

const PLAN_REVIEW_TTL_MS = 30 * 60 * 1000;
const MAX_BATCH = 50;

/**
 * Cron: cancel pending `human_input_request` approvals older than 30 minutes
 * and post a graceful timeout message to the thread so the user is not left
 * staring at a stalled research run. Addresses the reliability invariant
 * "eventual completion" (plan §6g).
 */
export const expirePlanReviews = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - PLAN_REVIEW_TTL_MS;
    const query = ctx.db.query('approvals').withIndex('by_org_resourceType');

    let processed = 0;
    for await (const approval of query) {
      if (processed >= MAX_BATCH) break;
      if (approval.resourceType !== 'human_input_request') continue;
      if (approval.status !== 'pending') continue;
      if (approval._creationTime > cutoff) continue;

      await ctx.db.patch(approval._id, {
        status: 'rejected',
        reviewedAt: Date.now(),
        executionError: 'plan_review_timed_out',
      });

      if (approval.threadId) {
        try {
          await saveMessage(ctx, components.agent, {
            threadId: approval.threadId,
            message: {
              role: 'assistant',
              content:
                'Plan review timed out after 30 minutes of inactivity. The research run has been cancelled. Send a new message to start again.',
            },
          });
        } catch (err) {
          console.warn(
            '[expirePlanReviews] failed to write timeout message',
            err,
          );
        }
      }
      processed += 1;
    }
    return null;
  },
});
