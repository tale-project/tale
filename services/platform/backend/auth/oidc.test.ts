// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { isRecord } from '../../lib/utils/type-utils.ts';
import {
  authorizeRedirectFor,
  createOidcProvider,
  OIDC_ACR_VALUE,
  OIDC_CLAIMS_SUPPORTED,
  OIDC_ORGANIZATION_CLAIM,
  OIDC_PROMPT_VALUES_SUPPORTED,
  oauthRefusalFor,
  oidcScopeClaims,
  tokenRequestRefusal,
} from './oidc.ts';

const REALM = 'https://tale.example.com/api/auth';

/** The serialized answer the mount sees: a status and its JSON body. */
function refusal(
  path: string,
  answer: { status: number; body: unknown },
  authorization: string | null = null,
) {
  return oauthRefusalFor({
    path,
    status: answer.status,
    body: answer.body,
    authorization,
    realm: REALM,
  });
}
const answered = (status: number, body: unknown) => ({ status, body });

/**
 * RFC 6750 §3: a bearer-protected resource answers an invalid or expired
 * token with 401 `invalid_token` and a `WWW-Authenticate: Bearer` challenge.
 * The provider library answers 400 with no challenge, which a conforming
 * client reads as "malformed, do not retry" — so every five-minute access
 * token expiry surfaced as a hard error instead of a re-login.
 */
describe('oauthRefusalFor — userinfo as a bearer-protected resource', () => {
  it('turns the library 400 for an invalid token into 401 invalid_token with a challenge', () => {
    const mapped = refusal(
      '/oauth2/userinfo',
      answered(400, {
        error_description: 'Invalid access token',
        error: 'invalid_request',
      }),
    );
    expect(mapped).toEqual({
      status: 401,
      body: {
        error: 'invalid_token',
        error_description: 'Invalid access token',
      },
      headers: {
        'WWW-Authenticate': `Bearer realm="${REALM}", error="invalid_token", error_description="Invalid access token"`,
      },
    });
  });

  it('keeps the 401 for a missing token and adds the bare challenge, without an error code', () => {
    const body = {
      error_description: 'authorization header not found',
      error: 'invalid_request',
    };
    const mapped = refusal('/oauth2/userinfo', answered(401, body));
    expect(mapped).toEqual({
      status: 401,
      body,
      headers: { 'WWW-Authenticate': `Bearer realm="${REALM}"` },
    });
  });

  it('answers a token without the openid scope with 403 insufficient_scope naming the scope', () => {
    const mapped = refusal(
      '/oauth2/userinfo',
      answered(400, {
        error_description: 'Missing required scope',
        error: 'invalid_scope',
      }),
    );
    expect(mapped?.status).toBe(403);
    expect(mapped?.body).toEqual({
      error: 'insufficient_scope',
      error_description: 'the access token lacks the openid scope',
    });
    expect(mapped?.headers['WWW-Authenticate']).toContain(
      'error="insufficient_scope"',
    );
    expect(mapped?.headers['WWW-Authenticate']).toContain('scope="openid"');
  });

  it("keeps this issuer's own 403 (an ineligible identity) and adds the challenge", () => {
    const mapped = refusal(
      '/oauth2/userinfo',
      answered(403, { message: 'IDENTITY_NOT_ELIGIBLE' }),
    );
    expect(mapped?.status).toBe(403);
    expect(mapped?.body).toMatchObject({ message: 'IDENTITY_NOT_ELIGIBLE' });
    expect(mapped?.headers).toEqual({
      'WWW-Authenticate': `Bearer realm="${REALM}"`,
    });
  });

  it('escapes quotes in a challenge parameter', () => {
    const mapped = refusal(
      '/oauth2/userinfo',
      answered(400, {
        error_description: 'token "abc" is not valid',
        error: 'invalid_request',
      }),
    );
    expect(mapped?.headers['WWW-Authenticate']).toContain(
      'error_description="token \\"abc\\" is not valid"',
    );
  });
});

/**
 * RFC 6749 §5.2: the token endpoint's errors are `{error, error_description}`
 * — an input outside the library's request schema used to fall through to
 * the schema layer's `{message, code: "VALIDATION_ERROR"}` with the internal
 * field path in the message.
 */
describe('oauthRefusalFor — the RFC 6749 envelope', () => {
  const validation = (message: string) =>
    answered(400, { message, code: 'VALIDATION_ERROR' });

  it('answers an unknown grant type as unsupported_grant_type', () => {
    const mapped = refusal(
      '/oauth2/token',
      validation(
        '[body.grant_type] Invalid option: expected one of "authorization_code"|"client_credentials"|"refresh_token"',
      ),
    );
    expect(mapped).toEqual({
      status: 400,
      body: {
        error: 'unsupported_grant_type',
        error_description:
          'this server supports the authorization_code grant only',
      },
      headers: {},
    });
  });

  it('answers any other schema refusal as invalid_request, naming the parameter in house prose, not the schema dialect', () => {
    const mapped = refusal(
      '/oauth2/authorize',
      validation(
        '[query.client_id] Invalid input: expected string, received undefined',
      ),
    );
    expect(mapped).toEqual({
      status: 400,
      body: {
        error: 'invalid_request',
        error_description: 'client_id is required',
      },
      headers: {},
    });
  });

  it.each([
    [
      'a wrong type',
      '[body.code] Invalid input: expected string, received number',
      'code must be a string',
    ],
    [
      'a value outside an enum',
      '[query.response_type] Invalid option: expected one of "code"',
      'response_type must be one of "code"',
    ],
    [
      'a rule it does not know, kept behind the parameter name',
      '[query.redirect_uri] Invalid URL',
      'redirect_uri: Invalid URL',
    ],
    [
      'several problems, joined',
      '[query.client_id] Invalid input: expected string, received undefined, [query.response_type] Invalid option: expected one of "code"',
      'client_id is required; response_type must be one of "code"',
    ],
  ])(
    'describes %s as a sentence about the OAuth parameter',
    (_label, message, expected) => {
      const mapped = refusal('/oauth2/authorize', validation(message));
      expect(mapped?.body).toEqual({
        error: 'invalid_request',
        error_description: expected,
      });
    },
  );

  it('answers a body of the wrong media type as 400 invalid_request naming the type it takes — never the 415 third envelope', () => {
    const mapped = refusal(
      '/oauth2/register',
      answered(415, {
        message:
          'Content-Type "application/x-www-form-urlencoded" is not allowed. Allowed types: application/json',
        code: 'UNSUPPORTED_MEDIA_TYPE',
      }),
    );
    expect(mapped).toEqual({
      status: 400,
      body: {
        error: 'invalid_request',
        error_description: 'the request body must be application/json',
      },
      headers: {},
    });
    expect(
      refusal(
        '/oauth2/register',
        answered(415, {
          message: 'Content-Type is required. Allowed types: application/json',
          code: 'UNSUPPORTED_MEDIA_TYPE',
        }),
      )?.body,
    ).toEqual({
      error: 'invalid_request',
      error_description: 'the request body must be application/json',
    });
  });

  it('adds the Basic challenge to invalid_client only when the client authenticated through the header', () => {
    const body = {
      error_description: 'invalid client credentials',
      error: 'invalid_client',
    };
    const viaHeader = refusal(
      '/oauth2/token',
      answered(401, body),
      'Basic Y2xpZW50OnNlY3JldA==',
    );
    expect(viaHeader).toEqual({
      status: 401,
      body,
      headers: { 'WWW-Authenticate': `Basic realm="${REALM}"` },
    });
    expect(refusal('/oauth2/token', answered(401, body))).toBe(null);
  });

  it('leaves a conforming library refusal, a success, and every non-OAuth path alone', () => {
    expect(
      refusal(
        '/oauth2/token',
        answered(400, { error: 'unsupported_grant_type' }),
      ),
    ).toBe(null);
    expect(refusal('/oauth2/userinfo', answered(200, { sub: 'user-1' }))).toBe(
      null,
    );
    expect(
      refusal(
        '/sign-in/email',
        answered(400, { message: 'x', code: 'VALIDATION_ERROR' }),
      ),
    ).toBe(null);
  });
});

describe('createOidcProvider — discovery', () => {
  it('advertises the organization claim the tale:organization scope exists for', () => {
    const plugin: unknown = createOidcProvider(
      null as unknown as Sql,
      'https://tale.example.com',
    );
    const options = isRecord(plugin) ? plugin.options : undefined;
    const advertised = isRecord(options) ? options.advertisedMetadata : null;
    expect(advertised).toEqual({ claims_supported: OIDC_CLAIMS_SUPPORTED });
    expect(OIDC_CLAIMS_SUPPORTED).toContain(OIDC_ORGANIZATION_CLAIM);
    expect(OIDC_CLAIMS_SUPPORTED).toContain('email_verified');
  });

  it('advertises the acr claim every ID token carries, with the one value discovery names', () => {
    // The library stamps `acr` on every ID token and lists the value under
    // `acr_values_supported`; without the claim in `claims_supported` a
    // relying party that asked for it could not verify it was honoured.
    expect(OIDC_CLAIMS_SUPPORTED).toContain('acr');
    expect(OIDC_ACR_VALUE).toBe('urn:mace:incommon:iap:bronze');
  });

  it('leaves a person five minutes to sign in before the request expires', () => {
    // The provider signs the login and consent continuation with this same
    // lifetime and refuses an expired one, so `codeExpiresIn` is also the
    // window a person has to find a password and answer a second factor.
    // At sixty seconds a slow sign-in came back to the provider's error
    // page; five minutes is the conventional ceiling for a single-use,
    // PKCE-bound authorization code.
    const plugin: unknown = createOidcProvider(
      null as unknown as Sql,
      'https://tale.example.com',
    );
    const options = isRecord(plugin) ? plugin.options : undefined;
    expect(isRecord(options) ? options.codeExpiresIn : null).toBe(300);
  });

  it('advertises only the prompt values this issuer honours', () => {
    // `select_account` is refused (no account picker is configured) and
    // `create` lands on the ordinary sign-in continuation, not a
    // registration page — advertising either misleads a relying party.
    expect(OIDC_PROMPT_VALUES_SUPPORTED).toEqual(['none', 'login', 'consent']);
  });
});

/**
 * Better Auth 1.7 stopped putting the scope claims in the ID token itself;
 * the first-party relying parties verify the ID token alone and require
 * `email` and `email_verified` in it, so "Continue with Tale" failed on
 * every one of them. The mapping is 1.6's — the one userinfo still applies.
 */
describe('oidcScopeClaims — the standard claims a grant carries into the ID token', () => {
  const ada = {
    name: 'Ada King Lovelace',
    image: 'https://tale.example.com/avatars/ada.png',
    email: 'ada@example.test',
    emailVerified: true,
  };

  it('puts email and email_verified in for the email scope alone', () => {
    expect(oidcScopeClaims(ada, ['openid', 'email'])).toStrictEqual({
      email: 'ada@example.test',
      email_verified: true,
    });
  });

  it('puts the name, its parts and the picture in for the profile scope alone', () => {
    expect(oidcScopeClaims(ada, ['openid', 'profile'])).toStrictEqual({
      name: 'Ada King Lovelace',
      picture: 'https://tale.example.com/avatars/ada.png',
      given_name: 'Ada King',
      family_name: 'Lovelace',
    });
  });

  it('carries both sets for the scopes a registered Tale client requests', () => {
    expect(
      oidcScopeClaims(ada, ['openid', 'profile', 'email', 'tale:organization']),
    ).toStrictEqual({
      name: 'Ada King Lovelace',
      picture: 'https://tale.example.com/avatars/ada.png',
      given_name: 'Ada King',
      family_name: 'Lovelace',
      email: 'ada@example.test',
      email_verified: true,
    });
  });

  it('carries nothing without the profile or email scope', () => {
    expect(oidcScopeClaims(ada, ['openid', 'tale:organization'])).toStrictEqual(
      {},
    );
    expect(oidcScopeClaims(ada, [])).toStrictEqual({});
  });

  it('keeps a one-word name whole, with no given or family name', () => {
    expect(oidcScopeClaims({ ...ada, name: 'Ada' }, ['profile'])).toStrictEqual(
      {
        name: 'Ada',
        picture: 'https://tale.example.com/avatars/ada.png',
      },
    );
  });

  it('splits on single spaces the way userinfo does, and keeps the name as stored', () => {
    expect(
      oidcScopeClaims({ ...ada, name: ' Ada   Lovelace ', image: null }, [
        'profile',
      ]),
    ).toStrictEqual({
      name: ' Ada   Lovelace ',
      given_name: 'Ada',
      family_name: 'Lovelace',
    });
  });

  it('omits the picture of an account without an image — never null', () => {
    const claims = oidcScopeClaims({ ...ada, image: null }, [
      'profile',
      'email',
    ]);
    expect(claims).not.toHaveProperty('picture');
    expect(Object.values(claims)).not.toContain(null);
    expect(Object.values(claims)).not.toContain(undefined);
  });

  it('says so when the email is not verified, rather than dropping the claim', () => {
    expect(
      oidcScopeClaims({ ...ada, emailVerified: false }, ['email']),
    ).toStrictEqual({ email: 'ada@example.test', email_verified: false });
    expect(
      oidcScopeClaims({ email: 'ada@example.test' }, ['email']),
    ).toStrictEqual({ email: 'ada@example.test', email_verified: false });
  });
});

/** Answers the membership lookup for one bound organization, and reports
 * no membership to the MFA policy read (so the default policy applies). */
function membershipSql(member: {
  userId: string;
  organization: { id: string; slug: string; role: string };
}): Sql {
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    if (text.includes('FROM "organization" o')) {
      const [organizationId, userId] = values;
      return Promise.resolve(
        organizationId === member.organization.id && userId === member.userId
          ? [member.organization]
          : [],
      );
    }
    if (text.includes('SELECT "organizationId" FROM "member"')) {
      return Promise.resolve([]);
    }
    return Promise.reject(new Error(`unexpected query: ${text}`));
  };
  return tag as unknown as Sql;
}

describe('createOidcProvider — the ID token claims hook', () => {
  const organization = { id: 'org-1', slug: 'acme', role: 'member' };
  const sql = membershipSql({ userId: 'user-1', organization });
  const plugin: unknown = createOidcProvider(sql, 'https://tale.example.com');
  const options = isRecord(plugin) ? plugin.options : undefined;
  const hook = isRecord(options) ? options.customIdTokenClaims : undefined;
  const claimsFor = (user: Record<string, unknown>, scopes: string[]) => {
    if (typeof hook !== 'function') throw new Error('no customIdTokenClaims');
    return Promise.resolve(
      hook({ user, scopes, metadata: { taleOrganizationId: organization.id } }),
    );
  };
  const member = {
    id: 'user-1',
    name: 'Ada Lovelace',
    image: null,
    email: 'ada@example.test',
    emailVerified: true,
  };

  it('returns the scope claims beside the organization claim', async () => {
    await expect(
      claimsFor(member, ['openid', 'profile', 'email', 'tale:organization']),
    ).resolves.toStrictEqual({
      name: 'Ada Lovelace',
      given_name: 'Ada',
      family_name: 'Lovelace',
      email: 'ada@example.test',
      email_verified: true,
      [OIDC_ORGANIZATION_CLAIM]: organization,
    });
  });

  it('still refuses an unverified identity and a non-member, whatever the scopes', async () => {
    await expect(
      claimsFor({ ...member, emailVerified: false }, ['openid', 'email']),
    ).rejects.toMatchObject({ message: 'IDENTITY_NOT_ELIGIBLE' });
    await expect(
      claimsFor({ ...member, id: 'user-2' }, ['openid', 'email']),
    ).rejects.toMatchObject({ message: 'IDENTITY_NOT_ELIGIBLE' });
  });
});

/**
 * The library answers "client_id is required" for a missing AND for an
 * unknown client — a developer whose client_id was present and mistyped
 * was sent to re-check the one thing that was right.
 */
describe('authorizeRedirectFor — an unknown client', () => {
  const errorPage =
    'https://tale.example.com/api/auth/error?error=invalid_client&error_description=client_id+is+required';

  it('names the real problem when the request carried a client_id', () => {
    const corrected = authorizeRedirectFor({
      requestUrl:
        'https://tale.example.com/api/auth/oauth2/authorize?response_type=code&client_id=nope&redirect_uri=https%3A%2F%2Fapp.example.test%2Fcb&scope=openid&state=x',
      location: errorPage,
    });
    expect(corrected).not.toBeNull();
    const target = new URL(corrected ?? '');
    expect(target.pathname).toBe('/api/auth/error');
    expect(target.searchParams.get('error')).toBe('invalid_client');
    expect(target.searchParams.get('error_description')).toBe(
      'client_id names no registered client',
    );
  });

  it('leaves the answer alone when the client_id really was missing or blank', () => {
    expect(
      authorizeRedirectFor({
        requestUrl:
          'https://tale.example.com/api/auth/oauth2/authorize?response_type=code',
        location: errorPage,
      }),
    ).toBeNull();
    expect(
      authorizeRedirectFor({
        requestUrl:
          'https://tale.example.com/api/auth/oauth2/authorize?client_id=%20&response_type=code',
        location: errorPage,
      }),
    ).toBeNull();
  });

  it('leaves every other redirect alone — the client’s own callback, another error, a relative page', () => {
    const request =
      'https://tale.example.com/api/auth/oauth2/authorize?client_id=known';
    expect(
      authorizeRedirectFor({
        requestUrl: request,
        location: 'https://app.example.test/cb?code=abc&state=x',
      }),
    ).toBeNull();
    expect(
      authorizeRedirectFor({
        requestUrl: request,
        location:
          'https://tale.example.com/api/auth/error?error=invalid_request&error_description=response_type+is+required',
      }),
    ).toBeNull();
    expect(
      authorizeRedirectFor({
        requestUrl: request,
        location: '/oauth/continue?sig=abc',
      }),
    ).toBeNull();
    expect(
      authorizeRedirectFor({ requestUrl: 'not a url', location: errorPage }),
    ).toBeNull();
  });
});

/**
 * RFC 6749 §5.2: a token request missing a required parameter is
 * `invalid_request`; the library's schema layer read an absent grant_type
 * as an unsupported grant.
 */
describe('tokenRequestRefusal — a token request without a grant_type', () => {
  const token = (body: string, contentType: string | null) =>
    tokenRequestRefusal({
      method: 'POST',
      path: '/oauth2/token',
      contentType,
      body,
    });
  const refused = {
    status: 400,
    body: {
      error: 'invalid_request',
      error_description: 'grant_type is required',
    },
    headers: {},
  };

  it('refuses a form without one, or with a blank one', () => {
    expect(token('nonsense=1', 'application/x-www-form-urlencoded')).toEqual(
      refused,
    );
    expect(
      token('grant_type=&code=abc', 'application/x-www-form-urlencoded'),
    ).toEqual(refused);
    expect(token('', null)).toEqual(refused);
  });

  it('refuses a JSON body without one', () => {
    expect(token('{"code":"abc"}', 'application/json')).toEqual(refused);
  });

  it('leaves a named grant — whatever it is — and an unreadable body to the library', () => {
    expect(
      token(
        'grant_type=client_credentials',
        'application/x-www-form-urlencoded; charset=utf-8',
      ),
    ).toBeNull();
    expect(
      token('{"grant_type":"authorization_code"}', 'application/json'),
    ).toBeNull();
    expect(token('{not json', 'application/json')).toBeNull();
  });

  it('applies to the token endpoint’s POST alone', () => {
    expect(
      tokenRequestRefusal({
        method: 'GET',
        path: '/oauth2/token',
        contentType: null,
        body: '',
      }),
    ).toBeNull();
    expect(
      tokenRequestRefusal({
        method: 'POST',
        path: '/oauth2/introspect',
        contentType: 'application/x-www-form-urlencoded',
        body: 'token=abc',
      }),
    ).toBeNull();
  });
});
