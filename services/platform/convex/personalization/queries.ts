import { v } from 'convex/values';

import { query } from '../_generated/server';
import { assertSelfAndOrgMember } from '../lib/rls/auth/assert_self_and_org_member';
import { canAccessThread } from '../lib/rls/auth/can_access_thread';
import { requireAuthenticatedUser } from '../lib/rls/auth/require_authenticated_user';
import {
  evaluatePersonalizationGates,
  isCustomInstructionsEnabledForOrg,
  isMemoriesEnabledForOrg,
} from './internal_queries';

interface PersonalizationActiveResult {
  customInstructions: boolean;
  memories: boolean;
}

const INACTIVE: PersonalizationActiveResult = {
  customInstructions: false,
  memories: false,
};

/**
 * UI-side reactive query: which personalization features are currently
 * active for this thread? The chat panel uses the `memories` flag to
 * decide whether to subscribe to pending memory proposals. Mirrors the
 * same gate the server applies on read (`buildUserPersonalization`) and
 * write (`writeProposal`) paths so all three observe identical behavior.
 *
 * Auth: caller must own the thread AND be a current member of the
 * thread's org. Both checks live inside `canAccessThread`, which returns
 * `null` (not throws) for orphaned/non-member access — keeping this
 * handler's "never throws" contract the chat UI relies on.
 */
export const isPersonalizationActiveForChat = query({
  args: {
    threadId: v.string(),
    organizationId: v.string(),
  },
  handler: async (ctx, args): Promise<PersonalizationActiveResult> => {
    const authUser = await requireAuthenticatedUser(ctx);
    const meta = await canAccessThread(
      ctx,
      args.threadId,
      authUser,
      args.organizationId,
    );
    if (!meta || meta.userId !== authUser.userId) return INACTIVE;
    const orgId = meta.organizationId;
    if (!orgId) return INACTIVE;

    return evaluatePersonalizationGates(ctx, {
      userId: authUser.userId,
      organizationId: orgId,
      threadId: args.threadId,
    });
  },
});

/**
 * Org-level defaults for the two personalization features. Any current
 * org member may read this — it's not user-private, just the policy
 * rows' `enabled` flags. The settings page subscribes for the "following
 * org default" hint shown next to each per-user toggle.
 */
export const getOrgDefault = query({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args): Promise<PersonalizationActiveResult> => {
    const authUser = await requireAuthenticatedUser(ctx);
    await assertSelfAndOrgMember(
      ctx,
      authUser,
      authUser.userId,
      args.organizationId,
    );
    const [customInstructions, memories] = await Promise.all([
      isCustomInstructionsEnabledForOrg(ctx, args.organizationId),
      isMemoriesEnabledForOrg(ctx, args.organizationId),
    ]);
    return { customInstructions, memories };
  },
});
