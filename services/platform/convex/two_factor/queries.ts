/**
 * Public (authenticated-user-scoped) queries for the 2FA feature.
 * Mutations live in mutations.ts; internals (lockout counters, audit
 * helpers) live in internal_* modules.
 */

import { symmetricDecrypt } from 'better-auth/crypto';
import { v } from 'convex/values';

import { isRecord } from '../../lib/utils/type-guards';
import { components } from '../_generated/api';
import { query } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls';
import { evaluateTwoFactorEnforcement } from './helpers';

/**
 * Count the remaining backup codes for a user by reading the encrypted
 * `backupCodes` field on the twoFactor row and decrypting with
 * `BETTER_AUTH_SECRET` (the same key better-auth uses for
 * `symmetricEncrypt` on write). Returns `null` on any failure — the
 * low-backup-codes banner treats null as "unknown" and stays hidden,
 * so a decrypt miss degrades silently rather than throwing.
 */
async function countBackupCodes(encrypted: string): Promise<number | null> {
  const key = process.env.BETTER_AUTH_SECRET;
  if (!key) return null;
  try {
    const decrypted = await symmetricDecrypt({ key, data: encrypted });
    const parsed: unknown = JSON.parse(decrypted);
    return Array.isArray(parsed) ? parsed.length : null;
  } catch {
    return null;
  }
}

/**
 * Status for the current authenticated user. Drives the account-settings
 * enrollment UI and the dashboard grace banner.
 *
 *   - `twoFactorEnabled`: user has completed enrollment
 *   - `enforced`: strictest policy across the user's orgs demands 2FA
 *   - `decision`: 'ok' | 'grace' | 'blocked'
 *   - `graceUntil`: ms timestamp when grace expires (null if not in grace)
 *   - `hasCredential`: has at least one password account (drives SSO-only gate)
 *   - `backupCodesRemaining`: unused codes left in the user's backup pool,
 *     or null when 2FA is off / decryption failed. Drives the dashboard
 *     low-backup-codes nudge banner.
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
      backupCodesRemaining: v.union(v.number(), v.null()),
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

    // Surface remaining backup-code count so the dashboard can nudge
    // the user to regenerate when the pool runs low. Only meaningful
    // once the user has actually enrolled.
    let backupCodesRemaining: number | null = null;
    if (twoFactorEnabled) {
      const twoFactorRes = await ctx.runQuery(
        components.betterAuth.adapter.findMany,
        {
          model: 'twoFactor',
          paginationOpts: { cursor: null, numItems: 1 },
          where: [{ field: 'userId', value: authUser.userId, operator: 'eq' }],
        },
      );
      const row = twoFactorRes?.page?.[0];
      if (isRecord(row) && typeof row.backupCodes === 'string') {
        backupCodesRemaining = await countBackupCodes(row.backupCodes);
      }
    }

    return {
      authenticated: true as const,
      twoFactorEnabled,
      enforced: result.policy.enforced,
      decision: result.decision,
      // Surface the *effective* deadline (capped by current policy), not the
      // raw stored anchor — admin tightening must take effect immediately
      // for the UI countdown too, otherwise the banner contradicts the
      // enforcement decision.
      graceUntil: result.graceDeadline,
      hasCredential,
      exemptSsoUsers: result.policy.exemptSsoUsers,
      backupCodesRemaining,
    };
  },
});
