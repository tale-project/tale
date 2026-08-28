import type { Sql, TransactionSql } from 'postgres';

import { mergeStrictestTwoFactorPolicy } from '../../../convex/governance/helpers.ts';
import {
  computeLockedUntil,
  DEFAULT_LOGIN_POLICY,
  selectStrictestPolicy,
} from '../../../convex/login_attempts/helpers.ts';
import { DEFAULT_TWO_FACTOR_POLICY } from '../../../lib/shared/schemas/governance.ts';
import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import { createAuditLog } from '../audit_logs/service.ts';

/**
 * Two-factor enforcement — the 0.5 twin of `convex/two_factor/*`:
 *
 *  - VERIFY LOCKOUT: failed TOTP / backup-code verifications count against
 *    a per-userId counter with the SAME backoff schedule as password
 *    lockouts (reused `computeLockedUntil` + strictest `login_policy`) —
 *    otherwise a caller who knows the password could brute-force the
 *    ~10^6 TOTP space freely.
 *  - ORG ENFORCEMENT: the strictest `two_factor_policy` across the user's
 *    orgs decides at sign-in — enrolled TOTP or a registered passkey
 *    satisfies it; SSO-only users are exempt when the policy permits; the
 *    grace anchor is set ONCE on first sign-in (stored app-side in
 *    `app.two_factor_grace` — the 0.4 user-row column moved off the Better
 *    Auth table) and later policy edits never reset a running clock;
 *    grace 0 fails closed.
 */

type Db = Sql | TransactionSql;

async function userOrgIds(db: Db, userId: string): Promise<string[]> {
  const rows = await db<{ organizationId: string }[]>`
    SELECT "organizationId" FROM "member" WHERE "userId" = ${userId}
  `;
  return rows.map((row) => row.organizationId);
}

async function strictestLoginPolicy(db: Db, userId: string) {
  const orgIds = await userOrgIds(db, userId);
  if (orgIds.length === 0) return DEFAULT_LOGIN_POLICY;
  const policies = await Promise.all(
    orgIds.map(async (organizationId) => {
      const policy = await readGovernancePolicyForOrg(
        db,
        organizationId,
        'login_policy',
      );
      return policy ?? DEFAULT_LOGIN_POLICY;
    }),
  );
  return selectStrictestPolicy(policies);
}

export async function getTwoFactorLockState(
  db: Db,
  userId: string,
): Promise<{ lockedUntil: number | null }> {
  const rows = await db<{ lockedUntil: number | null }[]>`
    SELECT locked_until_ms::float8 AS "lockedUntil"
    FROM app.two_factor_attempts WHERE user_id = ${userId}
  `;
  return { lockedUntil: rows[0]?.lockedUntil ?? null };
}

/** A failed TOTP / backup-code verification — bump, lock per the schedule,
 * audit per org. */
export async function recordTwoFactorFailure(
  sql: Sql,
  args: {
    userId: string;
    method: 'totp' | 'backup_code';
    ip?: string;
    userAgent?: string;
  },
): Promise<{ locked: boolean; lockedUntil: number | null }> {
  const policy = await strictestLoginPolicy(sql, args.userId);
  if (!policy.enabled) return { locked: false, lockedUntil: null };
  const now = Date.now();
  return sql.begin(async (tx) => {
    const rows = await tx<{ consecutiveFailures: number }[]>`
      SELECT consecutive_failures AS "consecutiveFailures"
      FROM app.two_factor_attempts WHERE user_id = ${args.userId}
      FOR UPDATE
    `;
    const newFailures = (rows[0]?.consecutiveFailures ?? 0) + 1;
    const lockedUntil = computeLockedUntil(newFailures, now, policy);
    await tx`
      INSERT INTO app.two_factor_attempts (
        user_id, consecutive_failures, last_failure_at_ms, locked_until_ms
      ) VALUES (${args.userId}, ${newFailures}, ${now}, ${lockedUntil})
      ON CONFLICT (user_id) DO UPDATE SET
        consecutive_failures = ${newFailures},
        last_failure_at_ms = ${now}, locked_until_ms = ${lockedUntil}
    `;
    const action =
      args.method === 'backup_code'
        ? '2fa_backup_code_failed'
        : '2fa_verify_failed';
    for (const organizationId of await userOrgIds(tx, args.userId)) {
      await createAuditLog(tx, {
        organizationId,
        actorId: args.userId,
        actorType: 'user',
        action,
        category: 'auth',
        resourceType: 'user',
        resourceId: args.userId,
        status: 'failure',
        ...(args.ip !== undefined ? { ipAddress: args.ip } : {}),
        ...(args.userAgent !== undefined ? { userAgent: args.userAgent } : {}),
        metadata: { consecutiveFailures: newFailures },
      });
    }
    return { locked: lockedUntil !== null, lockedUntil };
  });
}

/** A successful verification clears the counter. */
export async function recordTwoFactorSuccess(
  sql: Sql,
  userId: string,
): Promise<void> {
  await sql`DELETE FROM app.two_factor_attempts WHERE user_id = ${userId}`;
}

export interface TwoFactorEnforcement {
  decision: 'ok' | 'grace' | 'blocked';
  graceUntilToSet: number | null;
  graceDeadline: number | null;
}

/**
 * Resolve the enforcement decision for one user at sign-in time —
 * strictest policy across their orgs; TOTP OR a passkey satisfies it;
 * SSO-only users exempt when permitted; grace anchored once.
 */
export async function evaluateTwoFactorEnforcement(
  db: Db,
  userId: string,
): Promise<TwoFactorEnforcement> {
  const orgIds = await userOrgIds(db, userId);
  const policies = await Promise.all(
    orgIds.map(async (organizationId) => {
      const policy = await readGovernancePolicyForOrg(
        db,
        organizationId,
        'two_factor_policy',
      );
      return policy ?? DEFAULT_TWO_FACTOR_POLICY;
    }),
  );
  const policy =
    policies.length === 0
      ? { ...DEFAULT_TWO_FACTOR_POLICY }
      : mergeStrictestTwoFactorPolicy(policies);

  if (!policy.enforced) {
    return { decision: 'ok', graceUntilToSet: null, graceDeadline: null };
  }
  const users = await db<{ twoFactorEnabled: boolean | null }[]>`
    SELECT "twoFactorEnabled" FROM "user" WHERE "id" = ${userId} LIMIT 1
  `;
  if (users[0]?.twoFactorEnabled === true) {
    return { decision: 'ok', graceUntilToSet: null, graceDeadline: null };
  }
  // A registered passkey is a phishing-resistant second factor.
  const passkeys = await db<{ id: string }[]>`
    SELECT "id" FROM "passkey" WHERE "userId" = ${userId} LIMIT 1
  `;
  if (passkeys.length > 0) {
    return { decision: 'ok', graceUntilToSet: null, graceDeadline: null };
  }
  if (policy.exemptSsoUsers) {
    const accounts = await db<{ providerId: string }[]>`
      SELECT "providerId" FROM "account" WHERE "userId" = ${userId}
    `;
    const hasCredential = accounts.some(
      (account) => account.providerId === 'credential',
    );
    if (!hasCredential) {
      return { decision: 'ok', graceUntilToSet: null, graceDeadline: null };
    }
  }
  if (policy.gracePeriodDays === 0) {
    return { decision: 'blocked', graceUntilToSet: null, graceDeadline: null };
  }
  const now = Date.now();
  const cap = now + policy.gracePeriodDays * 24 * 60 * 60 * 1000;
  const anchors = await db<{ graceUntil: number }[]>`
    SELECT grace_until_ms::float8 AS "graceUntil"
    FROM app.two_factor_grace WHERE user_id = ${userId}
  `;
  const anchor = anchors[0]?.graceUntil ?? null;
  // A stored anchor is capped by the CURRENT policy — a shortened grace
  // takes effect immediately, a lengthened one never resets the clock.
  const deadline = anchor === null ? cap : Math.min(anchor, cap);
  if (deadline <= now) {
    return {
      decision: 'blocked',
      graceUntilToSet: null,
      graceDeadline: deadline,
    };
  }
  return {
    decision: 'grace',
    graceUntilToSet: anchor === null ? cap : null,
    graceDeadline: deadline,
  };
}

/** Persist the grace anchor idempotently (first sign-in only). */
export async function setGraceUntilIfAbsent(
  db: Db,
  userId: string,
  graceUntil: number,
): Promise<void> {
  await db`
    INSERT INTO app.two_factor_grace (user_id, grace_until_ms)
    VALUES (${userId}, ${graceUntil})
    ON CONFLICT (user_id) DO NOTHING
  `;
}

/** The settings/status read: the enforcement posture for one user. */
export async function getTwoFactorStatus(
  db: Db,
  userId: string,
): Promise<{
  enabled: boolean;
  hasPasskey: boolean;
  enforcement: TwoFactorEnforcement;
}> {
  const users = await db<{ twoFactorEnabled: boolean | null }[]>`
    SELECT "twoFactorEnabled" FROM "user" WHERE "id" = ${userId} LIMIT 1
  `;
  const passkeys = await db<{ id: string }[]>`
    SELECT "id" FROM "passkey" WHERE "userId" = ${userId} LIMIT 1
  `;
  return {
    enabled: users[0]?.twoFactorEnabled === true,
    hasPasskey: passkeys.length > 0,
    enforcement: await evaluateTwoFactorEnforcement(db, userId),
  };
}
