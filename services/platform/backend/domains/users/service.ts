import { transactSerializable } from '@tale/shared/db/serializable';
import { APIError } from 'better-auth/api';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import type { Sql, TransactionSql } from 'postgres';

import {
  isPasswordValid,
  passwordPolicyViolations,
} from '../../../lib/shared/schemas/password.ts';
import { getString, isRecord } from '../../../lib/utils/type-utils.ts';
import type { Auth } from '../../auth/auth.ts';
import {
  evaluateCredentialResetAuthority,
  findOrganizationMember,
  getUserOrganizations,
  isAdminRole,
} from '../../auth/membership.ts';
import { getStrictestPasswordPolicyForUser } from '../../lib/governance-policies.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { addMember } from '../members/service.ts';

/**
 * Users domain — account metadata, password lifecycle, changelog
 * acknowledgment. Ported from `convex/users/*`; every Better Auth
 * cross-component adapter round-trip became one local SQL statement, and
 * password mutations ride Better Auth's server API with the caller's real
 * request headers (no `authComponent.getAuth` bridging).
 */

export class UserServiceError extends Error {
  readonly code: string;
  readonly status: 400 | 401 | 403 | 404;

  constructor(code: string, message: string, status: 400 | 401 | 403 | 404) {
    super(message);
    this.name = 'UserServiceError';
    this.code = code;
    this.status = status;
  }
}

/** True when any user exists — drives the fresh-install → sign-up redirect. */
export async function hasAnyUsers(sql: Sql): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`SELECT "id" FROM "user" LIMIT 1`;
  return rows.length > 0;
}

/** Fresh profile fields from the user row (not the session snapshot). */
export async function getCurrentUser(
  sql: Sql,
  userId: string,
): Promise<{ userId: string; email?: string; name?: string } | null> {
  const rows = await sql<{ email: string | null; name: string | null }[]>`
    SELECT "email", "name" FROM "user" WHERE "id" = ${userId} LIMIT 1
  `;
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    userId,
    ...(row.email !== null ? { email: row.email } : {}),
    ...(row.name !== null ? { name: row.name } : {}),
  };
}

export async function getLastActiveOrganizationId(
  sql: Sql,
  userId: string,
): Promise<string | null> {
  const rows = await sql<{ lastActiveOrganizationId: string | null }[]>`
    SELECT "lastActiveOrganizationId" FROM "user"
    WHERE "id" = ${userId} LIMIT 1
  `;
  return rows[0]?.lastActiveOrganizationId ?? null;
}

/** Trimmed, length-capped display-name update on the Better Auth user row. */
export async function updateUserName(
  sql: Sql,
  userId: string,
  name: string,
): Promise<void> {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new UserServiceError('validation', 'Name is required', 400);
  }
  if (trimmed.length > 100) {
    throw new UserServiceError(
      'too_long',
      'Name must be 100 characters or less',
      400,
    );
  }
  await sql`
    UPDATE "user" SET "name" = ${trimmed}, "updatedAt" = ${new Date()}
    WHERE "id" = ${userId}
  `;
}

// ---------------------------------------------------------------------------
// Password metadata + expiry
// ---------------------------------------------------------------------------

/** Upsert the rotation anchor after a password set/change. */
export async function recordPasswordChange(
  tx: TransactionSql | Sql,
  userId: string,
  opts?: { forceChangeOnNextLogin?: boolean },
): Promise<void> {
  const forceChange = opts?.forceChangeOnNextLogin ?? false;
  await tx`
    INSERT INTO app.user_password_metadata (
      user_id, password_changed_at, force_change_on_next_login
    ) VALUES (${userId}, ${Date.now()}, ${forceChange})
    ON CONFLICT (user_id) DO UPDATE SET
      password_changed_at = ${Date.now()},
      force_change_on_next_login = ${forceChange}
  `;
}

async function hasCredentialAccount(
  sql: Sql | TransactionSql,
  userId: string,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    SELECT "id" FROM "account"
    WHERE "userId" = ${userId} AND "providerId" = 'credential'
    LIMIT 1
  `;
  return rows.length > 0;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PasswordExpiryStatus {
  expired: boolean;
  daysUntilExpiry: number | null;
  hasCredential: boolean;
  rotationEnabled: boolean;
  reason: 'admin_set' | 'rotation' | null;
}

/**
 * Password-expiry status: admin-forced change wins; otherwise the strictest
 * rotation policy across the user's orgs, anchored at
 * max(passwordChangedAt, policy effectiveAt).
 */
export async function computePasswordExpiry(
  sql: Sql,
  userId: string,
): Promise<PasswordExpiryStatus> {
  const notExpired: PasswordExpiryStatus = {
    expired: false,
    daysUntilExpiry: null,
    hasCredential: false,
    rotationEnabled: false,
    reason: null,
  };
  if (!(await hasCredentialAccount(sql, userId))) {
    return notExpired;
  }

  const metaRows = await sql<
    { passwordChangedAt: number; forceChangeOnNextLogin: boolean }[]
  >`
    SELECT password_changed_at::float8 AS "passwordChangedAt",
           force_change_on_next_login AS "forceChangeOnNextLogin"
    FROM app.user_password_metadata WHERE user_id = ${userId}
  `;
  const meta = metaRows[0];
  if (meta?.forceChangeOnNextLogin) {
    return {
      expired: true,
      daysUntilExpiry: 0,
      hasCredential: true,
      rotationEnabled: false,
      reason: 'admin_set',
    };
  }

  const orgs = await getUserOrganizations(sql, userId);
  const { policy, effectiveAt } = await getStrictestPasswordPolicyForUser(
    sql,
    orgs.map((o) => o.organizationId),
  );
  if (policy.rotationDays <= 0) {
    return { ...notExpired, hasCredential: true };
  }

  const anchor = Math.max(meta?.passwordChangedAt ?? 0, effectiveAt ?? 0);
  if (anchor === 0) {
    return {
      expired: false,
      daysUntilExpiry: null,
      hasCredential: true,
      rotationEnabled: true,
      reason: null,
    };
  }

  const expiresAt = anchor + policy.rotationDays * DAY_MS;
  const now = Date.now();
  const daysUntilExpiry = Math.ceil((expiresAt - now) / DAY_MS);
  const expired = now >= expiresAt;
  return {
    expired,
    daysUntilExpiry,
    hasCredential: true,
    rotationEnabled: true,
    reason: expired ? 'rotation' : null,
  };
}

// ---------------------------------------------------------------------------
// Password mutations
// ---------------------------------------------------------------------------

function isInvalidPasswordError(error: unknown): boolean {
  if (!(error instanceof APIError)) {
    return false;
  }
  const body: unknown = error.body;
  if (isRecord(body) && getString(body, 'code') === 'INVALID_PASSWORD') {
    return true;
  }
  const message = error instanceof Error ? error.message : '';
  return /invalid password/i.test(message);
}

async function forcedResetCredentialPassword(
  sql: Sql,
  userId: string,
  newPassword: string,
): Promise<void> {
  const rows = await sql<{ id: string; password: string | null }[]>`
    SELECT "id", "password" FROM "account"
    WHERE "userId" = ${userId} AND "providerId" = 'credential'
    LIMIT 1
  `;
  const credential = rows[0];
  if (!credential) {
    throw new UserServiceError(
      'credential_account_not_found',
      'Credential account not found',
      404,
    );
  }
  if (
    credential.password &&
    (await verifyPassword({ hash: credential.password, password: newPassword }))
  ) {
    throw new UserServiceError(
      'password_reused',
      'New password must be different from your current password',
      400,
    );
  }
  const newHash = await hashPassword(newPassword);
  await sql`
    UPDATE "account" SET "password" = ${newHash}, "updatedAt" = ${new Date()}
    WHERE "id" = ${credential.id}
  `;
}

export interface UpdateUserPasswordArgs {
  currentPassword?: string;
  newPassword: string;
  /**
   * ADVISORY ONLY — accepted for wire compatibility but never trusted. Whether
   * a forced (current-password-skipping) reset is allowed is decided
   * server-side by `forcedResetEligible`; a client cannot select 'forced' to
   * bypass re-authentication.
   */
  trigger?: 'voluntary' | 'forced';
}

/**
 * A forced reset SKIPS the current-password check, so it is legitimate ONLY
 * when the credential is genuinely in a forced-change state — an admin-set
 * force-change-on-next-login or an elapsed rotation policy, both reported by
 * `computePasswordExpiry().expired`. Deliberately takes no `trigger` argument:
 * the decision can never depend on client input, which is what stops a stolen
 * session from rotating the password without proving the old one.
 */
export function forcedResetEligible(
  hasCredential: boolean,
  expiry: Pick<PasswordExpiryStatus, 'expired'>,
): boolean {
  return hasCredential && expiry.expired;
}

/**
 * Update the CALLER's password (see 0.4 doc: voluntary credential change
 * re-authenticates via Better Auth `changePassword`; forced rotation skips
 * currentPassword but revokes other sessions; OAuth-only users get
 * `setPassword`). Policy = strictest across the caller's orgs.
 */
export async function updateUserPassword(
  deps: { sql: Sql; auth: Auth },
  actor: { userId: string; email?: string },
  headers: Headers,
  args: UpdateUserPasswordArgs,
): Promise<void> {
  const { sql, auth } = deps;
  const orgs = await getUserOrganizations(sql, actor.userId);
  const { policy } = await getStrictestPasswordPolicyForUser(
    sql,
    orgs.map((o) => o.organizationId),
  );
  if (!isPasswordValid(args.newPassword, policy)) {
    const violations = passwordPolicyViolations(args.newPassword, policy);
    throw new UserServiceError(
      'password_policy_violation',
      `Password does not meet policy (failed: ${violations.join(', ')})`,
      400,
    );
  }

  const hasPassword = await hasCredentialAccount(sql, actor.userId);
  // Forced eligibility is derived from the credential's real state, NOT the
  // request body: the client cannot pick 'forced' to skip current-password
  // re-authentication (finding: client-chosen trigger:'forced').
  const forcedReset = hasPassword
    ? forcedResetEligible(true, await computePasswordExpiry(sql, actor.userId))
    : false;

  if (forcedReset) {
    await forcedResetCredentialPassword(sql, actor.userId, args.newPassword);
    await auth.api.revokeOtherSessions({ headers });
  } else if (hasPassword) {
    if (!args.currentPassword) {
      throw new UserServiceError(
        'current_password_required',
        'Current password is required',
        400,
      );
    }
    try {
      await auth.api.changePassword({
        body: {
          currentPassword: args.currentPassword,
          newPassword: args.newPassword,
          revokeOtherSessions: true,
        },
        headers,
      });
    } catch (error) {
      if (isInvalidPasswordError(error)) {
        throw new UserServiceError(
          'INVALID_CURRENT_PASSWORD',
          'Current password is incorrect',
          400,
        );
      }
      throw error;
    }
  } else {
    await auth.api.setPassword({
      body: { newPassword: args.newPassword },
      headers,
    });
  }

  await transactSerializable(sql, async (tx) => {
    await recordPasswordChange(tx, actor.userId);
    for (const o of orgs) {
      await createAuditLog(tx, {
        organizationId: o.organizationId,
        actorId: actor.userId,
        ...(actor.email !== undefined ? { actorEmail: actor.email } : {}),
        actorType: 'user',
        action: 'user_password.changed',
        category: 'auth',
        resourceType: 'user',
        resourceId: actor.userId,
        status: 'success',
        metadata: { trigger: forcedReset ? 'forced' : 'voluntary' },
      });
    }
  });
}

/**
 * Admin sets a member's password: policy-checked, credential upserted,
 * EVERY session of that member revoked, rotation anchor set with
 * force-change-on-next-login, audit row written.
 *
 * AUTHORITY (the enforced contract): this door writes the GLOBAL credential
 * (one `account` row per user across every org) and chooses the replacement
 * password, so it is account seizure, not mere factor removal. It is gated on
 * TWO things:
 *   1. the caller is an owner/admin of the target's org (the admin door), and
 *   2. `evaluateCredentialResetAuthority` — the caller must strictly outrank
 *      the target in EVERY org the target belongs to, and never targets
 *      themselves.
 * Together these guarantee an admin can never seize an owner or a peer admin,
 * and one org's admin can never reset a user who also belongs to an org the
 * actor does not administer (cross-org takeover). This is deliberately
 * stricter than the passkey/2FA sibling admin ops (which only protect owners),
 * because those remove a factor whereas this hands the actor a working login.
 */
export async function setMemberPassword(
  deps: { sql: Sql },
  actor: { userId: string; email?: string },
  args: { memberId: string; newPassword: string },
): Promise<void> {
  const { sql } = deps;
  const memberRows = await sql<{ organizationId: string; userId: string }[]>`
    SELECT "organizationId", "userId" FROM "member"
    WHERE "id" = ${args.memberId} LIMIT 1
  `;
  const member = memberRows[0];
  if (!member) {
    throw new UserServiceError('not_found', 'Member not found', 404);
  }

  const caller = await findOrganizationMember(
    sql,
    member.organizationId,
    actor.userId,
  );
  if (!caller || !isAdminRole(caller.role)) {
    throw new UserServiceError(
      'forbidden',
      'Only admins can set member passwords',
      403,
    );
  }

  // Global-credential authority: the caller must strictly outrank the target
  // in every org the target belongs to (owner-protection + cross-org guard).
  const [actorMemberships, targetMemberships] = await Promise.all([
    getUserOrganizations(sql, actor.userId),
    getUserOrganizations(sql, member.userId),
  ]);
  const authority = evaluateCredentialResetAuthority({
    actorUserId: actor.userId,
    targetUserId: member.userId,
    actorMemberships,
    targetMemberships,
  });
  if (!authority.allowed) {
    const message =
      authority.reason === 'self'
        ? 'Use account settings to change your own password'
        : authority.reason === 'cross_org_authority'
          ? 'Cannot reset a member who belongs to organizations you do not administer'
          : 'Cannot reset a member whose role is not below yours';
    throw new UserServiceError('forbidden', message, 403);
  }

  const { policy } = await getStrictestPasswordPolicyForUser(sql, [
    member.organizationId,
  ]);
  if (!isPasswordValid(args.newPassword, policy)) {
    const violations = passwordPolicyViolations(args.newPassword, policy);
    throw new UserServiceError(
      'password_policy_violation',
      `Password does not meet policy (failed: ${violations.join(', ')})`,
      400,
    );
  }

  const passwordHash = await hashPassword(args.newPassword);
  await sql`
    INSERT INTO "account" (
      "id", "userId", "providerId", "accountId", "password",
      "createdAt", "updatedAt"
    ) VALUES (
      gen_random_uuid(), ${member.userId}, 'credential', ${member.userId},
      ${passwordHash}, ${new Date()}, ${new Date()}
    )
    ON CONFLICT DO NOTHING
  `;
  await sql`
    UPDATE "account" SET "password" = ${passwordHash}, "updatedAt" = ${new Date()}
    WHERE "userId" = ${member.userId} AND "providerId" = 'credential'
  `;
  await sql`DELETE FROM "session" WHERE "userId" = ${member.userId}`;

  await transactSerializable(sql, async (tx) => {
    await recordPasswordChange(tx, member.userId, {
      forceChangeOnNextLogin: true,
    });
    await createAuditLog(tx, {
      organizationId: member.organizationId,
      actorId: actor.userId,
      ...(actor.email !== undefined ? { actorEmail: actor.email } : {}),
      actorType: 'user',
      action: 'member_password.set',
      category: 'auth',
      resourceType: 'user',
      resourceId: member.userId,
      status: 'success',
      metadata: { memberId: args.memberId },
    });
  });
}

// ---------------------------------------------------------------------------
// Member creation (admin door; no session for the new user)
// ---------------------------------------------------------------------------

export interface CreateMemberArgs {
  organizationId: string;
  email: string;
  password?: string;
  displayName?: string;
  role?: string;
}

export interface CreateMemberResult {
  userId: string;
  memberId: string;
  isExistingUser: boolean;
}

/**
 * Create a user (or reuse an existing one by email) and add them to an org.
 * Unlike client sign-up this never touches the admin's session. The member
 * row is written by the members domain's `addMember` — the ONE add-member
 * concept — so the door the settings UI uses carries the same `add_member`
 * audit row and `member` realtime hint as `POST /api/app/members`, in one
 * transaction with the new user's rotation anchor.
 */
export async function createMember(
  deps: { sql: Sql; auth: Auth },
  actor: { userId: string; email?: string },
  args: CreateMemberArgs,
): Promise<CreateMemberResult> {
  const { sql, auth } = deps;
  const caller = await findOrganizationMember(
    sql,
    args.organizationId,
    actor.userId,
  );
  if (!caller || !isAdminRole(caller.role)) {
    throw new UserServiceError(
      'FORBIDDEN',
      'Only admins can create members',
      403,
    );
  }
  if ((args.role ?? '').toLowerCase() === 'owner') {
    throw new UserServiceError(
      'FORBIDDEN',
      'The owner role cannot be assigned manually',
      400,
    );
  }

  const email = args.email.toLowerCase().trim();
  const role = (args.role ?? 'member').toLowerCase();

  const existingRows = await sql<{ id: string }[]>`
    SELECT "id" FROM "user" WHERE lower("email") = ${email} LIMIT 1
  `;
  const existingUserId = existingRows[0]?.id;

  if (existingUserId) {
    // `addMember` refuses a duplicate membership (DUPLICATE_MEMBER) inside
    // the same transaction that would insert it — no read-then-write gap.
    const memberId = await transactSerializable(sql, (tx) =>
      addMember(tx, actor, {
        organizationId: args.organizationId,
        userId: existingUserId,
        role,
      }),
    );
    return { userId: existingUserId, memberId, isExistingUser: true };
  }

  if (!args.password) {
    throw new UserServiceError(
      'PASSWORD_REQUIRED',
      'Password is required when creating a new user',
      400,
    );
  }

  const signUp = await auth.api.signUpEmail({
    body: {
      email,
      password: args.password,
      name: args.displayName ?? '',
    },
  });
  const newUserId = signUp.user.id;
  if (!newUserId) {
    throw new UserServiceError(
      'USER_CREATION_FAILED',
      'Failed to create user account',
      400,
    );
  }

  const memberId = await transactSerializable(sql, async (tx) => {
    const id = await addMember(tx, actor, {
      organizationId: args.organizationId,
      userId: newUserId,
      role,
    });
    await recordPasswordChange(tx, newUserId, { forceChangeOnNextLogin: true });
    return id;
  });

  return { userId: newUserId, memberId, isExistingUser: false };
}

// ---------------------------------------------------------------------------
// Changelog acknowledgment state
// ---------------------------------------------------------------------------

export interface NotificationState {
  userId: string;
  lastSeenChangelogVersion?: string;
  lastToastedVersion?: string;
  updatedAt: number;
}

export async function getUserNotificationState(
  sql: Sql,
  userId: string,
): Promise<NotificationState | null> {
  const rows = await sql<
    {
      lastSeenChangelogVersion: string | null;
      lastToastedVersion: string | null;
      updatedAt: number;
    }[]
  >`
    SELECT last_seen_changelog_version AS "lastSeenChangelogVersion",
           last_toasted_version AS "lastToastedVersion",
           updated_at::float8 AS "updatedAt"
    FROM app.user_notification_state WHERE user_id = ${userId}
  `;
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    userId,
    ...(row.lastSeenChangelogVersion !== null
      ? { lastSeenChangelogVersion: row.lastSeenChangelogVersion }
      : {}),
    ...(row.lastToastedVersion !== null
      ? { lastToastedVersion: row.lastToastedVersion }
      : {}),
    updatedAt: row.updatedAt,
  };
}

export async function markToastShown(
  tx: TransactionSql,
  userId: string,
  version: string,
): Promise<void> {
  await tx`
    INSERT INTO app.user_notification_state (
      user_id, last_toasted_version, updated_at
    ) VALUES (${userId}, ${version}, ${Date.now()})
    ON CONFLICT (user_id) DO UPDATE SET
      last_toasted_version = ${version}, updated_at = ${Date.now()}
  `;
}

export async function markChangelogSeen(
  tx: TransactionSql,
  userId: string,
  version: string,
): Promise<void> {
  await tx`
    INSERT INTO app.user_notification_state (
      user_id, last_seen_changelog_version, last_toasted_version, updated_at
    ) VALUES (${userId}, ${version}, ${version}, ${Date.now()})
    ON CONFLICT (user_id) DO UPDATE SET
      last_seen_changelog_version = ${version},
      last_toasted_version = ${version},
      updated_at = ${Date.now()}
  `;
}
