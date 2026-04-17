/**
 * Public (authenticated-user-scoped) queries for the 2FA feature.
 * Mutations live in mutations.ts; internals (lockout counters, audit
 * helpers) live in internal_* modules.
 */

import { v } from 'convex/values';

import { isRecord } from '../../lib/utils/type-guards';
import { components } from '../_generated/api';
import { query } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls';
import { evaluateTwoFactorEnforcement } from './helpers';

/**
 * Status for the current authenticated user. Drives the account-settings
 * enrollment UI and the dashboard grace banner.
 *
 *   - `twoFactorEnabled`: user has completed enrollment
 *   - `enforced`: strictest policy across the user's orgs demands 2FA
 *   - `decision`: 'ok' | 'grace' | 'blocked'
 *   - `graceUntil`: ms timestamp when grace expires (null if not in grace)
 *   - `hasCredential`: has at least one password account (drives SSO-only gate)
 */
export const getStatus = query({
  args: {},
  returns: v.union(
    v.object({
      authenticated: v.literal(false),
    }),
    v.object({
      authenticated: v.literal(true),
      twoFactorEnabled: v.boolean(),
      enforced: v.boolean(),
      decision: v.union(
        v.literal('ok'),
        v.literal('grace'),
        v.literal('blocked'),
      ),
      graceUntil: v.union(v.number(), v.null()),
      hasCredential: v.boolean(),
      exemptSsoUsers: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return { authenticated: false as const };

    const userRes = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'user',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [{ field: '_id', value: authUser.userId, operator: 'eq' }],
    });
    const userRow = userRes?.page?.[0];
    const twoFactorEnabled =
      isRecord(userRow) && userRow.twoFactorEnabled === true;
    const twoFactorGraceUntil =
      isRecord(userRow) && typeof userRow.twoFactorGraceUntil === 'number'
        ? userRow.twoFactorGraceUntil
        : null;

    const accountsRes = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model: 'account',
        paginationOpts: { cursor: null, numItems: 10 },
        where: [{ field: 'userId', value: authUser.userId, operator: 'eq' }],
      },
    );
    const hasCredential = (accountsRes?.page ?? []).some(
      (row: unknown) => isRecord(row) && row.providerId === 'credential',
    );

    const result = await evaluateTwoFactorEnforcement(ctx, {
      userId: authUser.userId,
      twoFactorEnabled,
      twoFactorGraceUntil,
    });

    return {
      authenticated: true as const,
      twoFactorEnabled,
      enforced: result.policy.enforced,
      decision: result.decision,
      graceUntil: twoFactorGraceUntil ?? result.graceUntilToSet,
      hasCredential,
      exemptSsoUsers: result.policy.exemptSsoUsers,
    };
  },
});
