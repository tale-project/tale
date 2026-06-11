/**
 * Public (authenticated-user-scoped) queries for the 2FA feature.
 * Mutations live in mutations.ts; internals (lockout counters, audit
 * helpers) live in internal_* modules.
 */

import { symmetricDecrypt } from 'better-auth/crypto';
import { v, type Infer } from 'convex/values';

import { isRecord, getString } from '../../lib/utils/type-guards';
import { components } from '../_generated/api';
import { query, type QueryCtx } from '../_generated/server';
import { getAuthUserIdentity, type AuthenticatedUser } from '../lib/rls';
import { isAdmin } from '../lib/rls/helpers/role_helpers';
import {
  evaluateTwoFactorEnforcement,
  findCallerMembership,
  findMember,
  userHasPasskey,
} from './helpers';

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
 * Validator for the 2FA status payload. Exported so the consolidated
 * `getAccountBootstrap` query can reuse the exact same shape.
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
export const twoFactorStatusValidator = v.union(
  v.object({
    authenticated: v.literal(false),
  }),
  v.object({
    authenticated: v.literal(true),
    twoFactorEnabled: v.boolean(),
    hasPasskey: v.boolean(),
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
);

export type TwoFactorStatus = Infer<typeof twoFactorStatusValidator>;

/**
 * Compute the 2FA status for an already-resolved authenticated user (or the
 * unauthenticated shape when `authUser` is null). Extracted from `getStatus`
 * so the consolidated `getAccountBootstrap` query can return it inside the
 * same Convex transaction — no second WebSocket round-trip on cold load.
 *
 * The three independent reads (user row, accounts, passkey) run in parallel;
 * the enforcement decision and the backup-code count depend on their results
 * and stay sequenced.
 */
export async function computeTwoFactorStatus(
  ctx: QueryCtx,
  authUser: AuthenticatedUser | null,
): Promise<TwoFactorStatus> {
  if (!authUser) return { authenticated: false as const };

  const [userRes, accountsRes, hasPasskey] = await Promise.all([
    ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'user',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [{ field: '_id', value: authUser.userId, operator: 'eq' }],
    }),
    ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'account',
      paginationOpts: { cursor: null, numItems: 10 },
      where: [{ field: 'userId', value: authUser.userId, operator: 'eq' }],
    }),
    // A registered passkey (#1508) satisfies an enforced 2FA policy alongside
    // TOTP, so fold it into the enforcement decision and surface it to the UI.
    userHasPasskey(ctx, authUser.userId),
  ]);

  const userRow = userRes?.page?.[0];
  const twoFactorEnabled =
    isRecord(userRow) && userRow.twoFactorEnabled === true;
  const twoFactorGraceUntil =
    isRecord(userRow) && typeof userRow.twoFactorGraceUntil === 'number'
      ? userRow.twoFactorGraceUntil
      : null;

  const hasCredential = (accountsRes?.page ?? []).some(
    (row: unknown) => isRecord(row) && row.providerId === 'credential',
  );

  const result = await evaluateTwoFactorEnforcement(ctx, {
    userId: authUser.userId,
    twoFactorEnabled,
    twoFactorGraceUntil,
    hasPasskey,
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
    hasPasskey,
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
}

/**
 * Status for the current authenticated user. Drives the account-settings
 * enrollment UI and the dashboard grace banner. Thin wrapper over
 * {@link computeTwoFactorStatus}.
 */
export const getStatus = query({
  args: {},
  returns: twoFactorStatusValidator,
  handler: async (ctx) =>
    computeTwoFactorStatus(ctx, await getAuthUserIdentity(ctx)),
});

/**
 * Admin view of a member's registered passkeys (#1508). Drives the
 * list/revoke control in the member edit dialog so an admin can clean up
 * credentials when a device is lost or a member leaves with a synced
 * passkey still live.
 *
 * Authorization mirrors `revokePasskeyForMember`: lookup-then-check —
 * caller must be `owner` or `admin` in the SAME org as the target member.
 * Only display fields are returned; the credential public key and counter
 * never leave the server.
 */
export const listPasskeysForMember = query({
  args: { memberId: v.string() },
  returns: v.array(
    v.object({
      id: v.string(),
      name: v.union(v.string(), v.null()),
      deviceType: v.string(),
      backedUp: v.boolean(),
      createdAt: v.union(v.number(), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const member = await findMember(ctx, args.memberId);
    if (!member) throw new Error('Member not found');

    const callerMembership = await findCallerMembership(
      ctx,
      member.organizationId,
      authUser.userId,
    );
    if (!callerMembership || !isAdmin(callerMembership.role)) {
      throw new Error('Only admins can list passkeys for members');
    }

    const res = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'passkey',
      paginationOpts: { cursor: null, numItems: 50 },
      where: [{ field: 'userId', value: member.userId, operator: 'eq' }],
    });

    const passkeys: {
      id: string;
      name: string | null;
      deviceType: string;
      backedUp: boolean;
      createdAt: number | null;
    }[] = [];
    for (const row of res?.page ?? []) {
      if (!isRecord(row)) continue;
      const id = getString(row, '_id') ?? getString(row, 'id');
      if (!id) continue;
      passkeys.push({
        id,
        name: getString(row, 'name') ?? null,
        deviceType: getString(row, 'deviceType') ?? 'unknown',
        backedUp: row.backedUp === true,
        createdAt: typeof row.createdAt === 'number' ? row.createdAt : null,
      });
    }
    return passkeys;
  },
});
