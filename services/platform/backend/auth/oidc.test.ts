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

  it('advertises only the prompt values this issuer honours', () => {
    // `select_account` is refused (no account picker is configured) and
    // `create` lands on the ordinary sign-in continuation, not a
    // registration page — advertising either misleads a relying party.
    expect(OIDC_PROMPT_VALUES_SUPPORTED).toEqual(['none', 'login', 'consent']);
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
