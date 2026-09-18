// @vitest-environment node

import type { Context, Next } from 'hono';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Auth } from '../../auth/auth.ts';
import { createTrustedHeaderAdminRoutes } from './routes.ts';
import * as service from './service.ts';
import { TrustedHeadersError } from './service.ts';

/**
 * The admin door's wiring: every verb behind the `orgSettings` ability,
 * bodies validated before the service is reached, and the service's coded
 * refusals answered with their status. The session and org middlewares are
 * stubbed to a fixed admin (or member) so this exercises the routes alone.
 */

const caller = vi.hoisted(() => ({ role: 'admin' }));

vi.mock('../../auth/session.ts', () => ({
  requireSession: () => async (c: Context, next: Next) => {
    c.set('sessionBundle', {
      user: { id: 'admin-1', email: 'admin@door.test', name: 'Admin' },
      session: { id: 'sess-1' },
    });
    return next();
  },
}));

vi.mock('../../auth/org.ts', () => ({
  requireOrgMember: () => async (c: Context, next: Next) => {
    c.set('orgId', 'org-1');
    c.set('orgMember', {
      id: 'member-1',
      organizationId: 'org-1',
      userId: 'admin-1',
      role: caller.role,
    });
    return next();
  },
}));

vi.mock('./service.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./service.ts')>();
  return {
    ...actual,
    getTrustedHeadersView: vi.fn(),
    setTrustedHeaderSettings: vi.fn(),
    createTrustedHeaderKey: vi.fn(),
    revokeTrustedHeaderKey: vi.fn(),
  };
});

const view = {
  enabled: true,
  maxAssertedRole: 'member' as const,
  keys: [],
  headers: {
    key: 'Remote-Internal-Secret',
    email: 'Remote-Email',
    name: 'Remote-Name',
    role: 'Remote-Role',
    teams: 'Remote-Teams',
  },
};

function app() {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double: the stubbed middlewares touch neither
  const sql = (() => Promise.resolve([])) as unknown as Sql;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  const auth = {} as unknown as Auth;
  return createTrustedHeaderAdminRoutes({ sql, auth });
}

async function request(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  return await app().request(`http://backend-api:3005${path}?orgId=org-1`, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    ...(init.body !== undefined
      ? {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(init.body),
        }
      : {}),
  });
}

beforeEach(() => {
  caller.role = 'admin';
  vi.mocked(service.getTrustedHeadersView).mockReset().mockResolvedValue(view);
  vi.mocked(service.setTrustedHeaderSettings)
    .mockReset()
    .mockResolvedValue(view);
  vi.mocked(service.createTrustedHeaderKey).mockReset().mockResolvedValue({
    id: 'key-1',
    key: 'thk_plaintext',
    tokenPrefix: 'thk_plaintex…',
  });
  vi.mocked(service.revokeTrustedHeaderKey).mockReset().mockResolvedValue();
});

describe('the orgSettings gate', () => {
  it.each([
    ['GET', '/'],
    ['PUT', '/settings'],
    ['POST', '/keys'],
    ['DELETE', '/keys/key-1'],
  ])('%s %s refuses a member with ROLE_FORBIDDEN', async (method, path) => {
    caller.role = 'member';

    const res = await request(path, {
      method,
      ...(method === 'GET' || method === 'DELETE'
        ? {}
        : { body: { enabled: true, maxAssertedRole: 'member', name: 'x' } }),
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'ROLE_FORBIDDEN' });
    expect(service.getTrustedHeadersView).not.toHaveBeenCalled();
    expect(service.setTrustedHeaderSettings).not.toHaveBeenCalled();
    expect(service.createTrustedHeaderKey).not.toHaveBeenCalled();
    expect(service.revokeTrustedHeaderKey).not.toHaveBeenCalled();
  });

  it('opens for the organization owner too', async () => {
    caller.role = 'owner';

    const res = await request('/');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(view);
  });
});

describe('GET /', () => {
  it("answers the organization's view", async () => {
    const res = await request('/');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(view);
    expect(service.getTrustedHeadersView).toHaveBeenCalledWith(
      expect.anything(),
      'org-1',
    );
  });
});

describe('PUT /settings', () => {
  it('refuses a body outside the schema before the service is reached', async () => {
    const res = await request('/settings', {
      method: 'PUT',
      body: { enabled: 'yes', maxAssertedRole: 'owner' },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'INVALID_BODY' });
    expect(service.setTrustedHeaderSettings).not.toHaveBeenCalled();
  });

  it('hands the switch, the ceiling and the acting admin to the service', async () => {
    const res = await request('/settings', {
      method: 'PUT',
      body: { enabled: true, maxAssertedRole: 'developer' },
    });

    expect(res.status).toBe(200);
    expect(service.setTrustedHeaderSettings).toHaveBeenCalledWith(
      expect.anything(),
      {
        organizationId: 'org-1',
        actor: { userId: 'admin-1', email: 'admin@door.test' },
        enabled: true,
        maxAssertedRole: 'developer',
      },
    );
  });
});

describe('POST /keys', () => {
  it('refuses a nameless key', async () => {
    const res = await request('/keys', { body: { name: '   ' } });

    expect(res.status).toBe(400);
    expect(service.createTrustedHeaderKey).not.toHaveBeenCalled();
  });

  it('answers 201 with the plaintext the service minted', async () => {
    const res = await request('/keys', { body: { name: 'Host proxy' } });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      id: 'key-1',
      key: 'thk_plaintext',
      tokenPrefix: 'thk_plaintex…',
    });
    expect(service.createTrustedHeaderKey).toHaveBeenCalledWith(
      expect.anything(),
      {
        organizationId: 'org-1',
        actor: { userId: 'admin-1', email: 'admin@door.test' },
        name: 'Host proxy',
      },
    );
  });

  it("answers the service's ceiling refusal with its status and code", async () => {
    vi.mocked(service.createTrustedHeaderKey).mockRejectedValue(
      new TrustedHeadersError('TRUSTED_HEADER_KEY_LIMIT', 'too many', 409),
    );

    const res = await request('/keys', { body: { name: 'eleventh' } });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'too many',
      code: 'TRUSTED_HEADER_KEY_LIMIT',
    });
  });
});

describe('DELETE /keys/:id', () => {
  it('revokes as the acting admin', async () => {
    const res = await request('/keys/key-1', { method: 'DELETE' });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(service.revokeTrustedHeaderKey).toHaveBeenCalledWith(
      expect.anything(),
      {
        organizationId: 'org-1',
        actor: { userId: 'admin-1', email: 'admin@door.test' },
        keyId: 'key-1',
      },
    );
  });

  it("answers not-found for a key that is not this organization's", async () => {
    vi.mocked(service.revokeTrustedHeaderKey).mockRejectedValue(
      new TrustedHeadersError('TRUSTED_HEADER_KEY_NOT_FOUND', 'no such', 404),
    );

    const res = await request('/keys/stranger', { method: 'DELETE' });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: 'no such',
      code: 'TRUSTED_HEADER_KEY_NOT_FOUND',
    });
  });
});
