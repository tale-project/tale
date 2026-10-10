// @vitest-environment node

/**
 * /api/app/api-keys at the boundary: the body a key for someone else is
 * made from, the refusal envelope its domain errors answer in, and who the
 * service is told is acting.
 */

import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const service = vi.hoisted(() => ({
  createOwnedApiKey: vi.fn(),
  listApiKeysForViewer: vi.fn(),
  revokeBoundApiKey: vi.fn(),
}));

vi.mock('./service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./service.ts')>()),
  ...service,
}));
vi.mock('../../auth/auth.ts', () => ({
  loadTrustedProxies: () => Promise.resolve([]),
}));
vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', {
        user: { id: 'ada', email: 'ada@example.test', name: 'Ada' },
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
    });
  });

  it('refuses an owner it does not know, a role a key cannot have, and an unknown field', async () => {
    for (const body of [
      { name: 'Sync', owner: { kind: 'self' } },
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
    });
  });
});
