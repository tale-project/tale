// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  oauthTokenPrecheck,
  withDiscoveryConformance,
  withOAuthConformance,
} from './oauth-conformance.ts';

const REALM = 'https://tale.example.com/api/auth';
const json = (
  status: number,
  body: unknown,
  extra: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extra },
  });

/**
 * The auth mount re-shapes the provider library's JSON refusals under
 * /oauth2/* into the RFC 6749 / 6750 envelopes — status and challenge
 * header included — and touches nothing else it serves.
 */
describe('withOAuthConformance', () => {
  it('turns the userinfo 400 for a bad token into 401 invalid_token with a Bearer challenge', async () => {
    const request = new Request(`${REALM}/oauth2/userinfo`, {
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    const response = await withOAuthConformance(
      request,
      json(400, {
        error_description: 'Invalid access token',
        error: 'invalid_request',
      }),
      REALM,
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe(
      `Bearer realm="${REALM}", error="invalid_token", error_description="Invalid access token"`,
    );
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({
      error: 'invalid_token',
      error_description: 'Invalid access token',
    });
  });

  it('keeps the set-cookie and other headers of the answer it re-shapes', async () => {
    const response = await withOAuthConformance(
      new Request(`${REALM}/oauth2/token`, { method: 'POST' }),
      json(
        400,
        {
          message: '[body.grant_type] Invalid option',
          code: 'VALIDATION_ERROR',
        },
        { 'set-cookie': 'a=b; Path=/', 'x-request-id': 'r-1' },
      ),
      REALM,
    );
    expect(response.status).toBe(400);
    expect(response.headers.get('x-request-id')).toBe('r-1');
    expect(response.headers.get('set-cookie')).toBe('a=b; Path=/');
    expect(await response.json()).toMatchObject({
      error: 'unsupported_grant_type',
    });
  });

  it.each([
    ['a success', `${REALM}/oauth2/userinfo`, json(200, { sub: 'u' })],
    [
      'a redirect',
      `${REALM}/oauth2/authorize?client_id=x`,
      new Response(null, {
        status: 302,
        headers: { location: 'https://app.example.test/cb' },
      }),
    ],
    [
      'an HTML page',
      `${REALM}/oauth2/consent`,
      new Response('<p>refused</p>', {
        status: 400,
        headers: { 'content-type': 'text/html' },
      }),
    ],
    [
      'another auth route',
      `${REALM}/sign-in/email`,
      json(400, { message: 'x', code: 'VALIDATION_ERROR' }),
    ],
  ])('passes %s through untouched', async (_label, url, original) => {
    const response = await withOAuthConformance(
      new Request(url),
      original,
      REALM,
    );
    expect(response).toBe(original);
  });

  it('hands on a refusal whose body is not the JSON its header promised', async () => {
    const original = new Response('not json', {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
    const response = await withOAuthConformance(
      new Request(`${REALM}/oauth2/token`, { method: 'POST' }),
      original,
      REALM,
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toBe('not json');
  });

  it('turns the 415 for a form body on a JSON endpoint into 400 invalid_request', async () => {
    const response = await withOAuthConformance(
      new Request(`${REALM}/oauth2/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'client_name=x',
      }),
      json(415, {
        message:
          'Content-Type "application/x-www-form-urlencoded" is not allowed. Allowed types: application/json',
        code: 'UNSUPPORTED_MEDIA_TYPE',
      }),
      REALM,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'invalid_request',
      error_description: 'the request body must be application/json',
    });
  });

  it('corrects the same redirect in the JSON form a fetch-mode client is handed', async () => {
    const request = new Request(
      `${REALM}/oauth2/authorize?response_type=code&client_id=eval-nope&redirect_uri=https%3A%2F%2Fapp.example.test%2Fcb&scope=openid&state=x`,
      { headers: { 'sec-fetch-mode': 'cors' } },
    );
    const response = await withOAuthConformance(
      request,
      new Response(
        JSON.stringify({
          redirect: true,
          url: `${REALM}/error?error=invalid_client&error_description=client_id+is+required`,
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-request-id': 'r-3',
          },
        },
      ),
      REALM,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBe('r-3');
    const body = (await response.json()) as { redirect: boolean; url: string };
    expect(body.redirect).toBe(true);
    const url = new URL(body.url);
    expect(url.pathname).toBe('/api/auth/error');
    expect(url.searchParams.get('error')).toBe('invalid_client');
    expect(url.searchParams.get('error_description')).toBe(
      'client_id names no registered client',
    );
  });

  it('leaves a JSON authorize answer that is not the unknown-client redirect alone', async () => {
    const request = new Request(
      `${REALM}/oauth2/authorize?response_type=code&client_id=eval-ok&redirect_uri=https%3A%2F%2Fapp.example.test%2Fcb&scope=openid&state=x`,
    );
    const original = JSON.stringify({
      redirect: true,
      url: 'https://app.example.test/oauth/consent?x=1',
    });
    const response = await withOAuthConformance(
      request,
      new Response(original, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      REALM,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(original);
  });

  it('corrects the error-page redirect for an unknown client, keeping every other header', async () => {
    const request = new Request(
      `${REALM}/oauth2/authorize?response_type=code&client_id=eval-nope&redirect_uri=https%3A%2F%2Fapp.example.test%2Fcb&scope=openid&state=x`,
    );
    const response = await withOAuthConformance(
      request,
      new Response(null, {
        status: 302,
        headers: {
          location: `${REALM}/error?error=invalid_client&error_description=client_id+is+required`,
          'set-cookie': 'a=b; Path=/',
          'x-request-id': 'r-2',
        },
      }),
      REALM,
    );
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.pathname).toBe('/api/auth/error');
    expect(location.searchParams.get('error')).toBe('invalid_client');
    expect(location.searchParams.get('error_description')).toBe(
      'client_id names no registered client',
    );
    expect(response.headers.get('set-cookie')).toBe('a=b; Path=/');
    expect(response.headers.get('x-request-id')).toBe('r-2');
  });

  it('leaves the same redirect alone when the client_id really was missing', async () => {
    const original = new Response(null, {
      status: 302,
      headers: {
        location: `${REALM}/error?error=invalid_client&error_description=client_id+is+required`,
      },
    });
    const response = await withOAuthConformance(
      new Request(`${REALM}/oauth2/authorize?response_type=code`),
      original,
      REALM,
    );
    expect(response).toBe(original);
  });
});

/**
 * RFC 6749 §5.2: a token request without a grant_type is `invalid_request`
 * — judged on a clone of the request before the auth handler consumes the
 * body and its schema layer reads the absence as an unsupported grant.
 */
describe('oauthTokenPrecheck', () => {
  const token = (
    body: string,
    contentType = 'application/x-www-form-urlencoded',
  ) =>
    new Request(`${REALM}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': contentType },
      body,
    });

  it('answers 400 invalid_request, uncacheable, and leaves the request body readable', async () => {
    const request = token('nonsense=1');
    const response = await oauthTokenPrecheck(request);
    expect(response?.status).toBe(400);
    expect(response?.headers.get('cache-control')).toBe('no-store');
    expect(await response?.json()).toEqual({
      error: 'invalid_request',
      error_description: 'grant_type is required',
    });
    // The clone was read, not the request the handler would get.
    expect(request.bodyUsed).toBe(false);
  });

  it('is null for a request that names a grant, for another endpoint, and for a body too large to be a token request', async () => {
    expect(await oauthTokenPrecheck(token('grant_type=refresh_token'))).toBe(
      null,
    );
    expect(
      await oauthTokenPrecheck(
        new Request(`${REALM}/oauth2/introspect`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: 'token=abc',
        }),
      ),
    ).toBe(null);
    expect(
      await oauthTokenPrecheck(
        new Request(`${REALM}/oauth2/token`, { method: 'GET' }),
      ),
    ).toBe(null);
    expect(await oauthTokenPrecheck(token('x'.repeat(70 * 1024)))).toBe(null);
  });
});

/**
 * Discovery advertises what this issuer honours: the library lists every
 * prompt value it knows, two of which this deployment refuses or misroutes.
 */
describe('withDiscoveryConformance', () => {
  const document = {
    issuer: REALM,
    claims_supported: ['sub', 'acr'],
    prompt_values_supported: [
      'login',
      'consent',
      'create',
      'select_account',
      'none',
    ],
  };

  it('replaces prompt_values_supported with the honoured set and keeps the rest', async () => {
    const response = await withDiscoveryConformance(
      json(200, document, {
        'cache-control': 'public, max-age=15',
        'content-length': '999',
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=15');
    expect(response.headers.get('content-length')).toBeNull();
    expect(await response.json()).toEqual({
      ...document,
      prompt_values_supported: ['none', 'login', 'consent'],
    });
  });

  it('applies through the mount at both discovery locations', async () => {
    for (const path of [
      '/api/auth/.well-known/openid-configuration',
      '/.well-known/oauth-authorization-server/api/auth',
    ]) {
      const response = await withOAuthConformance(
        new Request(`https://tale.example.com${path}`),
        json(200, document),
        REALM,
      );
      expect(
        ((await response.json()) as { prompt_values_supported: string[] })
          .prompt_values_supported,
      ).toEqual(['none', 'login', 'consent']);
    }
  });

  it('passes a document that is not a 200 JSON object through untouched', async () => {
    const refused = json(404, { message: 'no openid scope' });
    expect(await withDiscoveryConformance(refused)).toBe(refused);
    const html = new Response('<p>x</p>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
    expect(await withDiscoveryConformance(html)).toBe(html);
  });
});
