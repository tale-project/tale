// @vitest-environment node

/**
 * An OAuth2 credential's `secret.expiresAt` is when the stored access token
 * lapses — the resolver refreshes against it — and the create and update
 * doors took any number: `9e15` (an instant no `Date` can hold), a negative
 * or a fractional millisecond was sealed into the secret as its expiry. Both
 * doors now hold it to `epochMsSchema` and refuse the rest with their 400
 * before anything is encrypted.
 */

import { EPOCH_MS_MAX } from '@tale/shared/schemas/epoch-ms';
import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const { createCredential, updateCredential } = vi.hoisted(() => ({
  createCredential: vi.fn(),
  updateCredential: vi.fn(),
}));

vi.mock('./service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./service.ts')>()),
  createCredential,
  updateCredential,
}));

vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', {
        user: { id: 'u1', email: 'u@example.test' },
      } as never);
      await next();
    },
}));

vi.mock('../../auth/org.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auth/org.ts')>()),
  requireOrgMember:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('orgId', 'o1');
      c.set('orgMember', { role: 'admin' } as never);
      await next();
    },
}));

import { createConnectorCredentialRoutes } from './routes.ts';

async function send(
  method: 'POST' | 'PATCH',
  route: string,
  body: unknown,
): Promise<Response> {
  return await createConnectorCredentialRoutes({
    sql: {} as never,
    auth: {} as never,
  }).request(route, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const secret = (expiresAt: unknown) => ({
  accessToken: 'at',
  refreshToken: 'rt',
  expiresAt,
});

const create = (expiresAt: unknown) =>
  send('POST', '/', {
    connectorSlug: 'github',
    authMethod: 'oauth2',
    name: 'GitHub',
    secret: secret(expiresAt),
  });

const update = (expiresAt: unknown) =>
  send('PATCH', '/cred-1', { secret: secret(expiresAt) });

beforeEach(() => {
  createCredential.mockReset().mockResolvedValue({ id: 'cred-1' });
  updateCredential.mockReset().mockResolvedValue(undefined);
});

const REFUSED = [9e15, EPOCH_MS_MAX + 1, -1, 1_790_400_000_000.5, 'soon'];

describe('connector credential doors hold secret.expiresAt to the epoch bound', () => {
  it.each(REFUSED)('refuses %s on create with a 400', async (expiresAt) => {
    const res = await create(expiresAt);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid body' });
    expect(createCredential).not.toHaveBeenCalled();
  });

  it.each(REFUSED)('refuses %s on update with a 400', async (expiresAt) => {
    const res = await update(expiresAt);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid body' });
    expect(updateCredential).not.toHaveBeenCalled();
  });

  it('takes the latest instant a Date can hold on both doors', async () => {
    expect((await create(EPOCH_MS_MAX)).status).toBe(201);
    expect(createCredential).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ secret: secret(EPOCH_MS_MAX) }),
    );
    expect((await update(EPOCH_MS_MAX)).status).toBe(200);
    expect(updateCredential).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ secret: secret(EPOCH_MS_MAX) }),
    );
  });
});
