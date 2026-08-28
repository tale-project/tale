import type { Sql, TransactionSql } from 'postgres';

import { normalizeAuthEmail } from '../../../convex/lib/auth/normalize_auth_email.ts';
import {
  splitEmailForAudit,
  splitIpForAudit,
} from '../../../convex/lib/helpers/pii_hash.ts';
import {
  computeLockedUntil,
  DEFAULT_LOGIN_POLICY,
  selectStrictestPolicy,
} from '../../../convex/login_attempts/helpers.ts';
import { getUserOrganizations } from '../../auth/membership.ts';
import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { writeNotificationForOrgs } from '../notifications/service.ts';

/**
 * Account lockout + block accounting for email/password sign-in. Ported from
 * `convex/login_attempts/*` with the policy math, PII hashing, and email
 * normalization REUSED from the 0.4 modules. The effective policy is the
 * strictest `login_policy` across the user's orgs, read straight from the
 * governance config files (the configCache mirror died — see lib/org-config).
 *
 * Every entry point takes a transaction: the auth hooks wrap each call in
 * `transactSerializable`, so counter update + audit rows + lockout
 * notification commit atomically.
 */

async function findUserByEmail(
  tx: TransactionSql,
  email: string,
): Promise<{ userId: string } | null> {
  const rows = await tx<{ id: string }[]>`
    SELECT "id" FROM "user" WHERE lower("email") = ${normalizeAuthEmail(email)}
    LIMIT 1
  `;
  const row = rows[0];
  return row ? { userId: row.id } : null;
}

async function resolveStrictestPolicy(
  tx: TransactionSql,
  organizationIds: string[],
) {
  if (organizationIds.length === 0) {
    return DEFAULT_LOGIN_POLICY;
  }
  const policies = await Promise.all(
    organizationIds.map(async (organizationId) => {
      const policy = await readGovernancePolicyForOrg(
        tx,
        organizationId,
        'login_policy',
      );
      return policy ?? DEFAULT_LOGIN_POLICY;
    }),
  );
  return selectStrictestPolicy(policies);
}

export interface RecordFailureResult {
  locked: boolean;
  lockedUntil: number | null;
}

/**
 * Record a failed sign-in for `email`: bump the counter, compute lockout
 * from the strictest applicable policy, write per-org audit rows, and (on
 * the first threshold crossing) notify org admins. Unknown emails are a
 * no-op — no row, no audit — to avoid enumeration and DoS amplification.
 */
export async function recordFailure(
  tx: TransactionSql,
  args: { email: string; ip?: string; userAgent?: string },
): Promise<RecordFailureResult> {
  const email = args.email.toLowerCase();
  const user = await findUserByEmail(tx, email);
  if (!user) {
    return { locked: false, lockedUntil: null };
  }

  const orgs = await getUserOrganizations(tx, user.userId);
  const policy = await resolveStrictestPolicy(
    tx,
    orgs.map((o) => o.organizationId),
  );
  if (!policy.enabled) {
    return { locked: false, lockedUntil: null };
  }

  const now = Date.now();
  const rows = await tx<{ consecutiveFailures: number }[]>`
    SELECT consecutive_failures AS "consecutiveFailures"
    FROM app.login_attempts WHERE email = ${email}
  `;
  const previousFailures = rows[0]?.consecutiveFailures ?? 0;
  const previouslyLocked = previousFailures >= policy.maxAttemptsBeforeLockout;

  const newFailures = previousFailures + 1;
  const lockedUntil = computeLockedUntil(newFailures, now, policy);
  const newlyLocked =
    !previouslyLocked && newFailures >= policy.maxAttemptsBeforeLockout;

  await tx`
    INSERT INTO app.login_attempts (
      email, consecutive_failures, last_failure_at, locked_until
    ) VALUES (${email}, ${newFailures}, ${now}, ${lockedUntil})
    ON CONFLICT (email) DO UPDATE SET
      consecutive_failures = ${newFailures},
      last_failure_at = ${now},
      locked_until = ${lockedUntil}
  `;

  const emailParts = await splitEmailForAudit(email);
  const ipParts = args.ip !== undefined ? await splitIpForAudit(args.ip) : {};
  const notifyEmail = emailParts.hash ?? emailParts.plaintext ?? email;
  const notifyIp = ipParts.hash ?? ipParts.plaintext ?? 'unknown';

  for (const { organizationId } of orgs) {
    await createAuditLog(tx, {
      organizationId,
      actorId: user.userId,
      ...(emailParts.plaintext !== undefined
        ? { actorEmail: emailParts.plaintext }
        : {}),
      ...(emailParts.hash !== undefined
        ? { actorEmailHash: emailParts.hash }
        : {}),
      actorType: 'user',
      action: 'login_attempt',
      category: 'security',
      resourceType: 'user',
      resourceId: user.userId,
      ...(ipParts.plaintext !== undefined
        ? { ipAddress: ipParts.plaintext }
        : {}),
      ...(ipParts.hash !== undefined ? { actorIpHash: ipParts.hash } : {}),
      ...(args.userAgent !== undefined ? { userAgent: args.userAgent } : {}),
      status: 'failure',
      errorMessage: 'Invalid credentials',
      metadata: {
        consecutiveFailures: newFailures,
        ...(lockedUntil !== null
          ? { lockedUntil: new Date(lockedUntil).toISOString() }
          : {}),
      },
    });

    if (newlyLocked) {
      await createAuditLog(tx, {
        organizationId,
        actorId: user.userId,
        ...(emailParts.plaintext !== undefined
          ? { actorEmail: emailParts.plaintext }
          : {}),
        ...(emailParts.hash !== undefined
          ? { actorEmailHash: emailParts.hash }
          : {}),
        actorType: 'system',
        action: 'login_lockout',
        category: 'security',
        resourceType: 'user',
        resourceId: user.userId,
        ...(ipParts.plaintext !== undefined
          ? { ipAddress: ipParts.plaintext }
          : {}),
        ...(ipParts.hash !== undefined ? { actorIpHash: ipParts.hash } : {}),
        ...(args.userAgent !== undefined ? { userAgent: args.userAgent } : {}),
        status: 'denied',
        errorMessage: 'Account temporarily locked due to repeated failures',
        metadata: {
          consecutiveFailures: newFailures,
          lockedUntil:
            lockedUntil !== null ? new Date(lockedUntil).toISOString() : null,
        },
      });
    }
  }

  if (newlyLocked && orgs.length > 0) {
    // Keys resolve against the client's `notifications` i18n namespace;
    // params mirror the audit chain's peppered shape (rows outlive the
    // 30-day loginAttempts window, so no raw PII).
    await writeNotificationForOrgs(tx, {
      organizationIds: orgs.map((o) => o.organizationId),
      category: 'security',
      severity: 'warning',
      titleKey: 'accountLocked',
      bodyKey: 'lockoutDetails',
      params: {
        email: notifyEmail,
        ip: notifyIp,
        consecutiveFailures: newFailures,
      },
      subjectUserId: user.userId,
      link: { kind: 'security-monitoring' },
    });
  }

  return { locked: lockedUntil !== null, lockedUntil };
}

const HOUR_MS = 3_600_000;

/**
 * Coalesce a before-hook rejection (lockout or IP flood) into the hourly
 * counter. Never touches the failure counter — the password check never ran.
 */
export async function recordBlocked(
  tx: TransactionSql,
  args: { email: string; ip?: string },
): Promise<void> {
  const email = args.email.toLowerCase();
  const user = await findUserByEmail(tx, email);
  if (!user) {
    return;
  }

  const rows = await tx<{ lockedUntil: number | null }[]>`
    SELECT locked_until::float8 AS "lockedUntil"
    FROM app.login_attempts WHERE email = ${email}
  `;
  const lockedUntil = rows[0]?.lockedUntil ?? null;
  const lockedActive = lockedUntil !== null && lockedUntil > Date.now();

  const now = Date.now();
  const windowStart = Math.floor(now / HOUR_MS) * HOUR_MS;
  await tx`
    INSERT INTO app.login_block_counters (
      email, window_start, lockout_count, ip_limit_count, last_ip, updated_at
    ) VALUES (
      ${email}, ${windowStart}, ${lockedActive ? 1 : 0},
      ${lockedActive ? 0 : 1}, ${args.ip ?? null}, ${now}
    )
    ON CONFLICT (email, window_start) DO UPDATE SET
      lockout_count = app.login_block_counters.lockout_count + ${lockedActive ? 1 : 0},
      ip_limit_count = app.login_block_counters.ip_limit_count + ${lockedActive ? 0 : 1},
      last_ip = coalesce(${args.ip ?? null}, app.login_block_counters.last_ip),
      updated_at = ${now}
  `;
}

/** Clear failure state on successful sign-in + write the success audit rows. */
export async function clearOnSuccess(
  tx: TransactionSql,
  args: { email: string; ip?: string; userAgent?: string },
): Promise<void> {
  const email = args.email.toLowerCase();
  await tx`DELETE FROM app.login_attempts WHERE email = ${email}`;

  const user = await findUserByEmail(tx, email);
  if (!user) {
    return;
  }

  const orgs = await getUserOrganizations(tx, user.userId);
  const emailParts = await splitEmailForAudit(email);
  const ipParts = args.ip !== undefined ? await splitIpForAudit(args.ip) : {};
  for (const { organizationId } of orgs) {
    await createAuditLog(tx, {
      organizationId,
      actorId: user.userId,
      ...(emailParts.plaintext !== undefined
        ? { actorEmail: emailParts.plaintext }
        : {}),
      ...(emailParts.hash !== undefined
        ? { actorEmailHash: emailParts.hash }
        : {}),
      actorType: 'user',
      action: 'login_success',
      category: 'security',
      resourceType: 'user',
      resourceId: user.userId,
      ...(ipParts.plaintext !== undefined
        ? { ipAddress: ipParts.plaintext }
        : {}),
      ...(ipParts.hash !== undefined ? { actorIpHash: ipParts.hash } : {}),
      ...(args.userAgent !== undefined ? { userAgent: args.userAgent } : {}),
      status: 'success',
    });
  }
}

/** Current lockout state for the before-hook gate. */
export async function getLockState(
  sql: Sql | TransactionSql,
  email: string,
): Promise<{ lockedUntil: number | null }> {
  const rows = await sql<{ lockedUntil: number | null }[]>`
    SELECT locked_until::float8 AS "lockedUntil"
    FROM app.login_attempts WHERE email = ${email.toLowerCase()}
  `;
  return { lockedUntil: rows[0]?.lockedUntil ?? null };
}
