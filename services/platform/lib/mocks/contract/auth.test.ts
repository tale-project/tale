/**
 * Contract tests for the Enterprise SSO IdP mock. Boots the gateway and pins
 * the three OIDC endpoints the SSO sign-in flow depends on (discovery → token
 * → userinfo) in the exact shapes the adapters parse, validated by Prism
 * against the spec. The full offline SSO sign-in path is exercised by the
 * Playwright suite (issuer pointed at this mount); here we pin the shapes.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { createGatewayHandler } from '../gateway';
import { readJson } from './json';

const BASE = 'http://127.0.0.1:4141';
let handle: (request: Request) => Promise<Response>;

beforeAll(async () => {
  handle = await createGatewayHandler();
});
afterAll(() => {});

describe('SSO IdP mock', () => {
  test('discovery advertises the token + userinfo endpoints', async () => {
    const res = await handle(
      new Request(`${BASE}/mock/sso-idp/.well-known/openid-configuration`),
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.issuer).toBeDefined();
    expect(body.token_endpoint).toContain('/token');
    expect(body.userinfo_endpoint).toContain('/userinfo');
  });

  test('token exchange returns a bearer access token', async () => {
    const res = await handle(
      new Request(`${BASE}/mock/sso-idp/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=authorization_code&code=abc',
      }),
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.access_token).toBeDefined();
    expect(body.token_type).toBe('Bearer');
  });

  test('userinfo returns sub + email + groups', async () => {
    const res = await handle(new Request(`${BASE}/mock/sso-idp/userinfo`));
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.sub).toBeDefined();
    expect(body.email).toContain('@');
    expect(Array.isArray(body.groups)).toBe(true);
  });
});
