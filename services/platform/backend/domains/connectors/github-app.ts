import type { Sql, TransactionSql } from 'postgres';

import { defineAbilityFor } from '../../../lib/permissions/ability.ts';
import {
  MembershipError,
  readUserMemberRows,
  requireOrganizationMember,
} from '../../auth/membership.ts';
import {
  hashStateToken,
  isPlausibleStateToken,
  mintStateToken,
} from '../../core/http_connectors/oauth_state.ts';
import { toJson } from '../../db/sql.ts';

/**
 * The two browser round trips that turn an organization's own GitHub App
 * into a `github-app` credential: the REGISTRATION (Tale's page posts the
 * app's manifest to GitHub, and GitHub sends the browser back with a code
 * that buys the new app's private key) and the INSTALLATION (the admin
 * picks repositories on GitHub, and GitHub sends the browser back with the
 * installation's id). The routes are `github-app-routes.ts`.
 *
 * Each round trip is a row in `app.connector_github_app_states` (migration
 * 0234), keyed by the SHA-256 of the state token GitHub carries back — the
 * consent flow's `app.connector_oauth_states` pattern (`oauth.ts`), with
 * the same token helpers. The row holds what the return may act on: the
 * organization, the member who began it and, for an installation, the
 * credential. Nothing in GitHub's return request can move them. A row is
 * claimed once by `DELETE … RETURNING`, whatever the request says, and is
 * honoured only for the member who began it and while they are still an
 * admin of the organization (CONN-R36).
 *
 * Only an organization's admins (owners included) register or install its
 * GitHub App (CONN-R35): the app acts in the organization's repositories,
 * so choosing the app and its repositories is an organization setting —
 * the `orgSettings` gate the OAuth app configuration writes behind.
 */

/** How long a round trip may stay on GitHub's pages. Longer than a consent's
 * ten minutes: registering asks for a name, maybe a GitHub sign-in or two
 * factors, and the installation choice that follows. */
export const GITHUB_APP_STATE_TTL_MS = 15 * 60 * 1000;

/** How many stale rows one new row clears — the table stays bounded without
 * a cron (an abandoned registration is never claimed). */
const EXPIRED_SWEEP_LIMIT = 25;

export type GithubAppFlow = 'register' | 'install';

/** What a registration creates the credential with — chosen at Tale's
 * register door and nowhere else. */
export interface GithubAppRegisterConfig {
  readonly connectorSlug: string;
  readonly credentialName: string;
  readonly appName: string;
  /** The GitHub organization the app is registered for; absent for the
   * admin's personal account. */
  readonly owner?: string;
}

/** What an installation's return needs beside its credential. */
export interface GithubAppInstallConfig {
  readonly connectorSlug: string;
}

export type NewGithubAppState =
  | {
      readonly flow: 'register';
      readonly organizationId: string;
      readonly userId: string;
      readonly config: GithubAppRegisterConfig;
    }
  | {
      readonly flow: 'install';
      readonly organizationId: string;
      readonly userId: string;
      readonly credentialId: string;
      readonly config: GithubAppInstallConfig;
    };

/**
 * Record a round trip about to leave for GitHub, and answer the plaintext
 * state token to hand to GitHub. Only its hash is stored, so a read of the
 * table cannot complete anyone's flow.
 */
export async function createGithubAppState(
  sql: Sql | TransactionSql,
  state: NewGithubAppState,
  nowMs: number = Date.now(),
): Promise<string> {
  const token = mintStateToken();
  await sql`
    DELETE FROM app.connector_github_app_states
    WHERE state_hash IN (
      SELECT state_hash FROM app.connector_github_app_states
      WHERE expires_at_ms < ${nowMs}
      LIMIT ${EXPIRED_SWEEP_LIMIT}
    )
  `;
  await sql`
    INSERT INTO app.connector_github_app_states (
      state_hash, flow, org_id, user_id, credential_id, config,
      created_at_ms, expires_at_ms
    ) VALUES (
      ${await hashStateToken(token)}, ${state.flow}, ${state.organizationId},
      ${state.userId},
      ${state.flow === 'install' ? state.credentialId : null},
      ${sql.json(toJson(state.config))},
      ${nowMs}, ${nowMs + GITHUB_APP_STATE_TTL_MS}
    )
  `;
  return token;
}

export type ClaimedGithubAppState =
  | {
      readonly ok: true;
      readonly flow: 'register';
      readonly organizationId: string;
      readonly userId: string;
      readonly config: GithubAppRegisterConfig;
    }
  | {
      readonly ok: true;
      readonly flow: 'install';
      readonly organizationId: string;
      readonly userId: string;
      readonly credentialId: string;
      readonly config: GithubAppInstallConfig;
    }
  | { readonly ok: false; readonly reason: 'unknown' | 'expired' };

/** What the `flow` door's claim answers: a round trip of that flow alone. */
export type GithubAppStateClaim<F extends GithubAppFlow> =
  | Extract<ClaimedGithubAppState, { readonly flow: F }>
  | Extract<ClaimedGithubAppState, { readonly ok: false }>;

/**
 * Claim the round trip `token` names, for the door `flow` serves, and
 * remove it whatever the outcome: `DELETE … RETURNING` reads and deletes in
 * one statement, so a replayed return never observes the row twice. A row
 * of the other flow is burnt too, and reads as unknown — like a forged,
 * foreign or already used token, deliberately indistinguishable.
 */
export function claimGithubAppState<F extends GithubAppFlow>(
  sql: Sql,
  token: string | null,
  flow: F,
  nowMs?: number,
): Promise<GithubAppStateClaim<F>>;
export async function claimGithubAppState(
  sql: Sql,
  token: string | null,
  flow: GithubAppFlow,
  nowMs: number = Date.now(),
): Promise<ClaimedGithubAppState> {
  if (!isPlausibleStateToken(token)) return { ok: false, reason: 'unknown' };
  const rows = await sql<
    {
      flow: string;
      organizationId: string;
      userId: string;
      credentialId: string | null;
      config: unknown;
      expiresAt: number;
    }[]
  >`
    DELETE FROM app.connector_github_app_states
    WHERE state_hash = ${await hashStateToken(token)}
    RETURNING flow, org_id AS "organizationId", user_id AS "userId",
              credential_id AS "credentialId", config,
              expires_at_ms::float8 AS "expiresAt"
  `;
  const row = rows[0];
  if (row === undefined || row.flow !== flow) {
    return { ok: false, reason: 'unknown' };
  }
  if (row.expiresAt <= nowMs) return { ok: false, reason: 'expired' };
  if (row.flow === 'install') {
    const config = readInstallConfig(row.config);
    if (row.credentialId === null || config === null) {
      return { ok: false, reason: 'unknown' };
    }
    return {
      ok: true,
      flow: 'install',
      organizationId: row.organizationId,
      userId: row.userId,
      credentialId: row.credentialId,
      config,
    };
  }
  const config = readRegisterConfig(row.config);
  if (config === null) return { ok: false, reason: 'unknown' };
  return {
    ok: true,
    flow: 'register',
    organizationId: row.organizationId,
    userId: row.userId,
    config,
  };
}

function readRegisterConfig(value: unknown): GithubAppRegisterConfig | null {
  if (typeof value !== 'object' || value === null) return null;
  const connectorSlug: unknown = Reflect.get(value, 'connectorSlug');
  const credentialName: unknown = Reflect.get(value, 'credentialName');
  const appName: unknown = Reflect.get(value, 'appName');
  const owner: unknown = Reflect.get(value, 'owner');
  if (
    typeof connectorSlug !== 'string' ||
    typeof credentialName !== 'string' ||
    typeof appName !== 'string' ||
    (owner !== undefined && typeof owner !== 'string')
  ) {
    return null;
  }
  return {
    connectorSlug,
    credentialName,
    appName,
    ...(owner !== undefined && { owner }),
  };
}

function readInstallConfig(value: unknown): GithubAppInstallConfig | null {
  if (typeof value !== 'object' || value === null) return null;
  const connectorSlug: unknown = Reflect.get(value, 'connectorSlug');
  return typeof connectorSlug === 'string' ? { connectorSlug } : null;
}

export type GithubAppAccess = 'allowed' | 'not_member' | 'role_forbidden';

/** Whether `userId` may register or install the organization's GitHub App:
 * an active member whose role writes organization settings (owner, admin). */
export async function githubAppAccess(
  sql: Sql | TransactionSql,
  organizationId: string,
  userId: string,
): Promise<GithubAppAccess> {
  let role: string;
  try {
    role = (await requireOrganizationMember(sql, organizationId, userId)).role;
  } catch (error) {
    if (error instanceof MembershipError) return 'not_member';
    throw error;
  }
  return defineAbilityFor(role).cannot('write', 'orgSettings')
    ? 'role_forbidden'
    : 'allowed';
}

/**
 * The access check a write on GitHub's return repeats inside its
 * transaction: GitHub's pages can outlive the door's check, so the
 * membership row is locked first — a demotion or removal either commits
 * before and refuses this write, or waits for it (`storeOauth2Grant`'s
 * pattern).
 */
export async function lockGithubAppAccess(
  tx: TransactionSql,
  organizationId: string,
  userId: string,
): Promise<boolean> {
  await tx`
    SELECT "id" FROM "member"
    WHERE "organizationId" = ${organizationId} AND "userId" = ${userId}
    FOR SHARE
  `;
  return (await githubAppAccess(tx, organizationId, userId)) === 'allowed';
}

/** The organizations `userId` may register or install GitHub Apps in. */
export async function githubAppAdminOrganizations(
  sql: Sql,
  userId: string,
): Promise<string[]> {
  const rows = await readUserMemberRows(sql, userId);
  return rows
    .filter((row) => !defineAbilityFor(row.role).cannot('write', 'orgSettings'))
    .map((row) => row.organizationId);
}
