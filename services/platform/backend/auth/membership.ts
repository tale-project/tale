import type { Sql, TransactionSql } from 'postgres';

import { roleRank } from '../../lib/shared/role-rank.ts';
import { PROJECT_TEAM_IDS_SQL } from '../core/lib/audience.ts';
import {
  type ApiKeyOwner,
  readServicePrincipal,
} from '../domains/api_keys/owners.ts';
import { retireApiKeysInTx } from '../domains/api_keys/retire.ts';
import { scheduleMemberWorkspaceRetirement } from '../domains/sandbox/retirement-schedule.ts';

/**
 * Org / team membership readers — direct SQL against Better Auth's own
 * tables. This replaces the ENTIRE 0.4 mirror apparatus (`memberMirror`,
 * `teamMemberMirror`, inline sync, auth-hook resync, hourly reconciliation
 * cron): those existed only because Better Auth lived in a separate Convex
 * component and every membership read was a cross-component round-trip. In
 * 0.5 the tables are local Postgres — one indexed read, no mirror, no drift.
 * The org gate's read alone goes through the process's cache, which a
 * trigger on the table invalidates (`request-cache.ts`).
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

/**
 * All org memberships of a user (disabled rows included — callers filter),
 * in a STABLE order (by organization id), so every walker (the sign-in
 * audit writes one row per organization) visits them the same way.
 */
export async function getUserOrganizations(
  sql: Sql | TransactionSql,
  userId: string,
): Promise<OrgMembership[]> {
  const rows = await sql<{ organizationId: string; role: string }[]>`
    SELECT "organizationId", "role" FROM "member"
    WHERE "userId" = ${userId}
    ORDER BY "organizationId"
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
 * The refusal for a caller with no ACTIVE row in `organizationId`, or the
 * row itself: a missing org is told apart from a non-membership, and the
 * `disabled` role is forbidden.
 */
async function activeMemberOrThrow(
  sql: Sql | TransactionSql,
  organizationId: string,
  member: OrganizationMember | null,
): Promise<OrganizationMember> {
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
  return activeMemberOrThrow(
    sql,
    organizationId,
    await findOrganizationMember(sql, organizationId, userId),
  );
}

/**
 * The caller's ACTIVE membership of `organizationId` together with every
 * organization the caller belongs to, from ONE indexed read of their member
 * rows. The org gate needs both on every request — the membership to admit
 * the call, and the full list to merge the strictest two-factor policy — and
 * used to read them separately. Same error contract as
 * {@link requireOrganizationMember}.
 */
export async function requireOrganizationMembership(
  sql: Sql | TransactionSql,
  organizationId: string,
  userId: string,
  /** How the user's member rows are read: by default straight from the
   * table; the org gate passes the process's cache (`request-cache.ts`). */
  through: (
    read: () => Promise<OrganizationMember[]>,
  ) => Promise<OrganizationMember[]> = async (read) => read(),
): Promise<{ member: OrganizationMember; organizationIds: string[] }> {
  if (!organizationId) {
    throw new MembershipError(
      'Organization id is required.',
      'ORG_ID_REQUIRED',
    );
  }
  const rows = await through(
    async () => sql<OrganizationMember[]>`
      SELECT "id", "organizationId", "userId", "role" FROM "member"
      WHERE "userId" = ${userId}
    `,
  );
  const row = rows.find(
    (candidate) => candidate.organizationId === organizationId,
  );
  const member = await activeMemberOrThrow(
    sql,
    organizationId,
    row ? { ...row, role: row.role.toLowerCase() } : null,
  );
  return { member, organizationIds: rows.map((r) => r.organizationId) };
}

/** The roles that carry an org's elevated seat — Better Auth creates orgs
 * with `creatorRole: 'owner'`, and `admin` is the granted twin. */
const ADMIN_ROLES: ReadonlySet<string> = new Set(['owner', 'admin']);
const ADMIN_OR_DEVELOPER_ROLES = new Set(['owner', 'admin', 'developer']);

export function isAdminRole(role: string): boolean {
  return ADMIN_ROLES.has(role.toLowerCase());
}

export function isAdminOrDeveloperRole(role: string): boolean {
  return ADMIN_OR_DEVELOPER_ROLES.has(role.toLowerCase());
}

/** Authority rank for the owner-protection / strict-outrank guards — shared
 * with the app, so a picker offers exactly whom a rule admits. */
export { roleRank };

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

/**
 * Remove every per-org trace of a membership BESIDES the member row: the
 * user's teamMember rows in the org's teams (what Better Auth's own
 * deleteMember does when teams are enabled — a raw DELETE FROM "member"
 * does not), the SSO team-sync provenance for them (migration 0071), the
 * per-org preference row, the member's live platform-capability grants,
 * and — through a job that runs once this commits — their sandbox
 * workspaces with the organization's agents. Each caller deletes the member
 * row itself — it has its own guard and audit — and runs this in the same
 * transaction.
 *
 * Without the cascade a member removed by an admin or de-provisioned by
 * SCIM kept their teamMember rows: a later re-add (or the IdP's next POST,
 * which re-attaches the existing user) put them straight back into every
 * team-scoped document, project and task they used to see, with no one
 * re-asserting the membership; in between, SCIM Group reads listed a user
 * GET /Users/:id 404ed, which IdPs flag as drift. A capability grant would
 * come back the same way, carrying a right no admin re-granted.
 *
 * Answers the ids of the teams the user was removed from, so a caller that
 * emits realtime hints can invalidate those teams' member lists the way the
 * teams door does on a direct removal.
 */
export async function removeMembershipCascade(
  tx: TransactionSql,
  organizationId: string,
  userId: string,
): Promise<{ teamIds: string[] }> {
  const left = await tx<{ teamId: string }[]>`
    DELETE FROM "teamMember"
    WHERE "userId" = ${userId}
      AND "teamId" IN (
        SELECT "id" FROM "team" WHERE "organizationId" = ${organizationId}
      )
    RETURNING "teamId"
  `;
  await tx`
    DELETE FROM app.sso_synced_team_members
    WHERE org_id = ${organizationId} AND user_id = ${userId}
  `;
  await tx`
    DELETE FROM app.user_preferences
    WHERE org_id = ${organizationId} AND user_id = ${userId}
  `;
  // Every live grant in the competence register
  // (domains/governance/competence.ts) ends with the membership — a
  // platform capability delegates a right the membership carried, and a
  // qualification gates who may approve a review, so neither may survive
  // the removal and re-attach to a re-added member without an admin
  // granting it again. Stamped revoked, never deleted — the register is the
  // trail. (Migration 0116 revoked the grants earlier removals left live.)
  await tx`
    UPDATE app.competence_records
    SET revoked_at_ms = ${Date.now()}, revoked_by = 'system'
    WHERE org_id = ${organizationId} AND user_id = ${userId}
      AND revoked_at_ms IS NULL
  `;
  // The API keys an Owner or Admin made for the member here act as them in
  // this organization alone; they end with the seat (the member's own keys
  // are theirs and simply stop working here). So do the keys the member
  // made for others: a key acts as its member only while its maker may.
  await retireApiKeysInTx(tx, {
    organizationId,
    reason: 'member_removed',
    memberUserId: userId,
  });
  await retireApiKeysInTx(tx, {
    organizationId,
    reason: 'maker_removed',
    makerUserId: userId,
  });
  // The workspaces the member's runs with the organization's agents worked
  // in hold what those runs left behind — theirs, and reachable by nobody
  // once they are gone. Deleted once this commits (a member re-added before
  // the job runs keeps them).
  await scheduleMemberWorkspaceRetirement(tx, { organizationId, userId });
  return { teamIds: [...new Set(left.map((row) => row.teamId))] };
}

/**
 * What one caller sees with in one organization: their teams, and — for a
 * project's own API key — the one project it reaches.
 */
interface ActingAudience {
  teamIds: string[];
  /** The project a project's own key is confined to. */
  projectScope?: string;
}

/**
 * The caller's audience IN THIS ORGANIZATION (the other half of the RLS
 * prime). Scoped through the team's own org: a membership in another
 * tenant's team must never widen what this org's team-scoped rows show, and
 * a membership whose team row is gone is no team at all.
 *
 * An API key that is not a person (`domains/api_keys/owners.ts`) has no
 * `teamMember` row and sees with the audience it was given instead: a
 * team's key that team's, a project's key the project's own teams — and
 * that one project alone — the organization's key none. One statement for a
 * person; a project's key reads its project's teams with a second.
 */
async function readActingAudience(
  sql: Sql | TransactionSql,
  organizationId: string,
  userId: string,
): Promise<ActingAudience> {
  const rows = await sql<{ teamId: string | null; projectId: string | null }[]>`
    SELECT tm."teamId" AS "teamId", NULL::text AS "projectId"
    FROM "teamMember" tm
    JOIN "team" t ON t."id" = tm."teamId"
    WHERE tm."userId" = ${userId} AND t."organizationId" = ${organizationId}
    UNION
    SELECT o.team_id, o.project_id
    FROM app.api_key_owners o
    LEFT JOIN "team" t ON t."id" = o.team_id AND t."organizationId" = o.org_id
    WHERE o.principal_user_id = ${userId} AND o.org_id = ${organizationId}
      AND o.revoked_at_ms IS NULL
      AND ((o.owner_kind = 'team' AND t."id" IS NOT NULL)
           OR o.owner_kind = 'project')
  `;
  const teamIds = rows.flatMap((row) =>
    typeof row.teamId === 'string' ? [row.teamId] : [],
  );
  const projectScope = rows.find(
    (row) => typeof row.projectId === 'string',
  )?.projectId;
  if (typeof projectScope !== 'string') return { teamIds };
  // A project's own key sees with that project's audience.
  const projects = await sql<{ teamIds: string[] | null }[]>`
    SELECT ${sql.unsafe(PROJECT_TEAM_IDS_SQL)} AS "teamIds"
    FROM app.projects
    WHERE id = ${projectScope} AND org_id = ${organizationId}
  `;
  return {
    teamIds: [
      ...new Set([
        ...teamIds,
        ...projects.flatMap((project) => project.teamIds ?? []),
      ]),
    ],
    projectScope,
  };
}

/** The team ids of {@link readActingAudience}. */
export async function getUserTeamIds(
  sql: Sql | TransactionSql,
  organizationId: string,
  userId: string,
): Promise<string[]> {
  return (await readActingAudience(sql, organizationId, userId)).teamIds;
}

/**
 * The member a request ACTS AS in one organization: the person's own member
 * row, or — for an API key that is not a person — the role that key was
 * made with, for as long as the key is live and bound to this organization.
 * Only the doors an API key reaches ask this; a check about another person
 * (whom to add to a team, whom to grant a competence) keeps reading
 * {@link findOrganizationMember}, which a key's identity never satisfies.
 */
export async function findActingMember(
  sql: Sql | TransactionSql,
  organizationId: string,
  userId: string,
): Promise<ActingMember | null> {
  const member = await findOrganizationMember(sql, organizationId, userId);
  if (member !== null) return member;
  const principal = await readServicePrincipal(sql, userId);
  if (
    principal === null ||
    principal.organizationId !== organizationId ||
    principal.role === null
  ) {
    return null;
  }
  return {
    id: `api-key:${principal.apiKeyId}`,
    organizationId,
    userId,
    role: principal.role,
    apiKeyOwner: principal,
  };
}

/** The member a request acts as; `apiKeyOwner` names the key when it is an
 * API key's own identity rather than a person. */
export interface ActingMember extends OrganizationMember {
  apiKeyOwner?: ApiKeyOwner;
}
