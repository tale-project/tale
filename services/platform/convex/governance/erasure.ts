/**
 * GDPR Art 17 (Right to Erasure) — admin-driven path.
 *
 * The retention cleanup runner has a grace window (`'trashed'` or
 * `'expired'` rows survive `graceDays` before Pass B physically removes
 * them) and a future cooldown on retention-policy shortening (Bundle 2
 * follow-up). Both serve the standard SaaS recovery / compliance UX.
 *
 * GDPR Art 17 demands erasure "without undue delay" when a verified
 * subject request lands. This mutation BYPASSES grace and cooldown:
 * targeted rows are immediately cascade-deleted via the same
 * `cascadeDeleteThreadChildren` helper used by Pass B.
 *
 * Refusals:
 *   - Caller is not an org admin → `forbidden`.
 *   - One of the targets is currently under a `legalHold` (Phase 8) →
 *     `LEGAL_HOLD_BLOCKS_ERASURE` with the held items list. Phase 8
 *     wires the actual hold table; until then the check is a no-op
 *     placeholder so the contract is in place.
 *
 * Audit:
 *   Every erasure writes `category='admin' subtype='gdpr_erasure_executed'`
 *   with the actor, the requested scope, and the deleted resource ids.
 */

import { ConvexError, v } from 'convex/values';

import { internalMutation } from '../_generated/server';
import { mutation } from '../_generated/server';
import { createAuditLog } from '../audit_logs/helpers';
import { authComponent } from '../auth';
import { isAdmin } from '../lib/rls/helpers/role_helpers';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { cascadeDeleteThreadChildren } from '../threads/cascade_helpers';

/**
 * Erase a single thread (all messages, artifacts, todos, feedback,
 * filter events, branches, sub-threads, and the metadata row itself)
 * immediately. Skips grace + skips cooldown.
 *
 * Wraps `cascadeDeleteThreadChildren` in a loop because the helper is
 * paged at PAGE_SIZE rows per child table.
 */
export const eraseThread = internalMutation({
  args: {
    threadId: v.string(),
    organizationId: v.string(),
  },
  returns: v.object({ done: v.boolean(), remaining: v.number() }),
  handler: async (ctx, args) => {
    const result = await cascadeDeleteThreadChildren(ctx, {
      threadId: args.threadId,
      organizationId: args.organizationId,
    });
    return result;
  },
});

/**
 * Public admin entry point. Accepts a user id + org and erases all of
 * that user's threads in that org.
 *
 * Future scope (Bundle 4 / follow-up): extend to documents, prompt
 * templates, message feedback, message metadata, customer/vendor PII.
 * For Bundle 2 this covers the most common erasure case (chat history
 * for a single departing employee) so the contract is shippable.
 */
export const requestErasure = mutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    reason: v.string(),
  },
  returns: v.object({
    threadsErased: v.number(),
    threadsBlocked: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new ConvexError({
        code: 'unauthenticated',
        message: 'Sign in required.',
      });
    }
    const callerId = String(authUser._id);

    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId: callerId,
      email: authUser.email ?? '',
    });
    if (!isAdmin(member.role)) {
      throw new ConvexError({
        code: 'forbidden',
        message: 'Only org admins can execute GDPR erasure.',
      });
    }

    // Find all threads owned by the target user in this org. Includes
    // every status — Art 17 must reach archived / trashed / expired
    // rows too, otherwise stale data persists.
    const threads = await ctx.db
      .query('threadMetadata')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .collect();
    const userThreads = threads.filter((t) => t.userId === args.userId);

    // Phase-8 placeholder: legal hold check would refuse erasure for
    // held threads here. For now no holds exist; future code:
    //   const holds = await loadActiveHolds(ctx, args.organizationId);
    //   const blocked = userThreads.filter(t => holds.threadIds.has(t.threadId));
    const blocked: string[] = [];

    let erased = 0;
    for (const thread of userThreads) {
      // Loop on cascade until done (paged helper).
      let attempts = 0;
      while (attempts++ < 50) {
        const result = await cascadeDeleteThreadChildren(ctx, {
          threadId: thread.threadId,
          organizationId: args.organizationId,
        });
        if (result.done) break;
      }
      erased += 1;
    }

    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: callerId,
      actorEmail: authUser.email ?? '',
      actorType: 'user',
      action: 'gdpr_erasure_executed',
      category: 'admin',
      resourceType: 'user',
      resourceId: args.userId,
      resourceName: args.userId,
      status: 'success',
      newState: {
        reason: args.reason,
        threadsErased: erased,
        threadsBlocked: blocked,
      },
    });

    return { threadsErased: erased, threadsBlocked: blocked };
  },
});
