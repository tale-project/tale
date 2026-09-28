/**
 * The org OAuth app door's body refusal. It used to answer a bare
 * `Invalid OAuth app payload.`, which the Settings dialog shows as written,
 * so an admin could not tell which field to fix.
 */

import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const { upsertOauthApp } = vi.hoisted(() => ({ upsertOauthApp: vi.fn() }));

vi.mock('./oauth-apps.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./oauth-apps.ts')>()),
  upsertOauthApp,
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
      c.set('orgMember', { role: 'admin' } as never);
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
