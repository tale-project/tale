import { oauthProvider } from '@better-auth/oauth-provider';
import { APIError } from 'better-auth/api';
import type { Sql } from 'postgres';

import { isRecord } from '../../lib/utils/type-utils.ts';
import { evaluateTwoFactorEnforcement } from '../domains/two_factor/service.ts';
import { findOrganizationMember, isAdminRole } from './membership.ts';

/** One organization, selected by the registered client, never all memberships. */
export const OIDC_ORGANIZATION_CLAIM = 'https://tale.dev/organization';
export const OIDC_SCOPES = ['openid', 'profile', 'email', 'tale:organization'];

/**
 * What discovery advertises as `claims_supported`: the provider's own
 * claims for the openid/profile/email scopes, and the organization claim
 * the `tale:organization` scope exists for — a relying party that maps
 * claims from discovery must see the one claim that makes this issuer
 * different from any other.
 */
export const OIDC_CLAIMS_SUPPORTED = [
  'sub',
  'iss',
  'aud',
  'exp',
  'iat',
  'sid',
  'scope',
  'azp',
  'email',
  'email_verified',
  'name',
  'picture',
  'family_name',
  'given_name',
  OIDC_ORGANIZATION_CLAIM,
];

export const OIDC_USERINFO_PATH = '/oauth2/userinfo';
/** The endpoints a client authenticates to with its secret (RFC 6749 §2.3). */
const OAUTH_CLIENT_AUTHENTICATED_PATHS = new Set([
  '/oauth2/token',
  '/oauth2/introspect',
  '/oauth2/revoke',
]);

export interface OAuthRefusal {
  readonly status: 400 | 401 | 403;
  readonly body: Record<string, unknown>;
  readonly headers: Record<string, string>;
}

/** An RFC 7235 quoted-string for a challenge parameter. */
function quoted(value: string): string {
  return `"${value.replace(/[\\"]/g, (ch) => `\\${ch}`)}"`;
}

function bearerChallenge(
  realm: string,
  params: Record<string, string> = {},
): string {
  return [
    `Bearer realm=${quoted(realm)}`,
    ...Object.entries(params).map(([key, value]) => `${key}=${quoted(value)}`),
  ].join(', ');
}

/** `[body.grant_type] …` / `[query.client_id] …` — the schema layer's field
 * addressing, rewritten to the parameter name the OAuth client sent. */
function describeValidation(message: string): string {
  return message.replace(/\[(?:body|query)\.([^\]]+)\]\s*/g, '$1: ');
}

/**
 * The OAuth error envelope (RFC 6749 §5.2, RFC 6750 §3) for a refusal the
 * provider library shaped differently — null when the library's own answer
 * already conforms. Runs from the auth after-hook, where an endpoint's
 * thrown `APIError` is `returned`; the hook answers with a Response built
 * from it, since a hook's own thrown error keeps the endpoint's status.
 *
 *  - `/oauth2/userinfo` is a bearer-protected resource. An invalid or
 *    expired token is 401 `invalid_token` with a `WWW-Authenticate: Bearer`
 *    challenge — the library answered 400 and no challenge, which a
 *    conforming client reads as "malformed request, do not retry" instead
 *    of "re-authenticate", so every five-minute token expiry surfaced as a
 *    hard error. A missing token keeps its 401 and gains the challenge; a
 *    token without the openid scope is 403 `insufficient_scope`; any other
 *    refusal keeps its status and body and gains the bare challenge.
 *  - the request-schema layer's `{message, code: "VALIDATION_ERROR"}` on any
 *    `/oauth2/*` endpoint becomes `invalid_request`; an unknown grant at
 *    the token endpoint is `unsupported_grant_type`, as the library itself
 *    answers for the grants this deployment leaves off.
 *  - `invalid_client` at a client-authenticated endpoint gains the
 *    `WWW-Authenticate: Basic` challenge RFC 6749 §5.2 requires when the
 *    client authenticated through the Authorization header.
 */
/**
 * The OAuth error envelope (RFC 6749 §5.2, RFC 6750 §3) for a refusal the
 * provider library shaped differently — null when the library's own answer
 * already conforms. Applied to the SERIALIZED answer at the auth mount
 * (`withOAuthConformance`), where the status is a number and the body is
 * JSON, whatever runtime or code path produced it — an auth after-hook can
 * replace the body but not the status, and the point is the 401.
 *
 *  - `/oauth2/userinfo` is a bearer-protected resource. An invalid or
 *    expired token is 401 `invalid_token` with a `WWW-Authenticate: Bearer`
 *    challenge — the library answered 400 and no challenge, which a
 *    conforming client reads as "malformed request, do not retry" instead
 *    of "re-authenticate", so every five-minute token expiry surfaced as a
 *    hard error. A missing token keeps its 401 and gains the challenge; a
 *    token without the openid scope is 403 `insufficient_scope`; any other
 *    refusal keeps its status and body and gains the bare challenge.
 *  - the request-schema layer's `{message, code: "VALIDATION_ERROR"}` on any
 *    `/oauth2/*` endpoint becomes `invalid_request`; an unknown grant at
 *    the token endpoint is `unsupported_grant_type`, as the library itself
 *    answers for the grants this deployment leaves off.
 *  - `invalid_client` at a client-authenticated endpoint gains the
 *    `WWW-Authenticate: Basic` challenge RFC 6749 §5.2 requires when the
 *    client authenticated through the Authorization header.
 */
export function oauthRefusalFor(input: {
  /** The path inside the auth mount (`/oauth2/userinfo`). */
  path: string;
  status: number;
  body: unknown;
  authorization: string | null;
  realm: string;
}): OAuthRefusal | null {
  const { path, status, realm } = input;
  if (!path.startsWith('/oauth2/') || status < 400) return null;
  const body: Record<string, unknown> = isRecord(input.body) ? input.body : {};
  const description =
    typeof body.error_description === 'string' ? body.error_description : null;

  if (body.code === 'VALIDATION_ERROR') {
    const message = typeof body.message === 'string' ? body.message : '';
    if (path === '/oauth2/token' && message.includes('[body.grant_type]')) {
      return {
        status: 400,
        body: {
          error: 'unsupported_grant_type',
          error_description:
            'this server supports the authorization_code grant only',
        },
        headers: {},
      };
    }
    return {
      status: 400,
      body: {
        error: 'invalid_request',
        error_description: describeValidation(message) || 'invalid request',
      },
      headers: {},
    };
  }

  if (path === OIDC_USERINFO_PATH) {
    if (status === 400 && body.error === 'invalid_request') {
      const reason = description ?? 'the access token is invalid or expired';
      return {
        status: 401,
        body: { error: 'invalid_token', error_description: reason },
        headers: {
          'WWW-Authenticate': bearerChallenge(realm, {
            error: 'invalid_token',
            error_description: reason,
          }),
        },
      };
    }
    if (status === 400 && body.error === 'invalid_scope') {
      const reason = 'the access token lacks the openid scope';
      return {
        status: 403,
        body: { error: 'insufficient_scope', error_description: reason },
        headers: {
          'WWW-Authenticate': bearerChallenge(realm, {
            error: 'insufficient_scope',
            error_description: reason,
            scope: 'openid',
          }),
        },
      };
    }
    if (status === 401 || status === 403) {
      return {
        status,
        body,
        headers: { 'WWW-Authenticate': bearerChallenge(realm) },
      };
    }
    return null;
  }

  if (
    OAUTH_CLIENT_AUTHENTICATED_PATHS.has(path) &&
    status === 401 &&
    body.error === 'invalid_client' &&
    input.authorization?.startsWith('Basic ') === true
  ) {
    return {
      status: 401,
      body,
      headers: { 'WWW-Authenticate': `Basic realm=${quoted(realm)}` },
    };
  }
  return null;
}

/** Client management is exposed through the organization-aware app routes. */
export const OIDC_DISABLED_PATHS = [
  '/token',
  '/oauth2/create-client',
  '/oauth2/update-client',
  '/oauth2/delete-client',
  '/oauth2/client/rotate-secret',
  '/admin/oauth2/create-client',
  '/admin/oauth2/update-client',
  '/oauth2/get-client',
  '/oauth2/get-clients',
];

export async function oidcOrganizationClaims(
  sql: Sql,
  user: { id: string; emailVerified: boolean },
  organizationId: unknown,
) {
  if (!user.emailVerified || typeof organizationId !== 'string') {
    throw new APIError('FORBIDDEN', { message: 'IDENTITY_NOT_ELIGIBLE' });
  }
  const rows = await sql<{ id: string; slug: string; role: string }[]>`
    SELECT o."id", o."slug", m."role"
    FROM "organization" o
    JOIN "member" m ON m."organizationId" = o."id"
    WHERE o."id" = ${organizationId} AND m."userId" = ${user.id}
      AND m."role" IN ('owner', 'admin', 'developer', 'editor', 'member')
    LIMIT 1
  `;
  const organization = rows[0];
  if (
    !organization ||
    (await evaluateTwoFactorEnforcement(sql, user.id)).decision === 'blocked'
  ) {
    throw new APIError('FORBIDDEN', { message: 'IDENTITY_NOT_ELIGIBLE' });
  }
  return { [OIDC_ORGANIZATION_CLAIM]: organization };
}

export function createOidcProvider(sql: Sql, baseUrl: string) {
  const basePath = (process.env.BASE_PATH ?? new URL(baseUrl).pathname).replace(
    /\/$/,
    '',
  );
  return oauthProvider({
    loginPage: `${basePath}/oauth/continue`,
    consentPage: `${basePath}/oauth/consent`,
    scopes: OIDC_SCOPES,
    advertisedMetadata: { claims_supported: OIDC_CLAIMS_SUPPORTED },
    // Identity clients use only native userinfo (allowed by the provider for
    // openid). No external resource audience is accepted: stable 1.6.x does
    // not bind resource indicators to grants (GHSA-p2fr-6hmx-4528).
    validAudiences: [],
    grantTypes: ['authorization_code'],
    codeExpiresIn: 60,
    accessTokenExpiresIn: 300,
    idTokenExpiresIn: 300,
    allowDynamicClientRegistration: false,
    silenceWarnings: { oauthAuthServerConfig: true },
    allowUnauthenticatedClientRegistration: false,
    clientReference: ({ session }) => {
      const organizationId = session?.activeOrganizationId;
      return typeof organizationId === 'string' ? organizationId : undefined;
    },
    clientPrivileges: async ({ session, user }) => {
      const organizationId = session?.activeOrganizationId;
      if (!user || typeof organizationId !== 'string') return false;
      const member = await findOrganizationMember(sql, organizationId, user.id);
      return member !== null && isAdminRole(member.role);
    },
    customIdTokenClaims: ({ user, metadata }) =>
      oidcOrganizationClaims(sql, user, metadata?.taleOrganizationId),
    customAccessTokenClaims: ({ user, metadata }) => {
      if (!user) {
        throw new APIError('FORBIDDEN', { message: 'IDENTITY_NOT_ELIGIBLE' });
      }
      return oidcOrganizationClaims(sql, user, metadata?.taleOrganizationId);
    },
    customUserInfoClaims: ({ user, jwt }) => {
      const organization = jwt[OIDC_ORGANIZATION_CLAIM];
      return oidcOrganizationClaims(
        sql,
        user,
        isRecord(organization) ? organization.id : undefined,
      );
    },
  });
}
