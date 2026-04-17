import type { GenericQueryCtx } from 'convex/server';

import {
  DEFAULT_TWO_FACTOR_POLICY,
  type TwoFactorPolicyConfig,
} from '../../lib/shared/schemas/governance';
import { isRecord, getString } from '../../lib/utils/type-guards';
import { components } from '../_generated/api';
import type { DataModel } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import {
  getTwoFactorPolicy,
  mergeStrictestTwoFactorPolicy,
} from '../governance/helpers';

/**
 * Grace decision for a credential user on an enforced two_factor_policy.
 *
 * - 'ok': user is enrolled OR policy is not enforced OR user is SSO-exempt.
 * - 'grace': user is unenrolled but still within their grace window.
 * - 'blocked': user is unenrolled and past their grace window; sign-in must
 *   route to the enrollment wall.
 */
export type TwoFactorGraceDecision = 'ok' | 'grace' | 'blocked';

export interface TwoFactorEnforcementResult {
  decision: TwoFactorGraceDecision;
  /**
   * Proposed `user.twoFactorGraceUntil` to write when decision === 'grace'
   * and the column is currently null. The caller (after-hook) is
   * responsible for writing idempotently — never overwrite an existing
   * value. Null when no write is needed.
   */
  graceUntilToSet: number | null;
  /**
   * Strictest two-factor policy across the user's orgs. Exposed for UI
   * banners that want to render remaining grace days.
   */
  policy: TwoFactorPolicyConfig;
}

interface AccountRow {
  providerId: string;
}

interface MemberRow {
  organizationId: string;
}

/** Fetch every account row for `userId` (typically ≤ a handful). */
async function findUserAccounts(
  ctx: QueryCtx | MutationCtx,
  userId: string,
): Promise<AccountRow[]> {
  const res = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'account',
    paginationOpts: { cursor: null, numItems: 50 },
    where: [{ field: 'userId', value: userId, operator: 'eq' }],
  });
  const out: AccountRow[] = [];
  for (const row of res?.page ?? []) {
    if (!isRecord(row)) continue;
    const providerId = getString(row, 'providerId');
    if (providerId) out.push({ providerId });
  }
  return out;
}

/** Fetch every organization membership for `userId`. */
async function findMemberOrgs(
  ctx: QueryCtx | MutationCtx,
  userId: string,
): Promise<MemberRow[]> {
  const res = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'member',
    paginationOpts: { cursor: null, numItems: 200 },
    where: [{ field: 'userId', value: userId, operator: 'eq' }],
  });
  const out: MemberRow[] = [];
  for (const row of res?.page ?? []) {
    if (!isRecord(row)) continue;
    const orgId = getString(row, 'organizationId');
    if (orgId) out.push({ organizationId: orgId });
  }
  return out;
}

/**
 * True iff the user has at least one credential (password) account. Used
 * to gate 2FA enforcement — SSO-only users are handled by the IdP.
 */
export function hasCredentialProvider(
  accounts: readonly AccountRow[],
): boolean {
  return accounts.some((a) => a.providerId === 'credential');
}

/**
 * Evaluate whether a user must be blocked / granted grace / passed through
 * on sign-in based on the strictest two_factor_policy across their orgs.
 *
 * Pure read when `user.twoFactorGraceUntil` is already set or when the
 * decision is 'ok'. When decision is 'grace' and the column is still
 * null, returns a `graceUntilToSet` timestamp the caller should persist
 * idempotently (never overwrite once set — that's the whole point of the
 * per-user anchor).
 *
 * Ctx accepts both query and mutation contexts — enforcement runs in an
 * after-hook which has mutation access; banners call this as a query.
 */
export async function evaluateTwoFactorEnforcement(
  ctx: GenericQueryCtx<DataModel>,
  args: {
    userId: string;
    twoFactorEnabled: boolean;
    twoFactorGraceUntil: number | null | undefined;
    now?: number;
  },
): Promise<TwoFactorEnforcementResult> {
  const now = args.now ?? Date.now();

  // Resolve strictest policy across all of the user's orgs.
  const orgs = await findMemberOrgs(ctx, args.userId);
  const policies = await Promise.all(
    orgs.map(({ organizationId }) => getTwoFactorPolicy(ctx, organizationId)),
  );
  const policy =
    policies.length === 0
      ? { ...DEFAULT_TWO_FACTOR_POLICY }
      : mergeStrictestTwoFactorPolicy(policies);

  if (!policy.enforced || args.twoFactorEnabled) {
    return { decision: 'ok', graceUntilToSet: null, policy };
  }

  // SSO-only users are exempt when policy permits. A user with BOTH a
  // credential and an SSO account still has a password bypass, so they
  // must enroll.
  if (policy.exemptSsoUsers) {
    const accounts = await findUserAccounts(ctx, args.userId);
    if (!hasCredentialProvider(accounts)) {
      return { decision: 'ok', graceUntilToSet: null, policy };
    }
  }

  const graceUntil = args.twoFactorGraceUntil ?? null;
  if (graceUntil === null) {
    // Policy enforcement first applies to this user right now — propose a
    // grace window. Caller writes idempotently.
    const toSet = now + policy.gracePeriodDays * 24 * 60 * 60 * 1000;
    // Fail-closed when grace is zero (immediate enforcement).
    if (policy.gracePeriodDays === 0) {
      return { decision: 'blocked', graceUntilToSet: null, policy };
    }
    return { decision: 'grace', graceUntilToSet: toSet, policy };
  }

  if (now >= graceUntil) {
    return { decision: 'blocked', graceUntilToSet: null, policy };
  }
  return { decision: 'grace', graceUntilToSet: null, policy };
}
