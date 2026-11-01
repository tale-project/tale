/**
 * The org OAuth app door's body refusal. It used to answer a bare
 * `Invalid OAuth app payload.`, which the Settings dialog shows as written,
 * so an admin could not tell which field to fix.
 */

import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const { upsertOauthApp, deleteOauthApp, member } = vi.hoisted(() => ({
  upsertOauthApp: vi.fn(),
  deleteOauthApp: vi.fn(),
  member: { role: 'admin' },
}));

vi.mock('./oauth-apps.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./oauth-apps.ts')>()),
  upsertOauthApp,
  deleteOauthApp,
}));
vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', {
        user: { id: 'u1', email: 'u@example.test', name: 'User' },
        session: { id: 's1' },
      } as never);
      await next();
    },
}));
vi.mock('../../auth/org.ts', () => ({
  requireOrgMember:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('orgId', 'o1');
      c.set('orgMember', { role: member.role } as never);
      await next();
    },
}));

import { createConnectorOauthAppRoutes } from './oauth-app-routes.ts';

const app = createConnectorOauthAppRoutes({
  sql: {} as never,
  auth: {} as never,
});

function put(body: string) {
  return app.request('/onedrive?orgId=o1', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
}

describe('PUT /connector-oauth-apps/:slug', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    [{ clientSecret: 'shhh' }, 'clientId', 'clientId: is required'],
    [{ clientId: '' }, 'clientId', 'clientId: Too small'],
    [{ clientId: 'id', tenantId: 't'.repeat(257) }, 'tenantId', 'tenantId: '],
  ])('names the refused field of %j', async (body, path, reason) => {
    const res = await put(JSON.stringify(body));
    expect(res.status).toBe(400);
    const refusal = (await res.json()) as {
      error: string;
      message: string;
      data: { issues: { path: string }[] };
    };
    expect(refusal.error).toBe('invalid body');
    expect(refusal.message.startsWith(reason)).toBe(true);
    expect(refusal.data.issues.map((issue) => issue.path)).toEqual([path]);
    expect(upsertOauthApp).not.toHaveBeenCalled();
  });

  it('names a body that is not JSON', async () => {
    const res = await put('not json');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toMatch(
      /^body: /,
    );
  });

  it('saves a well-formed app', async () => {
    upsertOauthApp.mockResolvedValue({ slug: 'onedrive' });
    const res = await put(
      JSON.stringify({ clientId: 'id', clientSecret: 's' }),
    );
    expect(res.status).toBe(200);
    expect(upsertOauthApp).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: 'o1',
        slug: 'onedrive',
        clientId: 'id',
        clientSecret: 's',
      }),
    );
  });
});

// #5222: these answers carried a sentence and no code, so the Settings card
// could only show the English sentence in every locale.
describe('the OAuth app door codes every refusal it words', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    member.role = 'admin';
  });

  it.each([
    ['PUT', '/onedrive'],
    ['POST', '/onedrive/reuse-sso'],
    ['DELETE', '/onedrive'],
  ])('refuses %s %s to a member as FORBIDDEN', async (method, path) => {
    member.role = 'member';
    const res = await app.request(`${path}?orgId=o1`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(method === 'PUT' ? { body: JSON.stringify({ clientId: 'id' }) } : {}),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'Only admins can configure OAuth apps.',
      code: 'FORBIDDEN',
    });
    expect(upsertOauthApp).not.toHaveBeenCalled();
    expect(deleteOauthApp).not.toHaveBeenCalled();
  });

  it('codes a connector that takes no org OAuth app', async () => {
    const res = await app.request('/slack?orgId=o1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'id', clientSecret: 's' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: 'oauth_app_not_configurable',
    });
    expect(upsertOauthApp).not.toHaveBeenCalled();
  });

  it('codes an SSO reuse for another app than the Microsoft 365 import', async () => {
    const res = await app.request('/outlook/reuse-sso?orgId=o1', {
      method: 'POST',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'sso_reuse_unsupported' });
  });

  it('codes a removal of an app that is not configured', async () => {
    deleteOauthApp.mockResolvedValue(false);
    const res = await app.request('/onedrive?orgId=o1', { method: 'DELETE' });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'oauth_app_not_found' });
  });
});
