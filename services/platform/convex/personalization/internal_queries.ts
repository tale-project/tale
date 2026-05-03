import type { GenericQueryCtx } from 'convex/server';
import { v } from 'convex/values';

import { isRecord } from '../../lib/utils/type-guards';
import type { DataModel, Doc } from '../_generated/dataModel';
import { internalQuery } from '../_generated/server';

const MEMORY_INJECTION_LIMIT = 20;

/**
 * Org-level default for personalization. Read from the dedicated
 * `policyType: 'personalization'` row in `governancePolicies` (config
 * shape `{ enabled: boolean }`). When the row is missing, disabled, or
 * malformed, the default is OFF.
 *
 * This is a *default*, not a kill switch: a user with explicit
 * `userPreferences.enabled === true/false` overrides this value. See
 * `evaluatePersonalizationGates` for the full effective-state rules.
 */
export async function isPersonalizationEnabled(
  ctx: GenericQueryCtx<DataModel>,
  organizationId: string,
): Promise<boolean> {
  const policy = await ctx.db
    .query('governancePolicies')
    .withIndex('by_org_policyType', (q) =>
      q
        .eq('organizationId', organizationId)
        .eq('policyType', 'personalization'),
    )
    .first();

  if (!policy || policy.enabled === false) return false;
  const config = policy.config;
  if (!isRecord(config)) return false;
  return config['enabled'] === true;
}

/**
 * Single source of truth for whether personalization is currently active
 * for a given (user, org, thread). Computes the effective state from:
 *
 *  - Org-level default: `policyType: 'personalization'` row.
 *  - Per-user override: `userPreferences.enabled` is tri-state.
 *      - `undefined` → follow org default
 *      - `true` / `false` → user explicitly opted in/out
 *  - Thread-level hard veto: `threadMetadata.disablePersonalization === true`
 *    (e.g. shared threads) overrides everything else.
 *
 * Used by:
 *  - `buildUserPersonalization` (read-side via getPersonalizationDataForInjection)
 *  - `internal_actions.ts` (decides whether to attach propose_memory)
 *  - `writeProposal` (mutation defense-in-depth)
 *  - `personalization/queries.ts:isPersonalizationActiveForChat`
 *    (UI subscribes to know whether to render the inline pending card)
 *
 * Caller must pass an explicit (userId, organizationId, threadId) — no
 * client-supplied identity.
 */
export async function evaluatePersonalizationGates(
  ctx: GenericQueryCtx<DataModel>,
  args: { userId: string; organizationId: string; threadId?: string },
): Promise<boolean> {
  const threadId = args.threadId;
  if (threadId) {
    const meta = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', threadId))
      .first();
    if (meta?.disablePersonalization === true) return false;
  }

  const prefs = await ctx.db
    .query('userPreferences')
    .withIndex('by_userId_organizationId', (q) =>
      q.eq('userId', args.userId).eq('organizationId', args.organizationId),
    )
    .first();
  const userExplicit = prefs?.enabled;
  if (userExplicit === true) return true;
  if (userExplicit === false) return false;

  return isPersonalizationEnabled(ctx, args.organizationId);
}

export const isPersonalizationActiveForChat = internalQuery({
  args: {
    userId: v.string(),
    organizationId: v.string(),
    threadId: v.string(),
  },
  handler: async (ctx, args): Promise<boolean> =>
    evaluatePersonalizationGates(ctx, args),
});

interface PersonalizationData {
  // Effective state after merging org default, user override, and thread
  // veto. When false, the caller must skip injection regardless of the
  // other fields.
  effective: boolean;
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
 * `effective` is the same answer `evaluatePersonalizationGates` would
 * give for these arguments; the caller may bail early when it's false.
 * `preferences` is still returned even when `effective` is false so the
 * caller can inspect `customInstructions` if a future code path needs
 * it (currently it does not — the early-out covers all uses).
 */
export const getPersonalizationDataForInjection = internalQuery({
  args: {
    userId: v.string(),
    organizationId: v.string(),
    threadId: v.string(),
  },
  handler: async (ctx, args): Promise<PersonalizationData> => {
    const effective = await evaluatePersonalizationGates(ctx, args);

    const preferences = await ctx.db
      .query('userPreferences')
      .withIndex('by_userId_organizationId', (q) =>
        q.eq('userId', args.userId).eq('organizationId', args.organizationId),
      )
      .first();

    if (!effective) {
      return {
        effective: false,
        preferences: preferences ?? null,
        memories: [],
      };
    }

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
      effective: true,
      preferences: preferences ?? null,
      memories,
    };
  },
});
