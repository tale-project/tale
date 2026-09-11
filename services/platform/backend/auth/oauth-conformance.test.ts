// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { withOAuthConformance } from './oauth-conformance.ts';

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
});
