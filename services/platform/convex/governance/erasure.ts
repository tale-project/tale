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
 *   - The org has an active org-wide legal hold OR any of the subject's
 *     threads is held → `LEGAL_HOLD_BLOCKS_ERASURE` with the held items
 *     list. GDPR Art 17(3)(e) explicitly carves out legal-claims
 *     preservation as an erasure exception, so we fail-closed: any hold
 *     on the subject's data refuses the entire request rather than
 *     proceeding with the unheld subset (which would silently spoliate
 *     held neighbors and confuse the eventual receipt).
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
import { loadActiveHolds } from './legal_hold';

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

    // Legal-hold gate. GDPR Art 17(3)(e) preserves data subject to legal
    // claims; FRCP 37(e) makes destruction during a preservation duty
    // sanctionable. Refuse the whole request when ANY of the subject's
    // threads is held (or the org is under a global hold) so the eventual
    // erasure receipt cannot lie about coverage.
    const holds = await loadActiveHolds(ctx, args.organizationId);
    const heldThreadIds: string[] = [];
    for (const t of userThreads) {
      if (holds.threadIds.has(t.threadId)) heldThreadIds.push(t.threadId);
    }
    if (holds.orgHeld || heldThreadIds.length > 0) {
      // Audit the refusal — compliance teams need a record of attempted
      // erasure that was blocked by an active hold.
      await createAuditLog(ctx, {
        organizationId: args.organizationId,
        actorId: callerId,
        actorEmail: authUser.email ?? '',
        actorType: 'user',
        action: 'gdpr_erasure_blocked_by_hold',
        category: 'admin',
        resourceType: 'user',
        resourceId: args.userId,
        resourceName: args.userId,
        status: 'failure',
        errorMessage: 'LEGAL_HOLD_BLOCKS_ERASURE',
        newState: {
          reason: args.reason,
          orgHeld: holds.orgHeld,
          heldThreadIds,
        },
      });
      throw new ConvexError({
        code: 'LEGAL_HOLD_BLOCKS_ERASURE',
        message: holds.orgHeld
          ? 'Org is under an active legal hold — release the hold before requesting erasure.'
          : 'One or more of the subject’s threads are under an active legal hold.',
        orgHeld: holds.orgHeld,
        heldThreadIds,
      });
    }

    let erased = 0;
    for (const thread of userThreads) {
      // Loop on cascade until done (paged helper).
      let attempts = 0;
      let cascadeDone = false;
      while (attempts++ < 50) {
        const result = await cascadeDeleteThreadChildren(ctx, {
          threadId: thread.threadId,
          organizationId: args.organizationId,
        });
        if (result.done) {
          cascadeDone = true;
          break;
        }
      }
      // Only count threads whose cascade actually completed. Partial
      // cascades (>50 pages of children remaining) leave residue and
      // must NOT be reported as erased — the receipt would lie.
      if (cascadeDone) erased += 1;
    }

    const partial = erased < userThreads.length;
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
      status: partial ? 'failure' : 'success',
      errorMessage: partial
        ? `Erasure incomplete: ${userThreads.length - erased} thread(s) hit cascade page-limit and need a follow-up run.`
        : undefined,
      newState: {
        reason: args.reason,
        threadsErased: erased,
        threadsTargeted: userThreads.length,
        threadsBlocked: heldThreadIds,
      },
    });

    return { threadsErased: erased, threadsBlocked: heldThreadIds };
  },
});
