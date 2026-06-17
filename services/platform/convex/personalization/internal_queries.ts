import type { GenericQueryCtx } from 'convex/server';
import { v } from 'convex/values';

import { isRecord } from '../../lib/utils/type-utils';
import type { DataModel, Doc } from '../_generated/dataModel';
import { internalQuery } from '../_generated/server';
import { readConfigCacheRow } from '../lib/config_cache/read';

const MEMORY_INJECTION_LIMIT = 20;

type PersonalizationFeature = 'custom_instructions' | 'user_memories';

export interface PersonalizationGateResult {
  customInstructions: boolean;
  memories: boolean;
}

/**
 * Org-level default for a given personalization feature. Each feature
 * has its own `governancePolicies` row (`custom_instructions` or
 * `user_memories`), config shape `{ enabled: boolean }`. Missing,
 * disabled, or malformed → OFF.
 *
 * Defaults, not kill switches: a user with explicit
 * `userPreferences.customInstructionsEnabled` / `memoriesEnabled` of
 * `true` / `false` overrides this. See `evaluatePersonalizationGates`
 * for the full effective-state rules.
 */
async function isFeatureEnabledForOrg(
  ctx: GenericQueryCtx<DataModel>,
  organizationId: string,
  feature: PersonalizationFeature,
): Promise<boolean> {
  const policy = await readConfigCacheRow(
    ctx.db,
    organizationId,
    'governance',
    feature,
  );

  if (!policy || policy.enabled === false) return false;
  const config = policy.config;
  if (!isRecord(config)) return false;
  return config['enabled'] === true;
}

export async function isCustomInstructionsEnabledForOrg(
  ctx: GenericQueryCtx<DataModel>,
  organizationId: string,
): Promise<boolean> {
  return isFeatureEnabledForOrg(ctx, organizationId, 'custom_instructions');
}

export async function isMemoriesEnabledForOrg(
  ctx: GenericQueryCtx<DataModel>,
  organizationId: string,
): Promise<boolean> {
  return isFeatureEnabledForOrg(ctx, organizationId, 'user_memories');
}

function applyUserOverride(
  orgDefault: boolean,
  userExplicit: boolean | undefined,
): boolean {
  return userExplicit ?? orgDefault;
}

/**
 * Single source of truth for whether each personalization feature is
 * currently active for a given (user, org, thread). Returns an object
 * with one flag per feature; callers gate independently.
 *
 * Merge rules (per feature):
 *  - Org-level default: matching policy row (`custom_instructions` /
 *    `user_memories`).
 *  - Per-user override: `userPreferences.customInstructionsEnabled` /
 *    `memoriesEnabled` is tri-state.
 *      - `undefined` → follow org default
 *      - `true` / `false` → user explicitly opted in/out (for THAT
 *        feature only)
 *  - Thread-level hard veto: `threadMetadata.disablePersonalization ===
 *    true` (e.g. shared threads) overrides everything and disables
 *    BOTH features.
 *
 * Used by:
 *  - `buildUserPersonalization` (read-side via
 *    `getPersonalizationDataForInjection`)
 *  - `internal_actions.ts` (decides whether to attach `propose_memory`
 *    — gated on `memories`)
 *  - `writeProposal` (mutation defense-in-depth — gated on `memories`)
 *  - `personalization/queries.ts:isPersonalizationActiveForChat`
 *    (UI subscribes to know whether to render the inline pending card)
 *
 * Caller must pass an explicit (userId, organizationId, threadId) — no
 * client-supplied identity.
 */
export async function evaluatePersonalizationGates(
  ctx: GenericQueryCtx<DataModel>,
  args: { userId: string; organizationId: string; threadId?: string },
): Promise<PersonalizationGateResult> {
  const threadId = args.threadId;
  if (threadId) {
    const meta = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', threadId))
      .first();
    if (meta?.disablePersonalization === true) {
      return { customInstructions: false, memories: false };
    }
  }

  const prefs = await ctx.db
    .query('userPreferences')
    .withIndex('by_userId_organizationId', (q) =>
      q.eq('userId', args.userId).eq('organizationId', args.organizationId),
    )
    .first();

  const [orgCustom, orgMemories] = await Promise.all([
    isCustomInstructionsEnabledForOrg(ctx, args.organizationId),
    isMemoriesEnabledForOrg(ctx, args.organizationId),
  ]);

  return {
    customInstructions: applyUserOverride(
      orgCustom,
      prefs?.customInstructionsEnabled,
    ),
    memories: applyUserOverride(orgMemories, prefs?.memoriesEnabled),
  };
}

export const isPersonalizationActiveForChat = internalQuery({
  args: {
    userId: v.string(),
    organizationId: v.string(),
    threadId: v.string(),
  },
  handler: async (ctx, args): Promise<PersonalizationGateResult> =>
    evaluatePersonalizationGates(ctx, args),
});

interface PersonalizationData {
  // Effective state per feature after merging org default, user
  // override, and thread veto. Callers must consult the matching flag
  // before injecting or proposing.
  customInstructionsEffective: boolean;
  memoriesEffective: boolean;
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
 * `customInstructionsEffective` / `memoriesEffective` are the same
 * answers `evaluatePersonalizationGates` would give for these args.
 * `preferences` is still returned even when both effective flags are
 * false so the caller can inspect `customInstructions` if needed.
 * `memories` is empty unless `memoriesEffective` is true.
 */
export const getPersonalizationDataForInjection = internalQuery({
  args: {
    userId: v.string(),
    organizationId: v.string(),
    threadId: v.string(),
  },
  handler: async (ctx, args): Promise<PersonalizationData> => {
    const gates = await evaluatePersonalizationGates(ctx, args);

    const preferences = await ctx.db
      .query('userPreferences')
      .withIndex('by_userId_organizationId', (q) =>
        q.eq('userId', args.userId).eq('organizationId', args.organizationId),
      )
      .first();

    if (!gates.memories) {
      return {
        customInstructionsEffective: gates.customInstructions,
        memoriesEffective: false,
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
      customInstructionsEffective: gates.customInstructions,
      memoriesEffective: true,
      preferences: preferences ?? null,
      memories,
    };
  },
});
