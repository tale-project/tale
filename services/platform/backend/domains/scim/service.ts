import type { Sql, TransactionSql } from 'postgres';

import { AppError } from '../../../lib/shared/errors/app-error';
import { normalizeAuthEmail } from '../../core/lib/auth/normalize_auth_email.ts';
import {
  classifyDeprovision,
  classifyUserOwnership,
  composeDesiredMembers,
  planActivation,
} from '../../core/scim/internal_mutations.ts';
import { isUniqueViolation } from '../../db/sql.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { resolveProvisioning } from '../sso/config.ts';
import {
  resyncRetiredDocumentScopes,
  retireTeamScopes,
  type TeamScopeRetirement,
} from '../teams/service.ts';

/**
 * SCIM storage — the 0.5 twin of `convex/scim/{data,links,internal_queries,
 * internal_mutations}.ts`: the SAME provisioning choreography (the pure
 * decision helpers — activation plan, cross-tenant ownership, deprovision
 * verdict, membership composition — are REUSED from 0.4) written straight
 * onto the Better Auth tables + the `app.sso_*` state rows. The 0.4
 * member/teamMember mirrors are dropped (rule 5 — PG reads the tables).
 *
 * Every write audits as actor `scim` (type `api`), category `member`, the
 * 0.4 action vocabulary unchanged.
 */

type Db = Sql | TransactionSql;

export interface ScimUserRecord {
  userId: string;
  email: string;
  name: string;
  active: boolean;
  externalId?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface ScimGroupRecord {
  teamId: string;
  displayName: string;
  memberUserIds: string[];
  externalId?: string;
  createdAt?: number;
  updatedAt?: number;
}

// ---------------------------------------------------------------- token auth

export interface ScimTokenConfig {
  configId: string;
  organizationId: string;
  defaultRole: string;
  enabled: boolean;
}

/** Resolve the org for an inbound token hash; empty never matches. */
export async function getConfigByTokenHash(
  sql: Sql,
  tokenHash: string,
): Promise<ScimTokenConfig | null> {
  if (!tokenHash) return null;
  const rows = await sql<{ id: string; orgId: string; scimEnabled: boolean }[]>`
    SELECT id, org_id AS "orgId", scim_enabled AS "scimEnabled"
    FROM app.sso_connections
    WHERE scim_token_hash = ${tokenHash} AND scim_token_hash <> ''
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  const provisioning = await resolveProvisioning(sql, row.orgId);
  return {
    configId: row.id,
    organizationId: row.orgId,
    defaultRole: provisioning.defaultRole,
    enabled: row.scimEnabled,
  };
}

/** Throttled lastUsedAt stamp (skips within a minute). */
export async function touchConfigLastUsed(
  sql: Sql,
  configId: string,
): Promise<void> {
  const now = Date.now();
  await sql`
    UPDATE app.sso_connections SET scim_last_used_at_ms = ${now}
    WHERE id = ${configId}
      AND (scim_last_used_at_ms IS NULL
        OR scim_last_used_at_ms < ${now - 60_000})
  `;
}

// ---------------------------------------------------------------- links

interface LinkRow {
  externalId: string | null;
  lastActiveRole: string | null;
}

async function getLink(
  db: Db,
  organizationId: string,
  internalId: string,
): Promise<LinkRow | null> {
  const rows = await db<LinkRow[]>`
    SELECT external_id AS "externalId", last_active_role AS "lastActiveRole"
    FROM app.sso_provisioning_links
    WHERE org_id = ${organizationId} AND internal_id = ${internalId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/** Insert or patch the link row, preserving fields not supplied. */
async function upsertLink(
  db: Db,
  input: {
    organizationId: string;
    resourceType: 'User' | 'Group';
    internalId: string;
    externalId?: string;
    lastActiveRole?: string;
  },
): Promise<void> {
  const now = Date.now();
  await db`
    INSERT INTO app.sso_provisioning_links (
      org_id, resource_type, internal_id, external_id, last_active_role,
      created_at_ms, updated_at_ms
    ) VALUES (
      ${input.organizationId}, ${input.resourceType}, ${input.internalId},
      ${input.externalId ?? null}, ${input.lastActiveRole ?? null},
      ${now}, ${now}
    )
    ON CONFLICT (org_id, internal_id) DO UPDATE SET
      external_id = CASE
        WHEN ${input.externalId !== undefined}
        THEN ${input.externalId ?? null}
        ELSE app.sso_provisioning_links.external_id END,
      last_active_role = CASE
        WHEN ${input.lastActiveRole !== undefined}
        THEN ${input.lastActiveRole ?? null}
        ELSE app.sso_provisioning_links.last_active_role END,
      updated_at_ms = ${now}
  `;
}

async function deleteLink(
  db: Db,
  organizationId: string,
  internalId: string,
): Promise<void> {
  await db`
    DELETE FROM app.sso_provisioning_links
    WHERE org_id = ${organizationId} AND internal_id = ${internalId}
  `;
}

// ---------------------------------------------------------------- audit

async function logScim(
  db: TransactionSql,
  organizationId: string,
  action: string,
  resourceType: string,
  resourceId: string,
  resourceName: string,
  states?: {
    previous?: Record<string, unknown>;
    next?: Record<string, unknown>;
  },
): Promise<void> {
  await createAuditLog(db, {
    organizationId,
    actorId: 'scim',
    actorType: 'api',
    action,
    category: 'member',
    resourceType,
    resourceId,
    resourceName,
    ...(states?.previous !== undefined
      ? { previousState: states.previous }
      : {}),
    ...(states?.next !== undefined ? { newState: states.next } : {}),
    status: 'success',
  });
}

// ---------------------------------------------------------------- users

interface UserRow {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

interface MemberRow {
  id: string;
  role: string;
}

async function findUserRowByEmail(
  db: Db,
  email: string,
): Promise<UserRow | null> {
  const rows = await db<UserRow[]>`
    SELECT "id", "email", "name", "createdAt", "updatedAt"
    FROM "user" WHERE "email" = ${normalizeAuthEmail(email)} LIMIT 1
  `;
  return rows[0] ?? null;
}

async function findUserRowById(
  db: Db,
  userId: string,
): Promise<UserRow | null> {
  const rows = await db<UserRow[]>`
    SELECT "id", "email", "name", "createdAt", "updatedAt"
    FROM "user" WHERE "id" = ${userId} LIMIT 1
  `;
  return rows[0] ?? null;
}

async function findMemberRow(
  db: Db,
  organizationId: string,
  userId: string,
): Promise<MemberRow | null> {
  const rows = await db<MemberRow[]>`
    SELECT "id", "role" FROM "member"
    WHERE "organizationId" = ${organizationId} AND "userId" = ${userId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * The SCIM `userName` rewrite contract. `"user".email` is the account's
 * GLOBAL sign-in identity — one row that every org the user belongs to reads
 * — so an org's IdP may rewrite it only when that account is the org's alone:
 *  1. unchanged after normalization → nothing to write (null);
 *  2. another account already holds the address → `scim_user_conflict` (409
 *     `uniqueness`) instead of the unique-index 500 an IdP retries forever as
 *     a server fault;
 *  3. the account has a membership in ANY other org → `scim_identity_shared`
 *     (403 `mutability`): this org's IdP has no authority over an identity
 *     other tenants rely on. Otherwise one org's SCIM could redirect a
 *     cross-org user's login identity everywhere — and, with a password reset
 *     to the redirected address, take the account over. It is the cross-org
 *     authority rule of the credential-reset door (#3159) applied to SCIM:
 *     act on the global account only when every org it belongs to is under
 *     your authority, and a SCIM token's authority is exactly its own org.
 * `active`, `externalId` and the display name stay org-scoped and apply as
 * before (the create path already renames only a member of this org).
 */
async function planEmailChange(
  db: Db,
  organizationId: string,
  userId: string,
  requestedEmail: string,
): Promise<string | null> {
  const nextEmail = normalizeAuthEmail(requestedEmail);
  const current = await findUserRowById(db, userId);
  if (current === null || current.email === nextEmail) return null;
  const holder = await findUserRowByEmail(db, nextEmail);
  if (holder !== null && holder.id !== userId) {
    throw new AppError({
      code: 'scim_user_conflict',
      message: `userName ${nextEmail} is already taken`,
    });
  }
  const memberships = await db<{ organizationId: string }[]>`
    SELECT "organizationId" FROM "member" WHERE "userId" = ${userId}
  `;
  if (memberships.some((m) => m.organizationId !== organizationId)) {
    throw new AppError({
      code: 'scim_identity_shared',
      message:
        'Cannot change the userName of an account that belongs to other organizations',
    });
  }
  return nextEmail;
}

/**
 * Every member id an IdP writes into a Group must be a member of the token's
 * org: a foreign or unknown id is an RFC 7644 `invalidValue` (400), never a
 * teamMember row — otherwise a miskeyed or hostile payload stitches another
 * tenant's user into this org's team (returned by later SCIM reads and every
 * app-side team query), or a garbage id becomes an opaque 500.
 */
async function assertOrgMembers(
  db: Db,
  organizationId: string,
  userIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return;
  const rows = await db<{ userId: string }[]>`
    SELECT "userId" FROM "member"
    WHERE "organizationId" = ${organizationId} AND "userId" = ANY(${ids})
  `;
  const known = new Set(rows.map((row) => row.userId));
  const foreign = ids.filter((id) => !known.has(id));
  if (foreign.length > 0) {
    throw new AppError({
      code: 'scim_invalid_member',
      message: `Not members of this organization: ${foreign.join(', ')}`,
    });
  }
}

function toUserRecord(
  user: UserRow,
  member: MemberRow,
  externalId: string | null,
): ScimUserRecord {
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    active: (member.role ?? '').toLowerCase() !== 'disabled',
    ...(externalId !== null ? { externalId } : {}),
    createdAt: user.createdAt.getTime(),
    updatedAt: user.updatedAt.getTime(),
  };
}

export async function getUserRecord(
  sql: Sql,
  organizationId: string,
  userId: string,
): Promise<ScimUserRecord | null> {
  const member = await findMemberRow(sql, organizationId, userId);
  if (!member) return null;
  const user = await findUserRowById(sql, userId);
  if (!user) return null;
  const link = await getLink(sql, organizationId, userId);
  return toUserRecord(user, member, link?.externalId ?? null);
}

export async function findUserRecordByUserName(
  sql: Sql,
  organizationId: string,
  userName: string,
): Promise<ScimUserRecord | null> {
  const user = await findUserRowByEmail(sql, userName);
  if (!user) return null;
  const member = await findMemberRow(sql, organizationId, user.id);
  if (!member) return null;
  const link = await getLink(sql, organizationId, user.id);
  return toUserRecord(user, member, link?.externalId ?? null);
}

export async function listUserRecords(
  sql: Sql,
  organizationId: string,
): Promise<ScimUserRecord[]> {
  const rows = await sql<
    (UserRow & { memberId: string; role: string; externalId: string | null })[]
  >`
    SELECT u."id", u."email", u."name", u."createdAt", u."updatedAt",
           m."id" AS "memberId", m."role",
           l.external_id AS "externalId"
    FROM "member" m
    JOIN "user" u ON u."id" = m."userId"
    LEFT JOIN app.sso_provisioning_links l
      ON l.org_id = m."organizationId" AND l.internal_id = u."id"
    WHERE m."organizationId" = ${organizationId}
  `;
  return rows.map((row) =>
    toUserRecord(row, { id: row.memberId, role: row.role }, row.externalId),
  );
}

/** Create-or-upsert a user + org membership from a SCIM User resource —
 * idempotent on (org, email); a cross-tenant email match refuses. */
export async function provisionUser(
  sql: Sql,
  args: {
    organizationId: string;
    defaultRole: string;
    email: string;
    name: string;
    externalId?: string;
    active: boolean;
  },
): Promise<ScimUserRecord> {
  return sql.begin(async (tx) => {
    const email = normalizeAuthEmail(args.email);
    const now = new Date();
    const existingUser = await findUserRowByEmail(tx, email);

    let userId: string;
    let memberHere: MemberRow | null = null;
    if (existingUser) {
      const memberships = await tx<{ organizationId: string }[]>`
        SELECT "organizationId" FROM "member"
        WHERE "userId" = ${existingUser.id}
      `;
      if (
        classifyUserOwnership(memberships, args.organizationId) ===
        'owned-elsewhere'
      ) {
        throw new AppError({
          code: 'scim_user_conflict',
          message: `User ${args.email} belongs to another organization`,
        });
      }
      memberHere = await findMemberRow(
        tx,
        args.organizationId,
        existingUser.id,
      );
      userId = existingUser.id;
      // Only rename when this org already owns the membership — a SCIM token
      // must not rewrite the global user row of an account it does not own.
      if (memberHere && args.name && existingUser.name !== args.name) {
        await tx`
          UPDATE "user" SET "name" = ${args.name}, "updatedAt" = ${now}
          WHERE "id" = ${userId}
        `;
      }
    } else {
      const created = await tx<{ id: string }[]>`
        INSERT INTO "user" (
          "id", "email", "name", "emailVerified", "createdAt", "updatedAt"
        ) VALUES (
          gen_random_uuid(), ${email}, ${args.name}, true, ${now}, ${now}
        )
        RETURNING "id"
      `;
      const createdId = created[0]?.id;
      if (createdId === undefined) throw new Error('user insert failed');
      userId = createdId;
    }

    const link = await getLink(tx, args.organizationId, userId);
    const plan = planActivation(
      args.active,
      memberHere?.role,
      args.defaultRole,
      link?.lastActiveRole ?? undefined,
    );

    if (!memberHere) {
      await tx`
        INSERT INTO "member" (
          "id", "organizationId", "userId", "role", "createdAt"
        ) VALUES (
          gen_random_uuid(), ${args.organizationId}, ${userId},
          ${plan.role}, ${now}
        )
      `;
    } else if ((memberHere.role ?? '').toLowerCase() !== plan.role) {
      await tx`
        UPDATE "member" SET "role" = ${plan.role}
        WHERE "id" = ${memberHere.id}
      `;
    }

    await upsertLink(tx, {
      organizationId: args.organizationId,
      resourceType: 'User',
      internalId: userId,
      ...(args.externalId !== undefined ? { externalId: args.externalId } : {}),
      lastActiveRole: plan.restoreRole,
    });
    await logScim(
      tx,
      args.organizationId,
      'scim_provision_user',
      'member',
      userId,
      email,
      { next: { role: plan.role, active: args.active } },
    );

    return {
      userId,
      email,
      name: args.name,
      active: args.active,
      ...(args.externalId !== undefined ? { externalId: args.externalId } : {}),
    };
  });
}

/**
 * SCIM User PATCH/PUT: active toggle (soft-deactivate/restore) + name/email.
 * Two refusals answer inside the transaction BEFORE any write, so a refused
 * operation changes nothing (PATCH is atomic):
 *  - `active:false` on the owner → `scim_owner_protected` (403 `mutability`),
 *    the SAME protection DELETE has. Writing role=disabled onto the owner
 *    made `requireOrgMember` refuse their every request, so an IdP
 *    unassigning the app for the owner locked the whole org out of
 *    administration with no in-app way back;
 *  - a `userName` rewrite that fails the identity contract of
 *    `planEmailChange` (collision → 409, shared account → 403).
 */
export async function patchUser(
  sql: Sql,
  args: {
    organizationId: string;
    userId: string;
    defaultRole: string;
    active?: boolean;
    name?: string;
    email?: string;
    externalId?: string;
  },
): Promise<ScimUserRecord | null> {
  return sql.begin(async (tx) => {
    const member = await findMemberRow(tx, args.organizationId, args.userId);
    if (!member) return null;
    if (
      args.active === false &&
      classifyDeprovision(member) === 'owner-protected'
    ) {
      throw new AppError({
        code: 'scim_owner_protected',
        message: 'Cannot deactivate the organization owner',
      });
    }
    const now = new Date();

    if (args.externalId !== undefined) {
      await upsertLink(tx, {
        organizationId: args.organizationId,
        resourceType: 'User',
        internalId: args.userId,
        externalId: args.externalId,
      });
    }

    const nextEmail =
      args.email !== undefined
        ? await planEmailChange(
            tx,
            args.organizationId,
            args.userId,
            args.email,
          )
        : null;
    if (args.name !== undefined || nextEmail !== null) {
      try {
        await tx`
          UPDATE "user" SET
            "name" = CASE WHEN ${args.name !== undefined}
              THEN ${args.name ?? null} ELSE "name" END,
            "email" = CASE WHEN ${nextEmail !== null}
              THEN ${nextEmail} ELSE "email" END,
            "updatedAt" = ${now}
          WHERE "id" = ${args.userId}
        `;
      } catch (error) {
        // The pre-check can lose a race against a concurrent claim of the
        // same address; the unique index has the last word — still a 409.
        if (nextEmail !== null && isUniqueViolation(error)) {
          throw new AppError({
            code: 'scim_user_conflict',
            message: `userName ${nextEmail} is already taken`,
          });
        }
        throw error;
      }
    }

    let role = (member.role ?? '').toLowerCase();
    if (args.active !== undefined) {
      const link = await getLink(tx, args.organizationId, args.userId);
      const plan = planActivation(
        args.active,
        member.role,
        args.defaultRole,
        link?.lastActiveRole ?? undefined,
      );
      if (plan.role !== role) {
        await tx`
          UPDATE "member" SET "role" = ${plan.role} WHERE "id" = ${member.id}
        `;
        role = plan.role;
      }
      await upsertLink(tx, {
        organizationId: args.organizationId,
        resourceType: 'User',
        internalId: args.userId,
        lastActiveRole: plan.restoreRole,
      });
      await logScim(
        tx,
        args.organizationId,
        args.active ? 'scim_activate_user' : 'scim_deactivate_user',
        'member',
        args.userId,
        args.email ?? args.userId,
        { next: { role } },
      );
    }

    return {
      userId: args.userId,
      email: args.email ?? '',
      name: args.name ?? '',
      active: role !== 'disabled',
    };
  });
}

/** SCIM DELETE: hard de-provision (membership + link gone; the global user
 * row is preserved). The sole owner is protected. */
export async function deprovisionUser(
  sql: Sql,
  organizationId: string,
  userId: string,
): Promise<'deprovisioned' | 'not-found' | 'owner-protected'> {
  return sql.begin(async (tx) => {
    const member = await findMemberRow(tx, organizationId, userId);
    const verdict = classifyDeprovision(member ?? undefined);
    if (verdict === 'not-found' || verdict === 'owner-protected') {
      return verdict;
    }
    if (!member) return 'not-found';
    const user = await findUserRowById(tx, userId);
    await tx`DELETE FROM "member" WHERE "id" = ${member.id}`;
    await deleteLink(tx, organizationId, userId);
    await logScim(
      tx,
      organizationId,
      'scim_deprovision_user',
      'member',
      userId,
      user?.email ?? userId,
      { previous: { role: member.role } },
    );
    return 'deprovisioned';
  });
}

// ---------------------------------------------------------------- groups

interface TeamRow {
  id: string;
  name: string;
  organizationId: string;
  createdAt: Date;
  updatedAt: Date | null;
}

async function findTeamRowById(
  db: Db,
  teamId: string,
): Promise<TeamRow | null> {
  const rows = await db<TeamRow[]>`
    SELECT "id", "name", "organizationId", "createdAt", "updatedAt"
    FROM "team" WHERE "id" = ${teamId} LIMIT 1
  `;
  return rows[0] ?? null;
}

async function listTeamMemberUserIds(
  db: Db,
  teamId: string,
): Promise<{ id: string; userId: string }[]> {
  return db<{ id: string; userId: string }[]>`
    SELECT "id", "userId" FROM "teamMember" WHERE "teamId" = ${teamId}
  `;
}

function toGroupRecord(
  team: TeamRow,
  memberUserIds: string[],
  externalId: string | null,
): ScimGroupRecord {
  return {
    teamId: team.id,
    displayName: team.name,
    memberUserIds,
    ...(externalId !== null ? { externalId } : {}),
    createdAt: team.createdAt.getTime(),
    ...(team.updatedAt !== null ? { updatedAt: team.updatedAt.getTime() } : {}),
  };
}

async function setTeamMembers(
  tx: TransactionSql,
  organizationId: string,
  teamId: string,
  desiredUserIds: string[],
): Promise<void> {
  await assertOrgMembers(tx, organizationId, desiredUserIds);
  const current = await listTeamMemberUserIds(tx, teamId);
  const currentIds = new Set(current.map((m) => m.userId));
  const desired = new Set(desiredUserIds);
  for (const userId of desired) {
    if (!currentIds.has(userId)) {
      await tx`
        INSERT INTO "teamMember" ("id", "teamId", "userId", "createdAt")
        VALUES (gen_random_uuid(), ${teamId}, ${userId}, ${new Date()})
      `;
    }
  }
  for (const m of current) {
    if (!desired.has(m.userId)) {
      await tx`DELETE FROM "teamMember" WHERE "id" = ${m.id}`;
    }
  }
}

export async function getGroupRecord(
  sql: Sql,
  organizationId: string,
  teamId: string,
): Promise<ScimGroupRecord | null> {
  const team = await findTeamRowById(sql, teamId);
  if (!team || team.organizationId !== organizationId) return null;
  const members = await listTeamMemberUserIds(sql, teamId);
  const link = await getLink(sql, organizationId, teamId);
  return toGroupRecord(
    team,
    members.map((m) => m.userId),
    link?.externalId ?? null,
  );
}

export async function findGroupRecordByDisplayName(
  sql: Sql,
  organizationId: string,
  displayName: string,
): Promise<ScimGroupRecord | null> {
  const rows = await sql<TeamRow[]>`
    SELECT "id", "name", "organizationId", "createdAt", "updatedAt"
    FROM "team"
    WHERE "organizationId" = ${organizationId}
      AND lower("name") = ${displayName.toLowerCase()}
    LIMIT 1
  `;
  const team = rows[0];
  if (!team) return null;
  const members = await listTeamMemberUserIds(sql, team.id);
  const link = await getLink(sql, organizationId, team.id);
  return toGroupRecord(
    team,
    members.map((m) => m.userId),
    link?.externalId ?? null,
  );
}

export async function listGroupRecords(
  sql: Sql,
  organizationId: string,
): Promise<ScimGroupRecord[]> {
  const teams = await sql<TeamRow[]>`
    SELECT "id", "name", "organizationId", "createdAt", "updatedAt"
    FROM "team" WHERE "organizationId" = ${organizationId}
  `;
  const records: ScimGroupRecord[] = [];
  for (const team of teams) {
    const members = await listTeamMemberUserIds(sql, team.id);
    const link = await getLink(sql, organizationId, team.id);
    records.push(
      toGroupRecord(
        team,
        members.map((m) => m.userId),
        link?.externalId ?? null,
      ),
    );
  }
  return records;
}

export async function provisionGroup(
  sql: Sql,
  args: {
    organizationId: string;
    displayName: string;
    externalId?: string;
    memberIds: string[];
  },
): Promise<ScimGroupRecord> {
  return sql.begin(async (tx) => {
    const now = new Date();
    const created = await tx<{ id: string }[]>`
      INSERT INTO "team" ("id", "name", "organizationId", "createdAt",
                          "updatedAt")
      VALUES (gen_random_uuid(), ${args.displayName},
              ${args.organizationId}, ${now}, ${now})
      RETURNING "id"
    `;
    const teamId = created[0]?.id;
    if (teamId === undefined) throw new Error('team insert failed');
    await setTeamMembers(tx, args.organizationId, teamId, args.memberIds);
    await upsertLink(tx, {
      organizationId: args.organizationId,
      resourceType: 'Group',
      internalId: teamId,
      ...(args.externalId !== undefined ? { externalId: args.externalId } : {}),
    });
    await logScim(
      tx,
      args.organizationId,
      'scim_provision_group',
      'team',
      teamId,
      args.displayName,
      { next: { members: args.memberIds.length } },
    );
    return {
      teamId,
      displayName: args.displayName,
      memberUserIds: args.memberIds,
      ...(args.externalId !== undefined ? { externalId: args.externalId } : {}),
    };
  });
}

export async function replaceGroup(
  sql: Sql,
  args: {
    organizationId: string;
    teamId: string;
    displayName: string;
    memberIds: string[];
    externalId?: string;
  },
): Promise<ScimGroupRecord | null> {
  return sql.begin(async (tx) => {
    const team = await findTeamRowById(tx, args.teamId);
    if (!team || team.organizationId !== args.organizationId) return null;
    if (args.externalId !== undefined) {
      await upsertLink(tx, {
        organizationId: args.organizationId,
        resourceType: 'Group',
        internalId: args.teamId,
        externalId: args.externalId,
      });
    }
    if (team.name !== args.displayName) {
      await tx`
        UPDATE "team" SET "name" = ${args.displayName},
                          "updatedAt" = ${new Date()}
        WHERE "id" = ${args.teamId}
      `;
    }
    await setTeamMembers(tx, args.organizationId, args.teamId, args.memberIds);
    const link = await getLink(tx, args.organizationId, args.teamId);
    await logScim(
      tx,
      args.organizationId,
      'scim_replace_group',
      'team',
      args.teamId,
      args.displayName,
    );
    return {
      teamId: args.teamId,
      displayName: args.displayName,
      memberUserIds: args.memberIds,
      ...(link?.externalId != null ? { externalId: link.externalId } : {}),
    };
  });
}

export async function patchGroup(
  sql: Sql,
  args: {
    organizationId: string;
    teamId: string;
    displayName?: string;
    addMembers: string[];
    removeMembers: string[];
    replaceMembers?: string[];
  },
): Promise<ScimGroupRecord | null> {
  return sql.begin(async (tx) => {
    const team = await findTeamRowById(tx, args.teamId);
    if (!team || team.organizationId !== args.organizationId) return null;

    let displayName = team.name;
    if (args.displayName !== undefined && args.displayName !== team.name) {
      displayName = args.displayName;
      await tx`
        UPDATE "team" SET "name" = ${displayName}, "updatedAt" = ${new Date()}
        WHERE "id" = ${args.teamId}
      `;
    }

    if (args.replaceMembers !== undefined) {
      await setTeamMembers(
        tx,
        args.organizationId,
        args.teamId,
        composeDesiredMembers(
          args.replaceMembers,
          args.addMembers,
          args.removeMembers,
        ),
      );
    } else {
      await assertOrgMembers(tx, args.organizationId, args.addMembers);
      const current = await listTeamMemberUserIds(tx, args.teamId);
      const currentIds = new Set(current.map((m) => m.userId));
      for (const userId of args.addMembers) {
        if (!currentIds.has(userId)) {
          await tx`
            INSERT INTO "teamMember" ("id", "teamId", "userId", "createdAt")
            VALUES (gen_random_uuid(), ${args.teamId}, ${userId},
                    ${new Date()})
          `;
        }
      }
      const removeSet = new Set(args.removeMembers);
      for (const m of current) {
        if (removeSet.has(m.userId)) {
          await tx`DELETE FROM "teamMember" WHERE "id" = ${m.id}`;
        }
      }
    }

    const link = await getLink(tx, args.organizationId, args.teamId);
    const members = await listTeamMemberUserIds(tx, args.teamId);
    await logScim(
      tx,
      args.organizationId,
      'scim_patch_group',
      'team',
      args.teamId,
      displayName,
    );
    return {
      teamId: args.teamId,
      displayName,
      memberUserIds: members.map((m) => m.userId),
      ...(link?.externalId != null ? { externalId: link.externalId } : {}),
    };
  });
}

export async function deleteGroup(
  sql: Sql,
  organizationId: string,
  teamId: string,
): Promise<boolean> {
  const retirement = await sql.begin<TeamScopeRetirement | null>(async (tx) => {
    const team = await findTeamRowById(tx, teamId);
    if (!team || team.organizationId !== organizationId) return null;
    await tx`DELETE FROM "teamMember" WHERE "teamId" = ${teamId}`;
    await tx`DELETE FROM "team" WHERE "id" = ${teamId}`;
    await deleteLink(tx, organizationId, teamId);
    // The rows the group scoped follow it out in the same transaction:
    // a project it owned, a folder tagged with it, a queue on it.
    const retired = await retireTeamScopes(tx, organizationId, teamId);
    await logScim(
      tx,
      organizationId,
      'scim_delete_group',
      'team',
      teamId,
      team.name,
      {
        next: {
          projectsUnscoped: retired.projectsUnscoped,
          projectsUnshared: retired.projectsUnshared,
          foldersRetagged: retired.foldersRetagged,
          documentsRetagged: retired.documentsRetagged,
          conversationsUnassigned: retired.conversationsUnassigned,
          syncConfigsUnscoped: retired.syncConfigsUnscoped,
        },
      },
    );
    return retired;
  });
  if (retirement === null) return false;
  await resyncRetiredDocumentScopes(sql, organizationId, retirement);
  return true;
}

// ---------------------------------------------------------------- admin

export interface ScimStatus {
  enabled: boolean;
  tokenPrefix: string;
  generatedAt: number | null;
  lastUsedAt: number | null;
}

export async function getScimStatus(
  sql: Sql,
  organizationId: string,
): Promise<ScimStatus> {
  const rows = await sql<
    {
      scimEnabled: boolean;
      scimTokenPrefix: string;
      generatedAt: number | null;
      lastUsedAt: number | null;
    }[]
  >`
    SELECT scim_enabled AS "scimEnabled",
           scim_token_prefix AS "scimTokenPrefix",
           scim_token_generated_at_ms::float8 AS "generatedAt",
           scim_last_used_at_ms::float8 AS "lastUsedAt"
    FROM app.sso_connections WHERE org_id = ${organizationId} LIMIT 1
  `;
  const row = rows[0];
  return {
    enabled: row?.scimEnabled ?? false,
    tokenPrefix: row?.scimTokenPrefix ?? '',
    generatedAt: row?.generatedAt ?? null,
    lastUsedAt: row?.lastUsedAt ?? null,
  };
}

/** Generate (or rotate) the org's SCIM bearer token and enable provisioning.
 * The plaintext is returned EXACTLY ONCE — only its hash persists. */
export async function regenerateScimToken(
  sql: Sql,
  args: {
    organizationId: string;
    actorId: string;
    actorEmail?: string;
    actorRole?: string;
    token: string;
    tokenHash: string;
    tokenPrefix: string;
  },
): Promise<{ rotated: boolean }> {
  return sql.begin(async (tx) => {
    const now = Date.now();
    const existing = await tx<{ id: string }[]>`
      SELECT id FROM app.sso_connections
      WHERE org_id = ${args.organizationId} LIMIT 1
    `;
    const rotated = existing.length > 0;
    await tx`
      INSERT INTO app.sso_connections (
        org_id, scim_enabled, scim_token_hash, scim_token_prefix,
        scim_token_generated_at_ms, created_by, created_at_ms, updated_at_ms
      ) VALUES (
        ${args.organizationId}, true, ${args.tokenHash}, ${args.tokenPrefix},
        ${now}, ${args.actorId}, ${now}, ${now}
      )
      ON CONFLICT (org_id) DO UPDATE SET
        scim_enabled = true,
        scim_token_hash = ${args.tokenHash},
        scim_token_prefix = ${args.tokenPrefix},
        scim_token_generated_at_ms = ${now},
        updated_at_ms = ${now}
    `;
    await createAuditLog(tx, {
      organizationId: args.organizationId,
      actorId: args.actorId,
      ...(args.actorEmail !== undefined ? { actorEmail: args.actorEmail } : {}),
      actorType: 'user',
      action: rotated ? 'scim_token_rotated' : 'scim_enabled',
      category: 'security',
      resourceType: 'scim',
      resourceId: args.organizationId,
      newState: { tokenPrefix: args.tokenPrefix },
      status: 'success',
    });
    return { rotated };
  });
}

/** Disable SCIM and revoke the token (clears the stored hash). */
export async function disableScim(
  sql: Sql,
  args: { organizationId: string; actorId: string; actorEmail?: string },
): Promise<void> {
  await sql.begin(async (tx) => {
    const updated = await tx<{ id: string }[]>`
      UPDATE app.sso_connections SET
        scim_enabled = false, scim_token_hash = '', scim_token_prefix = '',
        updated_at_ms = ${Date.now()}
      WHERE org_id = ${args.organizationId}
      RETURNING id
    `;
    if (updated.length === 0) return;
    await createAuditLog(tx, {
      organizationId: args.organizationId,
      actorId: args.actorId,
      ...(args.actorEmail !== undefined ? { actorEmail: args.actorEmail } : {}),
      actorType: 'user',
      action: 'scim_disabled',
      category: 'security',
      resourceType: 'scim',
      resourceId: args.organizationId,
      status: 'success',
    });
  });
}
