import { generateId } from 'better-auth';
import type { Sql } from 'postgres';

import { sessionExpiryMs } from '../../../lib/shared/session-idle.ts';
import { mapEntraRoleToPlatformRole } from '../../core/enterprise_sso/entra_id/role_mapping.ts';
import { shouldSyncMemberRole } from '../../core/enterprise_sso/find_or_create_sso_user.ts';
import type {
  PlatformRole,
  SsoUserInfo,
} from '../../core/enterprise_sso/types.ts';
import { normalizeAuthEmail } from '../../core/lib/auth/normalize_auth_email.ts';
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
 * semantics): create-if-missing by case-insensitive name, add membership,
 * prune this user's memberships in org teams no longer in the group list —
 * deleting a team entirely when the pruned membership was its last.
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
        result.membershipsAdded += 1;
      }
    } catch (error) {
      result.errors.push(
        `Failed to sync group ${name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Prune stale memberships (this org's teams only), reaping empty teams.
  const memberships = await sql<
    { id: string; teamId: string; teamName: string }[]
  >`
    SELECT tm."id", tm."teamId", t."name" AS "teamName"
    FROM "teamMember" tm
    JOIN "team" t ON t."id" = tm."teamId"
    WHERE tm."userId" = ${args.userId}
      AND t."organizationId" = ${args.organizationId}
  `;
  for (const membership of memberships) {
    if (syncedNamesLower.has(membership.teamName.toLowerCase())) continue;
    await sql`DELETE FROM "teamMember" WHERE "id" = ${membership.id}`;
    result.membershipsRemoved += 1;
    const remaining = await sql<{ id: string }[]>`
      SELECT "id" FROM "teamMember"
      WHERE "teamId" = ${membership.teamId} LIMIT 1
    `;
    if (remaining.length === 0) {
      await sql`DELETE FROM "team" WHERE "id" = ${membership.teamId}`;
    }
  }
  return result;
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
