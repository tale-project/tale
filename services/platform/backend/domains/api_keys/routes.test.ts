// @vitest-environment node

/**
 * /api/app/api-keys at the boundary: the body a key for someone else is
 * made from, the refusal envelope its domain errors answer in, who the
 * service is told is acting, and the doors an Owner or Admin reads and
 * blocks a member's own keys through.
 */

import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const service = vi.hoisted(() => ({
  createOwnedApiKey: vi.fn(),
  listApiKeysForViewer: vi.fn(),
  revokeBoundApiKey: vi.fn(),
}));
const blocks = vi.hoisted(() => ({
  listMemberPersonalApiKeys: vi.fn(),
  setPersonalApiKeyBlock: vi.fn(),
}));
/** The organization the request's session is bound to: none for a password
 * sign-in, this one after single sign-on or a proxy. */
const session = vi.hoisted(() => ({
  trustedOrganizationId: null as string | null,
}));

vi.mock('./service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./service.ts')>()),
  ...service,
}));
vi.mock('./blocks.ts', () => blocks);
vi.mock('../../auth/auth.ts', () => ({
  loadTrustedProxies: () => Promise.resolve([]),
}));
vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', {
        user: { id: 'ada', email: 'ada@example.test', name: 'Ada' },
        session: {
          id: 'session-1',
          trustedOrganizationId: session.trustedOrganizationId,
        },
      } as never);
      await next();
    },
}));
vi.mock('../../auth/org.ts', () => ({
  requireOrgMember:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('orgId', 'org-1');
      c.set('orgMember', { role: 'admin' } as never);
      await next();
    },
}));

import { createApiKeyRoutes } from './routes.ts';
import { ApiKeyError } from './service.ts';

function app() {
  return createApiKeyRoutes({ sql: {} as never, auth: {} as never });
}

function post(body: unknown) {
  return app().request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'probe' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  session.trustedOrganizationId = null;
  service.createOwnedApiKey.mockResolvedValue({
    id: 'key-new',
    key: 'tale_secret',
    name: 'Sync',
    expiresAt: null,
    owner: { kind: 'organization', role: 'member' },
  });
});

describe('POST /api/app/api-keys', () => {
  it('makes the key as the signed-in admin, and shows the secret once', async () => {
    const res = await post({
      name: 'Sync',
      expiresIn: 7 * 86_400,
      owner: { kind: 'team', teamId: 'finance', role: 'editor' },
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      id: 'key-new',
      key: 'tale_secret',
      name: 'Sync',
      expiresAt: null,
    });
    expect(service.createOwnedApiKey.mock.calls[0]?.[1]).toEqual({
      organizationId: 'org-1',
      actor: {
        userId: 'ada',
        email: 'ada@example.test',
        name: 'Ada',
        role: 'admin',
        userAgent: 'probe',
      },
      name: 'Sync',
      expiresIn: 7 * 86_400,
      owner: { kind: 'team', teamId: 'finance', role: 'editor' },
      sessionBoundHere: false,
    });
  });

  it('says whether the session is bound to this organization, for a key of your own [APIKEY-R13]', async () => {
    for (const [realm, bound] of [
      [null, false],
      ['org-1', true],
    ] as const) {
      service.createOwnedApiKey.mockClear();
      session.trustedOrganizationId = realm;
      const res = await post({ name: 'Laptop', owner: { kind: 'self' } });
      expect(res.status).toBe(201);
      expect(service.createOwnedApiKey.mock.calls[0]?.[1]).toMatchObject({
        owner: { kind: 'self' },
        sessionBoundHere: bound,
      });
    }
  });

  it('refuses an owner it does not know, a role a key cannot have, and an unknown field', async () => {
    for (const body of [
      { name: 'Sync', owner: { kind: 'someone' } },
      { name: 'Sync', owner: { kind: 'organization', role: 'owner' } },
      { name: 'Sync', owner: { kind: 'team', role: 'member' } },
      { name: 'Sync', owner: { kind: 'organization', role: 'member' }, x: 1 },
      { name: '', owner: { kind: 'organization', role: 'member' } },
      {
        name: 'Sync',
        expiresIn: 1.5,
        owner: { kind: 'organization', role: 'member' },
      },
    ]) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(service.createOwnedApiKey).not.toHaveBeenCalled();
  });

  it('answers a domain refusal with its code and status', async () => {
    service.createOwnedApiKey.mockRejectedValueOnce(
      new ApiKeyError(
        'API_KEY_MEMBER_FORBIDDEN',
        'You can make a key only for a member whose role is below yours.',
        403,
      ),
    );
    const res = await post({
      name: 'Sync',
      owner: { kind: 'member', userId: 'olav' },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'API_KEY_MEMBER_FORBIDDEN',
      message:
        'You can make a key only for a member whose role is below yours.',
    });
  });
});

describe('DELETE /api/app/api-keys/:keyId', () => {
  it('ends the key as the signed-in member, or answers not found', async () => {
    service.revokeBoundApiKey.mockResolvedValueOnce(undefined);
    const ok = await app().request('/key%2F1', { method: 'DELETE' });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    expect(service.revokeBoundApiKey.mock.calls[0]?.[1]).toMatchObject({
      organizationId: 'org-1',
      keyId: 'key/1',
      actor: { userId: 'ada', role: 'admin' },
    });

    service.revokeBoundApiKey.mockRejectedValueOnce(
      new ApiKeyError('API_KEY_NOT_FOUND', 'API key not found.', 404),
    );
    const missing = await app().request('/key-2', { method: 'DELETE' });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: 'API_KEY_NOT_FOUND' });
  });
});

describe('GET /api/app/api-keys', () => {
  it('lists the keys the signed-in member may see here', async () => {
    service.listApiKeysForViewer.mockResolvedValueOnce([{ id: 'key-1' }]);
    const res = await app().request('/');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ keys: [{ id: 'key-1' }] });
    expect(service.listApiKeysForViewer.mock.calls[0]?.[1]).toEqual({
      organizationId: 'org-1',
      userId: 'ada',
      role: 'admin',
      // A password session: it may end the keys that work everywhere.
      sessionBound: false,
    });
    expect(service.listApiKeysForViewer.mock.calls[0]?.[2]).toBe('managed');
  });

  it('tells the list when the session covers this organization alone [APIKEY-R13]', async () => {
    session.trustedOrganizationId = 'org-1';
    service.listApiKeysForViewer.mockResolvedValueOnce([]);
    await app().request('/');
    expect(service.listApiKeysForViewer.mock.calls[0]?.[1]).toMatchObject({
      sessionBound: true,
    });
  });

  it('passes on a request for every key here, and refuses any other scope [APIKEY-R8]', async () => {
    service.listApiKeysForViewer.mockResolvedValueOnce([]);
    const all = await app().request('/?scope=all');
    expect(all.status).toBe(200);
    expect(await all.json()).toEqual({ keys: [] });
    expect(service.listApiKeysForViewer.mock.calls[0]?.[2]).toBe('all');

    const bogus = await app().request('/?scope=everyone');
    expect(bogus.status).toBe(400);
    expect(await bogus.json()).toMatchObject({ code: 'INVALID_QUERY' });
    expect(service.listApiKeysForViewer).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/app/api-keys/members/:userId/personal', () => {
  it('lists a member’s own keys as the signed-in Owner or Admin may see them [APIKEY-R11]', async () => {
    const answer = {
      keys: [{ id: 'key-1', blocked: null }],
      canBlock: true,
    };
    blocks.listMemberPersonalApiKeys.mockResolvedValueOnce(answer);
    const res = await app().request('/members/mia%2Fk/personal');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(answer);
    expect(blocks.listMemberPersonalApiKeys.mock.calls[0]?.[1]).toEqual({
      organizationId: 'org-1',
      actor: { userId: 'ada', role: 'admin' },
      memberUserId: 'mia/k',
    });
  });

  it('answers a refusal with its code and status [APIKEY-R11]', async () => {
    blocks.listMemberPersonalApiKeys.mockRejectedValueOnce(
      new ApiKeyError(
        'API_KEY_MEMBER_NOT_FOUND',
        'Not a member of this organization.',
        404,
      ),
    );
    const res = await app().request('/members/stranger/personal');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: 'API_KEY_MEMBER_NOT_FOUND',
      message: 'Not a member of this organization.',
    });
  });
});

describe('PUT and DELETE /api/app/api-keys/:keyId/block', () => {
  it('blocks the key here as the signed-in member, and lifts the block [APIKEY-R11]', async () => {
    blocks.setPersonalApiKeyBlock.mockResolvedValue({ changed: true });
    const blocked = await app().request('/key%2F1/block', {
      method: 'PUT',
      headers: { 'user-agent': 'probe' },
    });
    expect(blocked.status).toBe(200);
    expect(await blocked.json()).toEqual({
      ok: true,
      blocked: true,
      changed: true,
    });
    expect(blocks.setPersonalApiKeyBlock.mock.calls[0]?.[1]).toEqual({
      organizationId: 'org-1',
      actor: {
        userId: 'ada',
        email: 'ada@example.test',
        name: 'Ada',
        role: 'admin',
        userAgent: 'probe',
      },
      keyId: 'key/1',
      blocked: true,
    });

    const lifted = await app().request('/key-1/block', { method: 'DELETE' });
    expect(lifted.status).toBe(200);
    expect(await lifted.json()).toEqual({
      ok: true,
      blocked: false,
      changed: true,
    });
    expect(blocks.setPersonalApiKeyBlock.mock.calls[1]?.[1]).toMatchObject({
      keyId: 'key-1',
      blocked: false,
    });
    // Ending a key bound here is another door, and stays untouched.
    expect(service.revokeBoundApiKey).not.toHaveBeenCalled();
  });

  it('says when a repeated block changed nothing [APIKEY-R11]', async () => {
    blocks.setPersonalApiKeyBlock.mockResolvedValueOnce({ changed: false });
    const res = await app().request('/key-1/block', { method: 'PUT' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      blocked: true,
      changed: false,
    });
  });

  it('answers a refused block and a key that is no member’s own key here with their code and status [APIKEY-R11]', async () => {
    blocks.setPersonalApiKeyBlock.mockRejectedValueOnce(
      new ApiKeyError(
        'API_KEY_BLOCK_FORBIDDEN',
        "An Admin cannot block or free an Owner's API keys.",
        403,
      ),
    );
    const refused = await app().request('/key-olav/block', { method: 'PUT' });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({
      error: 'API_KEY_BLOCK_FORBIDDEN',
      message: "An Admin cannot block or free an Owner's API keys.",
    });

    blocks.setPersonalApiKeyBlock.mockRejectedValueOnce(
      new ApiKeyError('API_KEY_NOT_FOUND', 'API key not found.', 404),
    );
    const bound = await app().request('/key-bound/block', {
      method: 'DELETE',
    });
    expect(bound.status).toBe(404);
    expect(await bound.json()).toMatchObject({ error: 'API_KEY_NOT_FOUND' });
  });
});
