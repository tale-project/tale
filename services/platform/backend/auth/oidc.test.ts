// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { isRecord } from '../../lib/utils/type-utils.ts';
import {
  createOidcProvider,
  OIDC_CLAIMS_SUPPORTED,
  OIDC_ORGANIZATION_CLAIM,
  oauthRefusalFor,
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

  it('answers any other schema refusal as invalid_request, naming the parameter and not the schema path', () => {
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
        error_description:
          'client_id: Invalid input: expected string, received undefined',
      },
      headers: {},
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
});
