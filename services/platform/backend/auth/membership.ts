import type { Sql, TransactionSql } from 'postgres';

/**
 * Org / team membership readers — direct SQL against Better Auth's own
 * tables. This replaces the ENTIRE 0.4 mirror apparatus (`memberMirror`,
 * `teamMemberMirror`, inline sync, auth-hook resync, hourly reconciliation
 * cron): those existed only because Better Auth lived in a separate Convex
 * component and every membership read was a cross-component round-trip. In
 * 0.5 the tables are local Postgres — one indexed read, no cache, no drift.
 *
 * Better Auth quotes its identifiers (camelCase columns, singular table
 * names), hence the quoted `"member"`/`"userId"` style below.
 */

export interface OrgMembership {
  organizationId: string;
  role: string;
}

export interface OrganizationMember {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
}

export class MembershipError extends Error {
  readonly code:
    | 'ORG_ID_REQUIRED'
    | 'ORG_NOT_FOUND'
    | 'ORG_FORBIDDEN'
    | 'ROLE_FORBIDDEN';

  constructor(message: string, code: MembershipError['code']) {
    super(message);
    this.name = 'MembershipError';
    this.code = code;
  }
}

/** All org memberships of a user (disabled rows included — callers filter). */
export async function getUserOrganizations(
  sql: Sql | TransactionSql,
  userId: string,
): Promise<OrgMembership[]> {
  const rows = await sql<{ organizationId: string; role: string }[]>`
    SELECT "organizationId", "role" FROM "member"
    WHERE "userId" = ${userId}
  `;
  return rows.map((row) => ({
    organizationId: row.organizationId,
    role: row.role.toLowerCase(),
  }));
}

/** The user's member row in one org, or null. Role normalized lowercase. */
export async function findOrganizationMember(
  sql: Sql | TransactionSql,
  organizationId: string,
  userId: string,
): Promise<OrganizationMember | null> {
  const rows = await sql<
    { id: string; organizationId: string; userId: string; role: string }[]
  >`
    SELECT "id", "organizationId", "userId", "role" FROM "member"
    WHERE "organizationId" = ${organizationId} AND "userId" = ${userId}
    LIMIT 1
  `;
  const row = rows[0];
  return row ? { ...row, role: row.role.toLowerCase() } : null;
}

async function organizationExists(
  sql: Sql | TransactionSql,
  organizationId: string,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    SELECT "id" FROM "organization" WHERE "id" = ${organizationId} LIMIT 1
  `;
  return rows.length > 0;
}

/**
 * Resolve the caller's ACTIVE membership of `organizationId` or throw.
 * Mirrors the 0.4 `getOrganizationMember` error contract: distinguishes a
 * missing org from a non-membership, and treats the `disabled` role as
 * forbidden. (The 0.4 email-fallback branch is NOT ported — it patched SSO
 * account-linking splits across the component boundary; the SSO port decides
 * whether 0.5 still needs an equivalent.)
 */
export async function requireOrganizationMember(
  sql: Sql | TransactionSql,
  organizationId: string,
  userId: string,
): Promise<OrganizationMember> {
  if (!organizationId) {
    throw new MembershipError(
      'Organization id is required.',
      'ORG_ID_REQUIRED',
    );
  }
  const member = await findOrganizationMember(sql, organizationId, userId);
  if (!member) {
    if (!(await organizationExists(sql, organizationId))) {
      throw new MembershipError(
        `Organization "${organizationId}" not found.`,
        'ORG_NOT_FOUND',
      );
    }
    throw new MembershipError(
      `Not a member of organization ${organizationId}`,
      'ORG_FORBIDDEN',
    );
  }
  if (member.role === 'disabled') {
    throw new MembershipError(
      `Member account is disabled in organization ${organizationId}`,
      'ORG_FORBIDDEN',
    );
  }
  return member;
}

const ADMIN_ROLES = new Set(['owner', 'admin']);
const ADMIN_OR_DEVELOPER_ROLES = new Set(['owner', 'admin', 'developer']);

export function isAdminRole(role: string): boolean {
  return ADMIN_ROLES.has(role.toLowerCase());
}

export function isAdminOrDeveloperRole(role: string): boolean {
  return ADMIN_OR_DEVELOPER_ROLES.has(role.toLowerCase());
}

/**
 * Authority rank for the owner-protection / strict-outrank guards. Higher =
 * more authority. Unknown roles rank 0 (fail closed: they can outrank nobody).
 */
export const ROLE_RANK: Readonly<Record<string, number>> = {
  owner: 5,
  admin: 4,
  developer: 3,
  editor: 2,
  member: 1,
  disabled: 0,
};

export function roleRank(role: string): number {
  return ROLE_RANK[role.toLowerCase()] ?? 0;
}

export type CredentialResetDenial =
  | 'self'
  | 'cross_org_authority'
  | 'insufficient_rank';

/**
 * Decide whether `actor` may reset `target`'s email/password credential
 * through the admin door.
 *
 * The credential is a SINGLE GLOBAL row per user (Better Auth `account` keyed
 * by (userId, providerId='credential')), so a reset rewrites the password in
 * EVERY organization the target belongs to and lets the actor — who chooses
 * the replacement password — sign in as the target everywhere. The authority
 * to do that must therefore hold across the target's ENTIRE membership set,
 * not just the org the admin happens to be looking at:
 *
 *  - never on yourself — self-service is `/users/update-password`, which
 *    proves the current password (this door does not);
 *  - for EVERY org the target belongs to, the actor must be a member there and
 *    STRICTLY OUTRANK the target's role in that org.
 *
 * Consequences (the enforced contract): an admin can never seize an owner
 * (nobody outranks owner) or a peer admin (equal rank), and one org's admin
 * can never reset a user who also belongs to an org the actor does not
 * administer (cross-org takeover). Disabled memberships still count — the
 * global credential governs the account's identity even where a seat is
 * dormant, so we fail closed.
 *
 * Pure: the caller reads both membership lists from the `member` table and
 * passes them in; `targetMemberships` MUST be the full cross-org set.
 */
export function evaluateCredentialResetAuthority(args: {
  actorUserId: string;
  targetUserId: string;
  actorMemberships: OrgMembership[];
  targetMemberships: OrgMembership[];
}): { allowed: true } | { allowed: false; reason: CredentialResetDenial } {
  if (args.actorUserId === args.targetUserId) {
    return { allowed: false, reason: 'self' };
  }
  if (args.targetMemberships.length === 0) {
    // No membership to authorize against — fail closed.
    return { allowed: false, reason: 'cross_org_authority' };
  }
  const actorRankByOrg = new Map(
    args.actorMemberships.map((m) => [m.organizationId, roleRank(m.role)]),
  );
  for (const membership of args.targetMemberships) {
    const actorRank = actorRankByOrg.get(membership.organizationId);
    if (actorRank === undefined) {
      return { allowed: false, reason: 'cross_org_authority' };
    }
    if (actorRank <= roleRank(membership.role)) {
      return { allowed: false, reason: 'insufficient_rank' };
    }
  }
  return { allowed: true };
}

/** Team ids the user belongs to (the other half of the RLS prime). */
export async function getUserTeamIds(
  sql: Sql | TransactionSql,
  userId: string,
): Promise<string[]> {
  const rows = await sql<{ teamId: string }[]>`
    SELECT "teamId" FROM "teamMember" WHERE "userId" = ${userId}
  `;
  return rows.map((row) => row.teamId);
}
