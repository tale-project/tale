import type { Sql, TransactionSql } from 'postgres';

import { findOrganizationMember, isAdminRole } from '../../auth/membership.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { logSuccess } from '../audit_logs/service.ts';

/**
 * Members domain — org-membership management with the 0.4 guard semantics.
 * Reads are single SQL joins over Better Auth's tables (the 0.4 version
 * paginated the component adapter per table); writes go straight at the
 * `member` rows exactly like 0.4's adapter writes did, with their audit
 * rows committed atomically in the same transaction. The entire mirror
 * machinery is gone (see auth/membership.ts).
 *
 * Ledger note: the legal-hold guard on member removal (`assertNotHeld`)
 * lands with the governance domain.
 */

export const MEMBER_ROLES = [
  'owner',
  'admin',
  'developer',
  'editor',
  'member',
  'disabled',
] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

function isValidRole(role: string): role is MemberRole {
  return (MEMBER_ROLES as readonly string[]).includes(role);
}

export class MemberServiceError extends Error {
  readonly code: string;
  readonly status: 400 | 401 | 403 | 404;

  constructor(code: string, message: string, status: 400 | 401 | 403 | 404) {
    super(message);
    this.name = 'MemberServiceError';
    this.code = code;
    this.status = status;
  }
}

export interface MemberContext {
  status: 'ok';
  memberId: string;
  organizationId: string;
  userId: string;
  role: MemberRole;
  createdAt: string;
  displayName?: string;
  isAdmin: boolean;
}

/** The caller's own membership bundle for one org (or why it's absent). */
export async function getCurrentMemberContext(
  sql: Sql,
  actor: { userId: string; name?: string },
  organizationId: string,
): Promise<MemberContext | { status: 'not_found' } | { status: 'not_member' }> {
  const orgRows = await sql<{ id: string }[]>`
    SELECT "id" FROM "organization" WHERE "id" = ${organizationId} LIMIT 1
  `;
  if (orgRows.length === 0) {
    return { status: 'not_found' };
  }
  const rows = await sql<{ id: string; role: string; createdAt: string }[]>`
    SELECT "id", "role", "createdAt"::text AS "createdAt" FROM "member"
    WHERE "organizationId" = ${organizationId} AND "userId" = ${actor.userId}
    LIMIT 1
  `;
  const member = rows[0];
  if (!member || member.role.toLowerCase() === 'disabled') {
    return { status: 'not_member' };
  }
  const role = member.role.toLowerCase();
  const validRole: MemberRole = isValidRole(role) ? role : 'member';
  return {
    status: 'ok',
    memberId: member.id,
    organizationId,
    userId: actor.userId,
    role: validRole,
    createdAt: member.createdAt,
    ...(actor.name !== undefined ? { displayName: actor.name } : {}),
    isAdmin: isAdminRole(validRole),
  };
}

export interface MemberListItem {
  id: string;
  organizationId: string;
  userId: string;
  role: MemberRole;
  createdAt: string;
  displayName: string | null;
  email: string | null;
  twoFactorEnabled: boolean;
  passkeyCount: number;
}

/** The members table: member ⋈ user ⋈ passkey counts, one statement. */
export async function listByOrganization(
  sql: Sql,
  organizationId: string,
): Promise<MemberListItem[]> {
  const rows = await sql<
    {
      id: string;
      organizationId: string;
      userId: string;
      role: string;
      createdAt: string;
      displayName: string | null;
      email: string | null;
      twoFactorEnabled: boolean | null;
      passkeyCount: string;
    }[]
  >`
    SELECT m."id", m."organizationId", m."userId", m."role",
           m."createdAt"::text AS "createdAt",
           u."name" AS "displayName", u."email",
           u."twoFactorEnabled" AS "twoFactorEnabled",
           (SELECT count(*) FROM "passkey" p WHERE p."userId" = m."userId")::text
             AS "passkeyCount"
    FROM "member" m
    LEFT JOIN "user" u ON u."id" = m."userId"
    WHERE m."organizationId" = ${organizationId}
    ORDER BY m."createdAt" ASC
  `;
  return rows.map((row) => {
    const role = row.role.toLowerCase();
    return {
      id: row.id,
      organizationId: row.organizationId,
      userId: row.userId,
      role: isValidRole(role) ? role : 'member',
      createdAt: row.createdAt,
      displayName: row.displayName,
      email: row.email,
      twoFactorEnabled: row.twoFactorEnabled === true,
      passkeyCount: Number(row.passkeyCount),
    };
  });
}

interface MemberRow {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
  createdAt: string;
}

async function findMemberById(
  tx: TransactionSql | Sql,
  memberId: string,
): Promise<MemberRow | null> {
  const rows = await tx<MemberRow[]>`
    SELECT "id", "organizationId", "userId", "role",
           "createdAt"::text AS "createdAt"
    FROM "member" WHERE "id" = ${memberId} LIMIT 1
  `;
  return rows[0] ?? null;
}

async function requireAdminCaller(
  tx: TransactionSql | Sql,
  organizationId: string,
  userId: string,
  code: string,
): Promise<{ role: string }> {
  const caller = await findOrganizationMember(tx, organizationId, userId);
  if (!caller || !isAdminRole(caller.role)) {
    throw new MemberServiceError(code, 'Admin role required', 403);
  }
  return caller;
}

async function userEmail(
  tx: TransactionSql | Sql,
  userId: string,
): Promise<string | null> {
  const rows = await tx<{ email: string | null }[]>`
    SELECT "email" FROM "user" WHERE "id" = ${userId} LIMIT 1
  `;
  return rows[0]?.email ?? null;
}

/** Admin adds an EXISTING user to the org (never as owner). */
export async function addMember(
  tx: TransactionSql,
  actor: { userId: string; email?: string },
  args: { organizationId: string; userId: string; role?: string },
): Promise<string> {
  const caller = await requireAdminCaller(
    tx,
    args.organizationId,
    actor.userId,
    'MEMBER_ADD_FORBIDDEN',
  );
  const role = (args.role ?? 'member').toLowerCase();
  if (role === 'owner') {
    throw new MemberServiceError(
      'MEMBER_OWNER_ROLE_ASSIGN_FORBIDDEN',
      'The owner role cannot be assigned manually',
      400,
    );
  }
  const existing = await findOrganizationMember(
    tx,
    args.organizationId,
    args.userId,
  );
  if (existing) {
    throw new MemberServiceError(
      'DUPLICATE_MEMBER',
      'User is already a member of this organization',
      400,
    );
  }

  const inserted = await tx<{ id: string }[]>`
    INSERT INTO "member" ("id", "organizationId", "userId", "role", "createdAt")
    VALUES (gen_random_uuid(), ${args.organizationId}, ${args.userId}, ${role},
            ${new Date()})
    RETURNING "id"
  `;
  const memberId = inserted[0]?.id;
  if (!memberId) {
    throw new MemberServiceError('MEMBER_ADD_FAILED', 'Insert failed', 400);
  }

  const targetEmail = await userEmail(tx, args.userId);
  await logSuccess(tx, {
    auditCtx: {
      organizationId: args.organizationId,
      actor: {
        id: actor.userId,
        ...(actor.email !== undefined ? { email: actor.email } : {}),
        role: caller.role,
        type: 'user',
      },
    },
    action: 'add_member',
    category: 'member',
    resourceType: 'member',
    resourceId: memberId,
    resourceName: targetEmail ?? args.userId,
    newState: { userId: args.userId, role },
  });
  await emitHintInTx(tx, {
    orgId: args.organizationId,
    entity: 'member',
    entityId: args.userId,
  });
  return memberId;
}

/** Admin removes a member (never an owner, never themselves). */
export async function removeMember(
  tx: TransactionSql,
  actor: { userId: string; email?: string },
  memberId: string,
): Promise<void> {
  const member = await findMemberById(tx, memberId);
  if (!member) {
    throw new MemberServiceError('MEMBER_NOT_FOUND', 'Member not found', 404);
  }
  const caller = await requireAdminCaller(
    tx,
    member.organizationId,
    actor.userId,
    'MEMBER_REMOVE_FORBIDDEN',
  );
  if (member.role.toLowerCase() === 'owner') {
    throw new MemberServiceError(
      'MEMBER_OWNER_REMOVAL_FORBIDDEN',
      'Owners cannot be removed',
      403,
    );
  }
  if (member.userId === actor.userId) {
    throw new MemberServiceError(
      'MEMBER_SELF_REMOVAL_FORBIDDEN',
      'You cannot remove your own membership',
      400,
    );
  }
  // TODO(governance): assertNotHeld(userMembership) once legal holds land.

  const targetEmail = await userEmail(tx, member.userId);
  await tx`DELETE FROM "member" WHERE "id" = ${memberId}`;
  // Personalization cascade (ported half): the member's per-org preference
  // row dies with the membership; user_memories follows with its domain.
  await tx`
    DELETE FROM app.user_preferences
    WHERE org_id = ${member.organizationId} AND user_id = ${member.userId}
  `;

  await logSuccess(tx, {
    auditCtx: {
      organizationId: member.organizationId,
      actor: {
        id: actor.userId,
        ...(actor.email !== undefined ? { email: actor.email } : {}),
        role: caller.role,
        type: 'user',
      },
    },
    action: 'remove_member',
    category: 'member',
    resourceType: 'member',
    resourceId: memberId,
    resourceName: targetEmail ?? member.userId,
    previousState: { userId: member.userId, role: member.role },
  });
  await emitHintInTx(tx, {
    orgId: member.organizationId,
    entity: 'member',
    entityId: member.userId,
  });
}

/**
 * Admin changes a member's role. Owners are immutable, owner cannot be
 * assigned, the org creator's role is immutable, and the last admin cannot
 * be demoted.
 */
export async function updateMemberRole(
  tx: TransactionSql,
  actor: { userId: string; email?: string },
  args: { memberId: string; role: string },
): Promise<void> {
  const member = await findMemberById(tx, args.memberId);
  if (!member) {
    throw new MemberServiceError('MEMBER_NOT_FOUND', 'Member not found', 404);
  }
  const caller = await requireAdminCaller(
    tx,
    member.organizationId,
    actor.userId,
    'MEMBER_ROLE_UPDATE_FORBIDDEN',
  );
  if (member.role.toLowerCase() === 'owner') {
    throw new MemberServiceError(
      'MEMBER_OWNER_ROLE_IMMUTABLE',
      'Owner role is immutable',
      403,
    );
  }
  const newRole = args.role.toLowerCase();
  if (newRole === 'owner') {
    throw new MemberServiceError(
      'MEMBER_OWNER_ROLE_ASSIGN_FORBIDDEN',
      'The owner role cannot be assigned manually',
      400,
    );
  }

  // The org creator's role is pinned (metadata.creatorId from Better Auth).
  const orgRows = await tx<{ metadata: string | null }[]>`
    SELECT "metadata" FROM "organization"
    WHERE "id" = ${member.organizationId} LIMIT 1
  `;
  const rawMetadata = orgRows[0]?.metadata;
  if (rawMetadata) {
    try {
      const parsed: unknown = JSON.parse(rawMetadata);
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        'creatorId' in parsed &&
        parsed.creatorId === member.userId
      ) {
        throw new MemberServiceError(
          'MEMBER_CREATOR_ROLE_IMMUTABLE',
          "The organization creator's role is immutable",
          403,
        );
      }
    } catch (error) {
      if (error instanceof MemberServiceError) {
        throw error;
      }
      console.warn('Failed to parse organization metadata', error);
    }
  }

  const previousRole = member.role.toLowerCase();
  if (isAdminRole(previousRole) && !isAdminRole(newRole)) {
    const admins = await tx<{ count: string }[]>`
      SELECT count(*)::text AS count FROM "member"
      WHERE "organizationId" = ${member.organizationId}
        AND lower("role") IN ('owner', 'admin')
    `;
    if (Number(admins[0]?.count ?? '0') <= 1) {
      throw new MemberServiceError(
        'MEMBER_LAST_ADMIN',
        'The last admin cannot be demoted',
        400,
      );
    }
  }

  await tx`UPDATE "member" SET "role" = ${newRole} WHERE "id" = ${args.memberId}`;

  const targetEmail = await userEmail(tx, member.userId);
  await logSuccess(tx, {
    auditCtx: {
      organizationId: member.organizationId,
      actor: {
        id: actor.userId,
        ...(actor.email !== undefined ? { email: actor.email } : {}),
        role: caller.role,
        type: 'user',
      },
    },
    action: 'update_member_role',
    category: 'member',
    resourceType: 'member',
    resourceId: args.memberId,
    resourceName: targetEmail ?? member.userId,
    previousState: { role: previousRole },
    newState: { role: newRole },
  });
  await emitHintInTx(tx, {
    orgId: member.organizationId,
    entity: 'member',
    entityId: member.userId,
  });
}

/** Owner hands ownership to another member; the caller becomes admin. */
export async function transferOwnership(
  tx: TransactionSql,
  actor: { userId: string; email?: string },
  targetMemberId: string,
): Promise<void> {
  const target = await findMemberById(tx, targetMemberId);
  if (!target) {
    throw new MemberServiceError('MEMBER_NOT_FOUND', 'Member not found', 404);
  }
  const caller = await findOrganizationMember(
    tx,
    target.organizationId,
    actor.userId,
  );
  if (!caller || caller.role !== 'owner') {
    throw new MemberServiceError(
      'OWNERSHIP_TRANSFER_FORBIDDEN',
      'Only the owner can transfer ownership',
      403,
    );
  }
  if (target.role.toLowerCase() === 'owner') {
    throw new MemberServiceError(
      'MEMBER_ALREADY_OWNER',
      'Member is already the owner',
      400,
    );
  }

  await tx`UPDATE "member" SET "role" = 'owner' WHERE "id" = ${targetMemberId}`;
  await tx`UPDATE "member" SET "role" = 'admin' WHERE "id" = ${caller.id}`;

  const targetEmail = await userEmail(tx, target.userId);
  await logSuccess(tx, {
    auditCtx: {
      organizationId: target.organizationId,
      actor: {
        id: actor.userId,
        ...(actor.email !== undefined ? { email: actor.email } : {}),
        role: 'owner',
        type: 'user',
      },
    },
    action: 'transfer_ownership',
    category: 'member',
    resourceType: 'member',
    resourceId: targetMemberId,
    resourceName: targetEmail ?? target.userId,
    previousState: { role: target.role },
    newState: { role: 'owner' },
  });
}

/** Self or admin edits a member's display name (the user row's name). */
export async function updateMemberDisplayName(
  tx: TransactionSql,
  actor: { userId: string; email?: string },
  args: { memberId: string; displayName: string },
): Promise<void> {
  const member = await findMemberById(tx, args.memberId);
  if (!member) {
    throw new MemberServiceError('MEMBER_NOT_FOUND', 'Member not found', 404);
  }
  const isOwnProfile = actor.userId === member.userId;
  let callerRole: string | undefined;
  if (!isOwnProfile) {
    const caller = await requireAdminCaller(
      tx,
      member.organizationId,
      actor.userId,
      'MEMBER_NAME_UPDATE_FORBIDDEN',
    );
    callerRole = caller.role;
  }

  const trimmed = args.displayName.trim();
  if (trimmed.length === 0 || trimmed.length > 100) {
    throw new MemberServiceError(
      'validation',
      'Display name must be 1–100 characters',
      400,
    );
  }

  const previousRows = await tx<
    { name: string | null; email: string | null }[]
  >`
    SELECT "name", "email" FROM "user" WHERE "id" = ${member.userId} LIMIT 1
  `;
  const previousName = previousRows[0]?.name ?? undefined;
  await tx`
    UPDATE "user" SET "name" = ${trimmed}, "updatedAt" = ${new Date()}
    WHERE "id" = ${member.userId}
  `;

  await logSuccess(tx, {
    auditCtx: {
      organizationId: member.organizationId,
      actor: {
        id: actor.userId,
        ...(actor.email !== undefined ? { email: actor.email } : {}),
        ...(callerRole !== undefined ? { role: callerRole } : {}),
        type: 'user',
      },
    },
    action: 'update_member_name',
    category: 'member',
    resourceType: 'member',
    resourceId: args.memberId,
    resourceName: previousRows[0]?.email ?? member.userId,
    previousState: { name: previousName },
    newState: { name: trimmed },
  });
}
