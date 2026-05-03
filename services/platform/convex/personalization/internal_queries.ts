import type { GenericQueryCtx } from 'convex/server';
import { v } from 'convex/values';

import { isRecord } from '../../lib/utils/type-guards';
import type { DataModel, Doc } from '../_generated/dataModel';
import { internalQuery } from '../_generated/server';

const MEMORY_INJECTION_LIMIT = 20;

/**
 * Org-level kill switch: is personalization v1 turned on in the
 * `feature_flags` governance policy for this org? Convention is a
 * `personalization_v1: true` flag on the policy's `config` record.
 * Absent / disabled / wrong shape → false (default-off; orgs must
 * explicitly opt in).
 */
async function isPersonalizationEnabled(
  ctx: GenericQueryCtx<DataModel>,
  organizationId: string,
): Promise<boolean> {
  const policy = await ctx.db
    .query('governancePolicies')
    .withIndex('by_org_policyType', (q) =>
      q.eq('organizationId', organizationId).eq('policyType', 'feature_flags'),
    )
    .first();

  if (!policy || policy.enabled === false) return false;
  const config = policy.config;
  if (!isRecord(config)) return false;
  return config['personalization_v1'] === true;
}

interface PersonalizationData {
  orgEnabled: boolean;
  threadDisablePersonalization: boolean;
  preferences: Doc<'userPreferences'> | null;
  memories: Doc<'userMemories'>[];
}

/**
 * Internal query consumed by `buildUserPersonalization` from the chat
 * action context. Bypasses public auth (the caller is already a verified
 * action turn for this user) but is strictly scoped by the explicit
 * `(userId, organizationId)` arguments — there is no path here that
 * accepts a client-supplied identity.
 *
 * Returns:
 *  - orgEnabled: whether the org has opted into personalization_v1
 *  - preferences: the (userId, organizationId) row, or null
 *  - memories: up to 20 approved + not-soft-deleted + not-pending-expired
 *              rows, newest first
 */
export const getPersonalizationDataForInjection = internalQuery({
  args: {
    userId: v.string(),
    organizationId: v.string(),
    threadId: v.string(),
  },
  handler: async (ctx, args): Promise<PersonalizationData> => {
    const meta = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .first();
    const threadDisablePersonalization = meta?.disablePersonalization === true;

    const orgEnabled = await isPersonalizationEnabled(ctx, args.organizationId);
    if (!orgEnabled) {
      return {
        orgEnabled: false,
        threadDisablePersonalization,
        preferences: null,
        memories: [],
      };
    }

    const preferences = await ctx.db
      .query('userPreferences')
      .withIndex('by_userId_organizationId', (q) =>
        q.eq('userId', args.userId).eq('organizationId', args.organizationId),
      )
      .first();

    const candidates = await ctx.db
      .query('userMemories')
      .withIndex('by_user_org_status_deleted_created', (q) =>
        q
          .eq('userId', args.userId)
          .eq('organizationId', args.organizationId)
          .eq('status', 'approved'),
      )
      .order('desc')
      .take(MEMORY_INJECTION_LIMIT * 2);

    const memories = candidates
      .filter((m) => typeof m.deletedAt !== 'number')
      .slice(0, MEMORY_INJECTION_LIMIT);

    return {
      orgEnabled,
      threadDisablePersonalization,
      preferences: preferences ?? null,
      memories,
    };
  },
});
