// @vitest-environment node

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from './app.ts';
import type { Auth } from './auth/auth.ts';

vi.mock('./lib/rate-limit.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/rate-limit.ts')>();
  return {
    ...actual,
    checkIpRateLimit: vi.fn(() => Promise.resolve()),
    checkKeyedRateLimit: vi.fn(() => Promise.resolve()),
  };
});

/**
 * Where a coding agent learns how to sign in: the MCP endpoint's resource
 * metadata (RFC 9728) at the host root, and the issuer's own metadata
 * (RFC 8414) at the issuer's path — the base path of a subpath deployment
 * included — and the agent sign-in steps in front of the provider.
 */

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the routes under test read no database
const sql = (() => Promise.resolve([{ count: 0 }])) as unknown as Sql;

function app(baseURL: string, handler = vi.fn()) {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- provider test double
  const auth = {
    api: {
      getSession: vi.fn(),
      getOAuthServerConfig: vi.fn(() =>
        Promise.resolve({
          issuer: `${baseURL}/api/auth`,
          prompt_values_supported: [
            'login',
            'consent',
            'create',
            'select_account',
            'none',
          ],
        }),
      ),
    },
    handler,
    options: { baseURL },
  } as unknown as Auth;
  return createApp({ sql, auth });
}

beforeEach(() => {
  vi.stubEnv('SITE_URL', 'https://tale.example.com');
  vi.stubEnv('ADDITIONAL_SITE_URLS', '');
  vi.stubEnv('BASE_PATH', '');
  // Both ways in are on unless the operator turns them off; saying so keeps
  // each test's setting in view.
  vi.stubEnv('TALE_MCP_CLIENT_METADATA_DOCUMENTS', 'true');
  vi.stubEnv('TALE_MCP_DYNAMIC_CLIENT_REGISTRATION', 'true');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const onTale = { host: 'tale.example.com', 'x-forwarded-proto': 'https' };

describe('the MCP endpoint’s resource metadata', () => {
  it('answers at the endpoint’s own path and at the root, HEAD included, without a session — and 404 for a path it does not name', async () => {
    const application = app('https://tale.example.com');
    for (const path of [
      '/.well-known/oauth-protected-resource/api/v1/mcp',
      '/.well-known/oauth-protected-resource',
    ]) {
      const res = await application.request(path, { headers: onTale });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        resource: 'https://tale.example.com/api/v1/mcp',
        authorization_servers: ['https://tale.example.com/api/auth'],
        scopes_supported: [
          'tale:mcp',
          'tale:automations.write',
          'tale:automations.deploy',
          'tale:settings.read',
          'tale:settings.write',
          'tale:subscriptions.connect',
          'offline_access',
        ],
        bearer_methods_supported: ['header'],
        resource_name: 'Tale',
      });
    }
    const head = await application.request(
      '/.well-known/oauth-protected-resource/api/v1/mcp',
      { method: 'HEAD', headers: onTale },
    );
    expect(head.status).toBe(200);
    expect(
      (
        await application.request(
          '/.well-known/oauth-protected-resource/api/v1/me',
          { headers: onTale },
        )
      ).status,
    ).toBe(404);
  });

  it('keeps the base path of a subpath deployment in the resource and its metadata path', async () => {
    vi.stubEnv('BASE_PATH', '/tale');
    const application = app('https://tale.example.com/tale');
    const res = await application.request(
      '/.well-known/oauth-protected-resource/tale/api/v1/mcp',
      { headers: onTale },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      resource: 'https://tale.example.com/tale/api/v1/mcp',
      authorization_servers: ['https://tale.example.com/tale/api/auth'],
    });
  });
});

describe('a deployment that leaves agents no way in', () => {
  it('answers no resource metadata and hands a self-registration to the provider untouched', async () => {
    vi.stubEnv('TALE_MCP_CLIENT_METADATA_DOCUMENTS', 'false');
    vi.stubEnv('TALE_MCP_DYNAMIC_CLIENT_REGISTRATION', 'false');
    const handler = vi.fn(() => Promise.resolve(new Response('{}')));
    const application = app('https://tale.example.com', handler);
    expect(
      (
        await application.request(
          '/.well-known/oauth-protected-resource/api/v1/mcp',
          { headers: onTale },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await application.request('/.well-known/oauth-protected-resource', {
          headers: onTale,
        })
      ).status,
    ).toBe(404);
    // Registration is the provider's to refuse, as before: Tale's own steps
    // in front of it only run while the operator allows registration.
    await application.request('/api/auth/oauth2/register', {
      method: 'POST',
      headers: { ...onTale, 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['https://evil.example/cb'] }),
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('the issuer’s metadata at the host root', () => {
  it('answers at the issuer’s path, with the prompt values the issuer honours', async () => {
    const res = await app('https://tale.example.com').request(
      '/.well-known/oauth-authorization-server/api/auth',
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      issuer: 'https://tale.example.com/api/auth',
      prompt_values_supported: ['none', 'login', 'consent'],
    });
  });

  it('answers under a subpath deployment at the issuer’s path, base path included', async () => {
    const application = app('https://tale.example.com/tale');
    const res = await application.request(
      '/.well-known/oauth-authorization-server/tale/api/auth',
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      issuer: 'https://tale.example.com/tale/api/auth',
    });
  });
});

describe('the agent sign-in steps at the auth mount', () => {
  it('refuses a self-registration with a foreign web redirect before the provider sees it', async () => {
    const handler = vi.fn(() => Promise.resolve(new Response('{}')));
    const res = await app('https://tale.example.com', handler).request(
      '/api/auth/oauth2/register',
      {
        method: 'POST',
        headers: { ...onTale, 'content-type': 'application/json' },
        body: JSON.stringify({ redirect_uris: ['https://evil.example/cb'] }),
      },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'invalid_redirect_uri',
      error_description:
        'this server accepts web redirects only to known agent hosts; use a local (loopback) redirect',
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('hands every other auth request to the provider as it came', async () => {
    const handler = vi.fn((request: Request) =>
      Promise.resolve(Response.json({ path: new URL(request.url).pathname })),
    );
    const res = await app('https://tale.example.com', handler).request(
      '/api/auth/get-session',
      { headers: onTale },
    );
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
