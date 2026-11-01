import { parseOrgSessionCutoverAt } from '@tale/shared/utils/org-session-cutover';
import { APIError } from 'better-auth/api';
import type { MiddlewareHandler } from 'hono';
import type { Sql, TransactionSql } from 'postgres';

import {
  SESSION_ORGANIZATION_MESSAGE,
  ACCOUNT_AUTHENTICATION_MESSAGE,
} from '../../lib/shared/constants/session-authority.ts';
import { SESSION_FRESH_AGE_SECONDS } from '../../lib/shared/constants/session-freshness.ts';
import { isRecord } from '../../lib/utils/type-utils.ts';
import { readApiKeyOwner } from '../domains/api_keys/owners.ts';
import { stampSessionUse } from './session-use.ts';
import type { AuthEnv, SessionBundle } from './session.ts';

/** An operator fence, never a request value. The empty value keeps legacy
 * compatibility; a typo refuses boot instead of silently disabling the fence. */
export function orgSessionCutoverAt(
  env: Record<string, string | undefined> = process.env,
): number | null {
  return parseOrgSessionCutoverAt(env.TALE_ORG_SESSION_CUTOVER_AT);
}

export function orgSessionCutoverActive(cutoverAt: number | null): boolean {
  // Parsing/initialization refuse a future fence. Once configured it must
  // not turn itself off if the host clock subsequently moves backwards.
  return cutoverAt !== null;
}

/** null is global. A malformed non-null marker is never interpreted as global. */
export function sessionOrganizationId(
  session: object,
): string | null | undefined {
  const value: unknown = Reflect.get(session, 'trustedOrganizationId');
  if (value === undefined || value === null) return null;
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 128 &&
    value.trim() === value
    ? value
    : undefined;
}

export function sessionAllowsOrganization(
  session: object,
  organizationId: string,
): boolean {
  const scope = sessionOrganizationId(session);
  return scope === null || scope === organizationId;
}

/** This date is server-owned and written only after a real first-party
 * password/global-factor check. An IdP claim, a refreshed cookie or a new
 * org factor does not write it. Historical factors keep compatibility,
 * without claiming knowledge of their original minting provenance. */
function independentIdentityProofAt(
  session: object,
  now: number,
): number | null {
  const value: unknown = Reflect.get(session, 'independentIdentityVerifiedAt');
  const date =
    value instanceof Date
      ? value.getTime()
      : typeof value === 'string'
        ? Date.parse(value)
        : NaN;
  return Number.isFinite(date) && date <= now ? date : null;
}

export function sessionHasFreshAccountProof(
  session: object,
  now = Date.now(),
): boolean {
  const date = independentIdentityProofAt(session, now);
  return date !== null && now < date + SESSION_FRESH_AGE_SECONDS * 1000;
}

/** Account proof permits account operations, never another organization or
 * unbound delegation. The ordinary global-session behavior stays unchanged. */
function sessionAllowsAccountChanges(session: object): boolean {
  return (
    Reflect.get(session, 'authenticationDoor') !== 'api-key' &&
    (sessionOrganizationId(session) === null ||
      (sessionOrganizationId(session) !== undefined &&
        sessionHasFreshAccountProof(session)))
  );
}

export function refuseScopedSession(): APIError {
  return new APIError('FORBIDDEN', {
    code: 'ORG_FORBIDDEN',
    message: SESSION_ORGANIZATION_MESSAGE,
  });
}

/** The structural bundle read by the app; error bodies do not pass it. */
export function isSessionBundle(value: unknown): value is SessionBundle {
  return (
    isRecord(value) &&
    isRecord(value.user) &&
    isRecord(value.session) &&
    typeof value.user.id === 'string' &&
    typeof value.user.email === 'string' &&
    typeof value.user.name === 'string' &&
    typeof value.session.id === 'string'
  );
}

const SCOPED_SESSION_PATHS = new Set([
  '/get-session',
  '/sign-out',
  '/reauthenticate',
  '/passkey/generate-authenticate-options',
  '/passkey/verify-authentication',
  '/passkey/generate-register-options',
  '/passkey/verify-registration',
  '/passkey/list-user-passkeys',
  '/passkey/delete-passkey',
  '/passkey/update-passkey',
  '/two-factor/verify-totp',
  '/two-factor/verify-backup-code',
]);
const ACCOUNT_CHANGE_PATHS = new Set([
  '/update-user',
  '/change-password',
  '/set-password',
  '/change-email',
  '/list-accounts',
  '/unlink-account',
  '/list-sessions',
  '/revoke-session',
  '/revoke-sessions',
  '/revoke-other-sessions',
  '/delete-user',
  '/two-factor/enable',
  '/two-factor/disable',
  '/two-factor/generate-backup-codes',
  '/two-factor/get-totp-uri',
]);
const ORGANIZATION_PATHS = new Set([
  '/organization/list',
  '/organization/get-full-organization',
  '/organization/set-active',
  '/organization/update',
  '/organization/get-active-member',
  '/organization/get-active-member-role',
  '/organization/list-members',
  '/organization/remove-member',
  '/organization/update-member-role',
  '/organization/leave',
  '/organization/invite-member',
  '/organization/cancel-invitation',
  '/organization/get-invitation',
  '/organization/list-invitations',
  '/organization/accept-invitation',
  '/organization/reject-invitation',
  '/organization/list-user-invitations',
  '/organization/list-teams',
  '/organization/get-team',
  '/organization/create-team',
  '/organization/update-team',
  '/organization/remove-team',
  '/organization/set-active-team',
  '/organization/add-team-member',
  '/organization/remove-team-member',
  '/organization/list-team-members',
  '/organization/list-user-teams',
  '/organization/has-permission',
  '/organization/check-slug',
]);

/** Default refusal matters: a new plugin endpoint is not automatically an
 * account/realm endpoint. In particular account proof never allows personal
 * key, JWT, OAuth/OIDC authorization/consent, agent token or unbound grant
 * issuance from a scoped cookie. Server-owned calls have their app gate. */
export async function authorizeScopedAuthEndpoint(
  sql: Sql,
  bundle: SessionBundle,
  args: { path: string; body: unknown; query: unknown; overHttp: boolean },
): Promise<void> {
  const realm = sessionOrganizationId(bundle.session);
  const key = Reflect.get(bundle.session, 'authenticationDoor') === 'api-key';
  // These native client-lifecycle paths are disabled on HTTP and reached
  // only by the org-aware wrapper. Its clientReference/privilege checks
  // remain authoritative; this never includes consent or token issuance.
  const nativeClientAdministration =
    !args.overHttp &&
    [
      '/oauth2/get-clients',
      '/admin/oauth2/create-client',
      '/oauth2/client/rotate-secret',
    ].includes(args.path);
  if (
    nativeClientAdministration &&
    realm !== null &&
    realm !== undefined &&
    (key || sessionAllowsAccountChanges(bundle.session))
  )
    return;
  if (
    key &&
    !ORGANIZATION_PATHS.has(args.path) &&
    ![
      '/get-session',
      '/sign-out',
      '/api-key/get',
      '/api-key/list',
      '/api-key/update',
      '/api-key/delete',
      '/api-key/verify',
    ].includes(args.path)
  ) {
    // Its REST/MCP/model capability and owner-bound administration lanes
    // stay unchanged. A key is not first-party browser identity proof.
    throw refuseScopedSession();
  }
  if (realm === null) return;
  if (realm === undefined) throw refuseScopedSession();
  if (SCOPED_SESSION_PATHS.has(args.path)) {
    if (
      Reflect.get(bundle.session, 'authenticationDoor') === 'api-key' &&
      args.path !== '/get-session' &&
      args.path !== '/sign-out'
    )
      throw refuseScopedSession();
    return;
  }
  if (ACCOUNT_CHANGE_PATHS.has(args.path)) {
    if (!sessionAllowsAccountChanges(bundle.session)) {
      throw new APIError('FORBIDDEN', {
        code: 'SESSION_NOT_FRESH',
        message: ACCOUNT_AUTHENTICATION_MESSAGE,
      });
    }
    return;
  }
  if (!ORGANIZATION_PATHS.has(args.path)) throw refuseScopedSession();
  const inputs = [
    args.body,
    args.query,
    ...(args.path === '/organization/update-team' &&
    isRecord(args.body) &&
    isRecord(args.body.data)
      ? [args.body.data]
      : []),
  ].filter(isRecord);
  for (const input of inputs) {
    if ('organizationId' in input && input.organizationId !== realm)
      throw refuseScopedSession();
    if ('organizationSlug' in input) {
      if (
        typeof input.organizationSlug !== 'string' ||
        input.organizationSlug === ''
      )
        throw refuseScopedSession();
      const rows = await sql<{ id: string }[]>`
        SELECT "id" FROM "organization" WHERE "slug" = ${input.organizationSlug} LIMIT 1
      `;
      if (rows[0]?.id !== realm) throw refuseScopedSession();
    }
    // Opaque target ids do not establish the realm. Re-read their real org
    // before delegating to the plugin's existing role/resource checks.
    if ('teamId' in input) {
      if (
        input.teamId === null &&
        args.path === '/organization/set-active-team'
      )
        continue;
      if (typeof input.teamId !== 'string') throw refuseScopedSession();
      const rows = await sql<{ organizationId: string }[]>`
        SELECT "organizationId" FROM "team" WHERE "id" = ${input.teamId} LIMIT 1
      `;
      if (rows[0] !== undefined && rows[0].organizationId !== realm)
        throw refuseScopedSession();
    }
    if ('memberId' in input) {
      if (typeof input.memberId !== 'string') throw refuseScopedSession();
      const rows = await sql<{ organizationId: string }[]>`
        SELECT "organizationId" FROM "member" WHERE "id" = ${input.memberId} LIMIT 1
      `;
      if (rows[0] !== undefined && rows[0].organizationId !== realm)
        throw refuseScopedSession();
    }
    if ('invitationId' in input) {
      if (typeof input.invitationId !== 'string') throw refuseScopedSession();
      const rows = await sql<{ organizationId: string }[]>`
        SELECT "organizationId" FROM "invitation" WHERE "id" = ${input.invitationId} LIMIT 1
      `;
      if (rows[0] !== undefined && rows[0].organizationId !== realm)
        throw refuseScopedSession();
    }
  }
}

export function requireAccountIdentity<E extends AuthEnv>(
  options: { organizationKeyAdministration?: boolean } = {},
): MiddlewareHandler<E> {
  return async (c, next) => {
    const session = c.get('sessionBundle').session;
    const realm = sessionOrganizationId(session);
    // The native client wrapper's existing org/member/role/Origin gates
    // authorize only registry-bound administration. This is never proof
    // for browser account changes or unbound delegation.
    const organizationKey =
      options.organizationKeyAdministration === true &&
      Reflect.get(session, 'authenticationDoor') === 'api-key' &&
      realm !== null &&
      realm !== undefined;
    if (!organizationKey && !sessionAllowsAccountChanges(session)) {
      return c.json(
        {
          code: 'SESSION_NOT_FRESH',
          error: ACCOUNT_AUTHENTICATION_MESSAGE,
        },
        403,
      );
    }
    return next();
  };
}

export function requireGlobalSession<
  E extends AuthEnv,
>(): MiddlewareHandler<E> {
  return async (c, next) => {
    if (sessionOrganizationId(c.get('sessionBundle').session) !== null) {
      return c.json(
        { code: 'ORG_FORBIDDEN', error: SESSION_ORGANIZATION_MESSAGE },
        403,
      );
    }
    return next();
  };
}

/** A cached profile is useful; a cached authority marker is not sufficient.
 * Resolve the current persisted browser row (or the real key owner), on
 * every authorization. Never write or erase the row on a refusal; on an
 * acceptance, record the use on it (`session-use.ts`). */
export async function resolveSessionAuthority<T extends SessionBundle>(
  sql: Sql | TransactionSql,
  bundle: T,
  cutoverAt: number | null,
): Promise<T | null> {
  const rows = await sql<
    {
      userId: string;
      trustedOrganizationId: string | null;
      trustedRole: string | null;
      activeOrganizationId: string | null;
      activeTeamId: string | null;
      activeTeamOrganizationId: string | null;
      independentIdentityVerifiedAt: Date | null;
      updatedAt: Date;
      live: boolean;
      refused: boolean;
    }[]
  >`
    SELECT s."userId", s."trustedOrganizationId", s."trustedRole", s."activeOrganizationId",
      s."activeTeamId", t."organizationId" AS "activeTeamOrganizationId",
      s."independentIdentityVerifiedAt", s."updatedAt", (s."expiresAt" > now()) AS live,
      (r.session_id IS NOT NULL) AS refused
    FROM "session" s LEFT JOIN app.auth_legacy_session_refusals r
      ON r.session_id = s."id" AND r.user_id = s."userId"
    LEFT JOIN "team" t ON t."id" = s."activeTeamId"
    WHERE s."id" = ${bundle.session.id} LIMIT 1
  `;
  const row = rows[0];
  if (row !== undefined) {
    if (row.userId !== bundle.user.id || !row.live) return null;
    // This single authoritative statement reads row and exact refusal
    // together. Factory initialization has completed the fenced inventory.
    // Later account unlink/proof/marker changes never revive a captured row.
    if (orgSessionCutoverActive(cutoverAt) && row.refused) return null;
    const current = {
      ...bundle,
      session: {
        ...bundle.session,
        trustedOrganizationId: row.trustedOrganizationId,
        trustedRole: row.trustedRole,
        independentIdentityVerifiedAt: row.independentIdentityVerifiedAt,
        authenticationDoor: 'session',
        activeOrganizationId:
          row.trustedOrganizationId ?? row.activeOrganizationId,
        activeTeamId:
          row.trustedOrganizationId === null ||
          row.activeTeamOrganizationId === row.trustedOrganizationId
            ? row.activeTeamId
            : null,
      },
    };
    if (sessionOrganizationId(current.session) === undefined) return null;
    // The idle sweep reads the row's `updatedAt` as its last use, and Better
    // Auth's refresh alone never writes it for a long-lived row (#5249).
    await stampSessionUse(sql, bundle.session.id, row.updatedAt);
    return current;
  }

  // The api-key plugin synthesizes a session with id = key id. It must not
  // be mistaken for a missing legacy browser row, or lose its real binding.
  const keys = await sql<{ userId: string }[]>`
    SELECT "referenceId" AS "userId" FROM "apikey"
    WHERE "id" = ${bundle.session.id} AND "enabled" IS NOT FALSE
      AND ("expiresAt" IS NULL OR "expiresAt" > now()) LIMIT 1
  `;
  if (keys[0]?.userId !== bundle.user.id) return null;
  const owner = await readApiKeyOwner(sql, bundle.session.id);
  if (
    owner !== null &&
    (owner.keyUserId !== bundle.user.id || owner.revokedAt !== null)
  )
    return null;
  return {
    ...bundle,
    session: {
      ...bundle.session,
      trustedOrganizationId: owner?.organizationId ?? null,
      trustedRole: null,
      independentIdentityVerifiedAt: null,
      authenticationDoor: 'api-key',
      ...(owner === null ? {} : { activeOrganizationId: owner.organizationId }),
    },
  };
}
