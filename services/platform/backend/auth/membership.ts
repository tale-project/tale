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
