import { v } from 'convex/values';

import { query } from '../_generated/server';
import { assertSelfAndOrgMember } from '../lib/rls/auth/assert_self_and_org_member';
import { canAccessThread } from '../lib/rls/auth/can_access_thread';
import { requireAuthenticatedUser } from '../lib/rls/auth/require_authenticated_user';
import {
  evaluatePersonalizationGates,
  isPersonalizationEnabled,
} from './internal_queries';

/**
 * UI-side reactive query: is personalization currently active for this
 * thread? The chat panel uses this to decide whether to render the
 * inline pending-memory section. Mirrors the same gate the server
 * applies on read (`buildUserPersonalization`) and write
 * (`writeProposal`) paths so all three observe identical behavior.
 *
 * Auth: caller must own the thread AND be a current member of the
 * thread's org. Returns false on any miss (never throws — the chat UI
 * treats false as "don't render the section").
 */
export const isPersonalizationActiveForChat = query({
  args: {
    threadId: v.string(),
  },
  handler: async (ctx, args): Promise<boolean> => {
    const authUser = await requireAuthenticatedUser(ctx);
    const meta = await canAccessThread(ctx, args.threadId, authUser);
    if (!meta || meta.userId !== authUser.userId) return false;
    const orgId = meta.organizationId;
    if (!orgId) return false;
    await assertSelfAndOrgMember(ctx, authUser, authUser.userId, orgId);

    return evaluatePersonalizationGates(ctx, {
      userId: authUser.userId,
      organizationId: orgId,
      threadId: args.threadId,
    });
  },
});

/**
 * Org-level default for personalization. Any current org member may
 * read this — it's not user-private, just the policy row's `enabled`
 * flag. The settings page subscribes for the "following org default"
 * hint shown next to the per-user toggle.
 */
export const getOrgDefault = query({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args): Promise<boolean> => {
    const authUser = await requireAuthenticatedUser(ctx);
    await assertSelfAndOrgMember(
      ctx,
      authUser,
      authUser.userId,
      args.organizationId,
    );
    return isPersonalizationEnabled(ctx, args.organizationId);
  },
});
