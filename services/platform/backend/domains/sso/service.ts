import { generateId } from 'better-auth';
import type { Sql } from 'postgres';

import { sessionExpiryMs } from '../../../lib/shared/session-idle.ts';
import { mapEntraRoleToPlatformRole } from '../../core/enterprise_sso/entra_id/role_mapping.ts';
import type {
  PlatformRole,
  SsoUserInfo,
} from '../../core/enterprise_sso/types.ts';
import { normalizeAuthEmail } from '../../core/lib/auth/normalize_auth_email.ts';
import { anchorTwoFactorGraceOnSignIn } from '../two_factor/service.ts';
import { resolveProvisioning } from './config.ts';

/**
 * SSO storage + login orchestration — the 0.5 twin of
 * `enterprise_sso/{find_or_create_sso_user,create_user_session,handle_sso_login}.ts`
 * and `entra_id/team_sync.ts`: the SAME choreography, written straight onto
 * the Better Auth tables ("user"/"account"/"member"/"team"/"teamMember"/
 * "session") instead of the Convex component adapter. The 0.4 memberMirror /
 * teamMemberMirror caches existed only for the Convex runtime split (rule 5)
 * — 0.5 reads the tables directly, so no mirror is maintained.
 */

// ---------------------------------------------------------------- users

export interface FindOrCreateSsoUserArgs {
  email: string;
  name: string;
  externalId: string;
  providerId: string;
  accessToken: string;
  refreshToken?: string;
  accessTokenExpiresAt?: number;
  scope?: string;
  organizationId: string;
  role: PlatformRole;
  /** Re-apply `role` on every login (IdP-authoritative roles). */
  syncRole?: boolean;
}

function toDate(ms: number | undefined): Date | null {
  return ms === undefined ? null : new Date(ms);
}

/**
 * Whether to overwrite an existing membership's role with the IdP-mapped role on
 * login. Only when "auto-assign roles from the IdP" is on (`syncRole`), never
 * for an `owner` (that would orphan the org), and not for a no-op.
 */
export function shouldSyncMemberRole(
  syncRole: boolean | undefined,
  currentRole: string | undefined,
  newRole: string,
): boolean {
  return (
    Boolean(syncRole) && currentRole !== 'owner' && currentRole !== newRole
  );
}

export interface FindOrCreateSsoUserResult {
  userId: string | null;
  isNewUser: boolean;
  /**
   * `existing_user_not_in_org`: the asserted email belongs to a user with NO
   * membership in the connection's org — the login is refused before any
   * write. Org admins self-serve their IdP config, so honouring the match
   * would let a hostile org's IdP assert any known email and walk away with
   * a session as that user (cross-org account takeover).
   */
  refusal?: 'existing_user_not_in_org';
}

/**
 * Find or create the user + provider account + org membership, under the
 * org-binding contract: an org's IdP may sign in users the org already has
 * (a `member` row — invited and accepted, SCIM-provisioned, or admin-added)
 * and may JIT-create users NEW to the deployment, but never attaches to an
 * existing user from outside the org. Token columns refresh on every login;
 * an existing membership's role syncs only under `syncRole` and never off
 * `owner` (that would orphan the org).
 */
export async function findOrCreateSsoUser(
  sql: Sql,
  args: FindOrCreateSsoUserArgs,
): Promise<FindOrCreateSsoUserResult> {
  const email = normalizeAuthEmail(args.email);
  return sql.begin(async (tx) => {
    const now = new Date();
    const users = await tx<{ id: string }[]>`
      SELECT "id" FROM "user" WHERE "email" = ${email} LIMIT 1
    `;
    const existingUserId = users[0]?.id;

    if (existingUserId !== undefined) {
      // Membership gates EVERYTHING for an existing user — checked first,
      // inside the transaction, so a refusal writes nothing (no account
      // link, no auto-join, no session for the caller to mint).
      const members = await tx<{ id: string; role: string }[]>`
        SELECT "id", "role" FROM "member"
        WHERE "organizationId" = ${args.organizationId}
          AND "userId" = ${existingUserId}
        LIMIT 1
      `;
      const member = members[0];
      if (member === undefined) {
        return {
          userId: null,
          isNewUser: false,
          refusal: 'existing_user_not_in_org' as const,
        };
      }

      const accounts = await tx<{ id: string }[]>`
        SELECT "id" FROM "account"
        WHERE "userId" = ${existingUserId}
          AND "providerId" = ${args.providerId}
        LIMIT 1
      `;
      const account = accounts[0];
      if (account === undefined) {
        await tx`
          INSERT INTO "account" (
            "id", "userId", "providerId", "accountId", "accessToken",
            "refreshToken", "accessTokenExpiresAt", "scope", "createdAt",
            "updatedAt"
          ) VALUES (
            gen_random_uuid(), ${existingUserId}, ${args.providerId},
            ${args.externalId}, ${args.accessToken},
            ${args.refreshToken ?? null},
            ${toDate(args.accessTokenExpiresAt)}, ${args.scope ?? null},
            ${now}, ${now}
          )
        `;
      } else {
        await tx`
          UPDATE "account" SET
            "accountId" = ${args.externalId},
            "accessToken" = ${args.accessToken},
            "refreshToken" = ${args.refreshToken ?? null},
            "accessTokenExpiresAt" = ${toDate(args.accessTokenExpiresAt)},
            "scope" = ${args.scope ?? null},
            "updatedAt" = ${now}
          WHERE "id" = ${account.id}
        `;
      }

      if (shouldSyncMemberRole(args.syncRole, member.role, args.role)) {
        await tx`
          UPDATE "member" SET "role" = ${args.role} WHERE "id" = ${member.id}
        `;
      }
      return { userId: existingUserId, isNewUser: false };
    }

    const created = await tx<{ id: string }[]>`
      INSERT INTO "user" (
        "id", "email", "name", "emailVerified", "createdAt", "updatedAt"
      ) VALUES (
        gen_random_uuid(), ${email}, ${args.name}, true, ${now}, ${now}
      )
      RETURNING "id"
    `;
    const userId = created[0]?.id;
    if (userId === undefined) {
      throw new Error('Failed to create the SSO user');
    }
    await tx`
      INSERT INTO "account" (
        "id", "userId", "providerId", "accountId", "accessToken",
        "refreshToken", "accessTokenExpiresAt", "scope", "createdAt",
        "updatedAt"
      ) VALUES (
        gen_random_uuid(), ${userId}, ${args.providerId}, ${args.externalId},
        ${args.accessToken}, ${args.refreshToken ?? null},
        ${toDate(args.accessTokenExpiresAt)}, ${args.scope ?? null},
        ${now}, ${now}
      )
    `;
    await tx`
      INSERT INTO "member" (
        "id", "organizationId", "userId", "role", "createdAt"
      ) VALUES (
        gen_random_uuid(), ${args.organizationId}, ${userId}, ${args.role},
        ${now}
      )
    `;
    return { userId, isNewUser: true };
  });
}

// ---------------------------------------------------------------- session

/**
 * Mint a Better Auth session row for an SSO login — 30 days unless a session
 * idle timeout is configured (the 0.4 `createUserSession` contract). The
 * caller signs the token into the cookie; Better Auth verifies the signature
 * and reads this row on every request. `activeOrganizationId` is bound to
 * the connection's org: the session an org's IdP minted starts IN that org
 * (switching later still passes Better Auth's own membership check).
 */
export async function createSsoUserSession(
  sql: Sql,
  args: { userId: string; organizationId: string },
): Promise<{ sessionToken: string }> {
  const sessionToken = generateId(32);
  const now = Date.now();
  const expiresAt = sessionExpiryMs(now, 30 * 24 * 60 * 60 * 1000);
  await sql`
    INSERT INTO "session" (
      "id", "token", "userId", "expiresAt", "createdAt", "updatedAt",
      "activeOrganizationId"
    ) VALUES (
      gen_random_uuid(), ${sessionToken}, ${args.userId},
      ${new Date(expiresAt)}, ${new Date(now)}, ${new Date(now)},
      ${args.organizationId}
    )
  `;
  return { sessionToken };
}

// ---------------------------------------------------------------- teams

export interface SyncTeamsResult {
  teamsCreated: number;
  membershipsAdded: number;
  membershipsRemoved: number;
  errors: string[];
}

/**
 * Protocol-agnostic group→team sync (the 0.4 `syncTeamsFromGroupNames`
 * semantics, made provenance-scoped): create-if-missing by case-insensitive
 * name, add membership, then reconcile — over what THIS sync created and
 * nothing else. Provenance rides `app.sso_synced_teams` /
 * `app.sso_synced_team_members` (migration 0071); the rule:
 *
 *  - a membership the sync inserted is removed when its group leaves the
 *    claim; a membership an admin granted (or SCIM composed) is never touched,
 *    even in a same-named team the sync also joins;
 *  - a team is reaped only when the sync created it, its last member just
 *    left, and no SCIM Group link claims it — admin-built and SCIM-managed
 *    teams survive, empty or not;
 *  - excluded group names are UNMANAGED: neither created nor pruned;
 *  - a provenance row whose team or membership is gone (admin delete, SCIM
 *    replace) is swept, and nothing else happens to it.
 *
 * Anything without a provenance row — every team and membership that predates
 * the migration included — reads as "not mine" and is preserved.
 */
export async function syncTeamsFromGroupNames(
  sql: Sql,
  args: {
    userId: string;
    organizationId: string;
    groupNames: string[];
    excludeGroups: string[];
  },
): Promise<SyncTeamsResult> {
  const result: SyncTeamsResult = {
    teamsCreated: 0,
    membershipsAdded: 0,
    membershipsRemoved: 0,
    errors: [],
  };
  const excludeLower = new Set(
    args.excludeGroups.map((g) => g.toLowerCase().trim()),
  );
  const syncable = args.groupNames.filter(
    (n) => !excludeLower.has(n.toLowerCase().trim()),
  );
  const nowMs = Date.now();

  const syncedNamesLower = new Set<string>();
  for (const name of syncable) {
    try {
      syncedNamesLower.add(name.toLowerCase());
      const teams = await sql<{ id: string }[]>`
        SELECT "id" FROM "team"
        WHERE "organizationId" = ${args.organizationId}
          AND lower("name") = ${name.toLowerCase()}
        LIMIT 1
      `;
      let teamId = teams[0]?.id;
      if (teamId === undefined) {
        const created = await sql<{ id: string }[]>`
          INSERT INTO "team" ("id", "name", "organizationId", "createdAt",
                              "updatedAt")
          VALUES (gen_random_uuid(), ${name}, ${args.organizationId},
                  ${new Date()}, ${new Date()})
          RETURNING "id"
        `;
        teamId = created[0]?.id;
        if (teamId === undefined) throw new Error('team insert failed');
        // Provenance: the sync created this team, so the sync may reap it.
        await sql`
          INSERT INTO app.sso_synced_teams (org_id, team_id, created_at_ms)
          VALUES (${args.organizationId}, ${teamId}, ${nowMs})
          ON CONFLICT DO NOTHING
        `;
        result.teamsCreated += 1;
      }
      const membership = await sql<{ id: string }[]>`
        SELECT "id" FROM "teamMember"
        WHERE "teamId" = ${teamId} AND "userId" = ${args.userId} LIMIT 1
      `;
      if (membership.length === 0) {
        await sql`
          INSERT INTO "teamMember" ("id", "teamId", "userId", "createdAt")
          VALUES (gen_random_uuid(), ${teamId}, ${args.userId}, ${new Date()})
        `;
        // Provenance: the sync granted this membership, so the sync may
        // revoke it. An existing membership (admin- or SCIM-granted) is NOT
        // adopted — it stays theirs.
        await sql`
          INSERT INTO app.sso_synced_team_members (
            org_id, team_id, user_id, created_at_ms
          ) VALUES (
            ${args.organizationId}, ${teamId}, ${args.userId}, ${nowMs}
          )
          ON CONFLICT DO NOTHING
        `;
        result.membershipsAdded += 1;
      }
    } catch (error) {
      result.errors.push(
        `Failed to sync group ${name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Reconcile: only the memberships THIS sync granted, in teams whose name
  // the claim no longer carries. Excluded names are unmanaged, not stale.
  const synced = await sql<
    { teamId: string; teamName: string | null; membershipId: string | null }[]
  >`
    SELECT p.team_id AS "teamId", t."name" AS "teamName",
           tm."id" AS "membershipId"
    FROM app.sso_synced_team_members p
    LEFT JOIN "team" t ON t."id" = p.team_id
    LEFT JOIN "teamMember" tm
      ON tm."teamId" = p.team_id AND tm."userId" = p.user_id
    WHERE p.org_id = ${args.organizationId} AND p.user_id = ${args.userId}
  `;
  for (const row of synced) {
    if (row.teamName !== null) {
      const lower = row.teamName.toLowerCase();
      if (syncedNamesLower.has(lower) || excludeLower.has(lower.trim())) {
        continue;
      }
    }
    if (row.membershipId !== null) {
      await sql`DELETE FROM "teamMember" WHERE "id" = ${row.membershipId}`;
      result.membershipsRemoved += 1;
    }
    await sql`
      DELETE FROM app.sso_synced_team_members
      WHERE org_id = ${args.organizationId}
        AND team_id = ${row.teamId} AND user_id = ${args.userId}
    `;
    if (row.teamName === null) {
      // The team itself is gone (admin, SCIM or org delete): sweep the stale
      // team provenance too — there is nothing left to reap.
      await sql`
        DELETE FROM app.sso_synced_teams
        WHERE org_id = ${args.organizationId} AND team_id = ${row.teamId}
      `;
      continue;
    }
    await reapEmptySyncedTeam(sql, args.organizationId, row.teamId);
  }
  return result;
}

/**
 * Delete a team the sync created once its last member is gone — never an
 * admin-built team (no provenance row) and never one a SCIM Group link
 * claims (SCIM owns its groups; the IdP's next group sync would 404 on a
 * vanished team, and its link row would be orphaned).
 */
async function reapEmptySyncedTeam(
  sql: Sql,
  organizationId: string,
  teamId: string,
): Promise<boolean> {
  const verdicts = await sql<
    { empty: boolean; syncCreated: boolean; scimManaged: boolean }[]
  >`
    SELECT
      NOT EXISTS (
        SELECT 1 FROM "teamMember" WHERE "teamId" = ${teamId}
      ) AS "empty",
      EXISTS (
        SELECT 1 FROM app.sso_synced_teams
        WHERE org_id = ${organizationId} AND team_id = ${teamId}
      ) AS "syncCreated",
      EXISTS (
        SELECT 1 FROM app.sso_provisioning_links
        WHERE org_id = ${organizationId} AND internal_id = ${teamId}
          AND resource_type = 'Group'
      ) AS "scimManaged"
  `;
  const verdict = verdicts[0];
  if (
    verdict === undefined ||
    !verdict.empty ||
    !verdict.syncCreated ||
    verdict.scimManaged
  ) {
    return false;
  }
  await sql`
    DELETE FROM "team"
    WHERE "id" = ${teamId} AND "organizationId" = ${organizationId}
  `;
  await sql`
    DELETE FROM app.sso_synced_teams
    WHERE org_id = ${organizationId} AND team_id = ${teamId}
  `;
  return true;
}

// ---------------------------------------------------------------- login

export interface HandleSsoLoginArgs {
  email: string;
  name: string;
  externalId: string;
  providerId: string;
  jobTitle?: string;
  appRoles?: string[];
  groups?: string[];
  rawClaims?: Record<string, unknown>;
  accessToken: string;
  refreshToken?: string;
  accessTokenExpiresAt?: number;
  scope?: string;
  organizationId: string;
}

export interface HandleSsoLoginResult {
  success: boolean;
  error?: string;
  sessionToken?: string;
  userId?: string;
}

/**
 * Shared sign-in provisioning — the 0.4 `handleSsoLogin` orchestration on
 * PG: role mapping (reused pure matcher), find-or-create, optional group→
 * team sync, session mint. Reached by every protocol after it normalizes
 * the IdP response into these args.
 */
export async function handleSsoLogin(
  sql: Sql,
  args: HandleSsoLoginArgs,
): Promise<HandleSsoLoginResult> {
  try {
    const config = await resolveProvisioning(sql, args.organizationId);

    let role: PlatformRole = config.defaultRole;
    if (config.autoProvisionRole) {
      const userInfo: SsoUserInfo = {
        externalId: args.externalId,
        email: args.email,
        name: args.name,
        ...(args.jobTitle !== undefined ? { jobTitle: args.jobTitle } : {}),
        ...(args.appRoles !== undefined ? { appRoles: args.appRoles } : {}),
        ...(args.groups !== undefined ? { groups: args.groups } : {}),
        ...(args.rawClaims !== undefined ? { rawClaims: args.rawClaims } : {}),
      };
      role = mapEntraRoleToPlatformRole(
        config.roleMappingRules,
        config.defaultRole,
        userInfo,
      );
    }

    const result = await findOrCreateSsoUser(sql, {
      email: args.email.toLowerCase(),
      name: args.name,
      externalId: args.externalId,
      providerId: args.providerId,
      accessToken: args.accessToken,
      ...(args.refreshToken !== undefined
        ? { refreshToken: args.refreshToken }
        : {}),
      ...(args.accessTokenExpiresAt !== undefined
        ? { accessTokenExpiresAt: args.accessTokenExpiresAt }
        : {}),
      ...(args.scope !== undefined ? { scope: args.scope } : {}),
      organizationId: args.organizationId,
      role,
      syncRole: config.autoProvisionRole,
    });
    if (result.userId === null) {
      if (result.refusal === 'existing_user_not_in_org') {
        // i18n key — the login page renders it; the raw string still reads
        // as an answer if a locale ever misses the key.
        return { success: false, error: 'sso.errors.notOrgMember' };
      }
      return { success: false, error: 'Failed to create or find user' };
    }

    if (config.autoProvisionTeam && args.groups?.length) {
      try {
        const syncResult = await syncTeamsFromGroupNames(sql, {
          userId: result.userId,
          organizationId: args.organizationId,
          groupNames: args.groups,
          excludeGroups: config.excludeGroups,
        });
        if (syncResult.errors.length > 0) {
          console.warn('[SSO] Team sync errors:', syncResult.errors);
        }
      } catch (syncError) {
        console.error('[SSO] Team sync failed:', syncError);
      }
    }

    // Org 2FA enforcement anchors on THIS door too: the password path's
    // after-hook never runs for an SSO session, so without it a user under
    // an enforced policy (exemptSsoUsers=false) recomputed `now + grace` on
    // every read and the enrolment deadline never arrived. A 'blocked'
    // verdict still mints the session — the org middleware withholds
    // authority server-side and the enrolment surface needs the session.
    await anchorTwoFactorGraceOnSignIn(sql, result.userId);

    const session = await createSsoUserSession(sql, {
      userId: result.userId,
      organizationId: args.organizationId,
    });
    return {
      success: true,
      userId: result.userId,
      sessionToken: session.sessionToken,
    };
  } catch (error) {
    console.error('[SSO] handleSsoLogin error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
