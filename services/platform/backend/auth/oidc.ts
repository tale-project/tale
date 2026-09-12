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
  // The provider library stamps every ID token with `acr` — always
  // OIDC_ACR_VALUE, the one value discovery lists under
  // `acr_values_supported` — so a relying party that asked for it can
  // verify it was honoured; discovery used to advertise the value but not
  // the claim. Tale asserts no stronger level, MFA enforcement included.
  'acr',
  'email',
  'email_verified',
  'name',
  'picture',
  'family_name',
  'given_name',
  OIDC_ORGANIZATION_CLAIM,
];

/** The one authentication context class the library asserts. */
export const OIDC_ACR_VALUE = 'urn:mace:incommon:iap:bronze';

/**
 * What discovery advertises as `prompt_values_supported`: the values this
 * issuer actually honours. The provider library hard-codes five; of those,
 * `select_account` is refused outright here (no account picker page is
 * configured — `unsupported_prompt_select_account`) and `create` lands on
 * the ordinary sign-in continuation rather than a registration page, so
 * advertising either would send a relying party down a path that ends in
 * an error or the wrong screen.
 */
export const OIDC_PROMPT_VALUES_SUPPORTED = ['none', 'login', 'consent'];

/** The library's own discovery documents, under the auth mount and at the
 * RFC 8414 path-insertion location. */
export const OIDC_DISCOVERY_PATHS = [
  '/api/auth/.well-known/openid-configuration',
  '/.well-known/oauth-authorization-server/api/auth',
];

/** The provider library's own error page — where an authorization request
 * that cannot be answered at the client's redirect URI lands. */
export const OIDC_ERROR_PAGE_PATH = '/api/auth/error';

export const OIDC_USERINFO_PATH = '/oauth2/userinfo';
export const OIDC_AUTHORIZE_PATH = '/oauth2/authorize';
export const OIDC_TOKEN_PATH = '/oauth2/token';
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

/**
 * The request-schema layer's message — `[query.client_id] Invalid input:
 * expected string, received undefined` — as a sentence about the OAuth
 * parameter: `client_id is required`, `code must be a string`,
 * `response_type must be one of "code"`. The library's wording is zod's,
 * so a client that matched on it would break on a library upgrade; a
 * problem the rules below do not know keeps its text behind the
 * parameter name. Several problems join with `; `.
 */
function describeValidation(message: string): string {
  const problems = [
    ...message.matchAll(/\[(?:body|query)\.([^\]]+)\]\s*([^[]*)/g),
  ].map(([, parameter, detail]) => describeProblem(parameter ?? '', detail));
  return problems.length === 0 ? message.trim() : problems.join('; ');
}

function describeProblem(
  parameter: string,
  detail: string | undefined,
): string {
  const text = (detail ?? '').trim().replace(/[.;,\s]+$/, '');
  if (text.endsWith('received undefined')) return `${parameter} is required`;
  const expected = /^Invalid input: expected (\w+)/.exec(text);
  if (expected) return `${parameter} must be a ${expected[1]}`;
  const option = /^Invalid option: expected one of (.+)$/.exec(text);
  if (option) return `${parameter} must be one of ${option[1]}`;
  return text === '' ? `${parameter} is invalid` : `${parameter}: ${text}`;
}

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
 *    `/oauth2/*` endpoint becomes `invalid_request`, its message rewritten
 *    to name the parameter (`describeValidation`); an unknown grant at the
 *    token endpoint is `unsupported_grant_type`, as the library itself
 *    answers for the grants this deployment leaves off.
 *  - the body layer's 415 `{message, code: "UNSUPPORTED_MEDIA_TYPE"}` —
 *    a JSON-only endpoint sent a form — becomes 400 `invalid_request`
 *    naming the media type it takes: RFC 6749 §5.2 knows no 415, and the
 *    third envelope was the one shape no OAuth client could parse.
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

  if (status === 415 || body.code === 'UNSUPPORTED_MEDIA_TYPE') {
    const message = typeof body.message === 'string' ? body.message : '';
    const allowed = /Allowed types: (.+)$/.exec(message)?.[1]?.trim();
    return {
      status: 400,
      body: {
        error: 'invalid_request',
        error_description:
          allowed === undefined
            ? 'the request body is not a media type this endpoint takes'
            : `the request body must be ${allowed}`,
      },
      headers: {},
    };
  }

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

/**
 * The authorization endpoint's redirect to the error page, corrected for
 * an unknown client: the provider library answers "client_id is required"
 * both when the parameter is missing and when it names no registered
 * client, so a developer whose client_id was present and mistyped was sent
 * to re-check the one thing that was right. When the request DID carry a
 * client_id, the description names the real problem; the error code
 * (`invalid_client`) and the page stay the library's. Null when the
 * location is not that redirect, or the parameter really was missing.
 * The redirect never goes to the client's own `redirect_uri` for this
 * error — RFC 6749 §4.1.2.1 — and that is left exactly as it was.
 */
export function authorizeRedirectFor(input: {
  /** The authorization request's URL. */
  requestUrl: string;
  /** The `Location` the library answered. */
  location: string;
}): string | null {
  let request: URL;
  let target: URL;
  try {
    request = new URL(input.requestUrl);
    target = new URL(input.location, request);
  } catch {
    return null;
  }
  if (
    !target.pathname.endsWith(OIDC_ERROR_PAGE_PATH) ||
    target.searchParams.get('error') !== 'invalid_client' ||
    target.searchParams.get('error_description') !== 'client_id is required'
  ) {
    return null;
  }
  const clientId = request.searchParams.get('client_id')?.trim() ?? '';
  if (clientId === '') return null;
  target.searchParams.set(
    'error_description',
    'client_id names no registered client',
  );
  return target.toString();
}

/**
 * The token endpoint's answer to a request without a `grant_type`: RFC
 * 6749 §5.2 — a missing required parameter is `invalid_request`, where the
 * library's schema layer reads the absence as an unsupported grant. Judged
 * on the body text before the library consumes it (the mount clones the
 * request); a body that names a grant, whatever it is, is the library's
 * to judge. Null when the request is not a token request or names one.
 */
export function tokenRequestRefusal(input: {
  method: string;
  /** The path inside the auth mount (`/oauth2/token`). */
  path: string;
  contentType: string | null;
  body: string;
}): OAuthRefusal | null {
  if (input.method !== 'POST' || input.path !== OIDC_TOKEN_PATH) return null;
  if (readGrantType(input.contentType ?? '', input.body) !== 'absent') {
    return null;
  }
  return {
    status: 400,
    body: {
      error: 'invalid_request',
      error_description: 'grant_type is required',
    },
    headers: {},
  };
}

/** Whether the token request names a grant — `unreadable` when the body is
 * not what its media type says, which is the library's own refusal. */
function readGrantType(
  contentType: string,
  body: string,
): 'named' | 'absent' | 'unreadable' {
  const media = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  let value: unknown;
  if (/^application\/([a-z0-9.+-]*\+)?json$/.test(media)) {
    try {
      const parsed: unknown = JSON.parse(body);
      value = isRecord(parsed) ? parsed.grant_type : undefined;
    } catch {
      return 'unreadable';
    }
  } else {
    value = new URLSearchParams(body).get('grant_type') ?? undefined;
  }
  return typeof value === 'string' && value.trim() !== '' ? 'named' : 'absent';
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
