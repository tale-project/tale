// @vitest-environment node
import type { Context } from 'hono';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org';
import { createProviderCredentialRoutes } from './routes';
import { CredentialAdminError } from './service';

/**
 * The credential edit door answers the service's refusals as coded JSON
 * with their status — a disable or un-default of the embedding model's
 * credential lands as the same 409 `CREDENTIAL_IN_USE` the delete gives,
 * with `data.usedBy` for the dialog to name the dependent.
 */

const { updateCredential } = vi.hoisted(() => ({
  updateCredential: vi.fn(),
}));

vi.mock('@tale/shared/db/serializable', () => ({
  transactSerializable: async (
    sql: unknown,
    work: (tx: unknown) => Promise<unknown>,
  ) => work(sql),
}));
vi.mock('./service', async (original) => ({
  ...(await original<typeof import('./service')>()),
  updateCredential,
}));
vi.mock('../../auth/session', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', {
        user: { id: 'operator', email: 'operator@example.test' },
      } as never);
      await next();
    },
}));
vi.mock('../../auth/org', async (original) => ({
  ...(await original<typeof import('../../auth/org')>()),
  requireOrgMember:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('orgId', 'org-a');
      c.set('orgMember', { role: 'admin' } as never);
      await next();
    },
}));

function app() {
  const tag = async () => [];
  return createProviderCredentialRoutes({
    sql: tag as unknown as Sql,
    auth: {} as never,
  });
}

const update = (body: Record<string, unknown>) =>
  app().request('/cred-1?orgId=org-a', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  updateCredential.mockResolvedValue(undefined);
});

describe('POST /provider-credentials/:id — the edit door', () => {
  it('hands the patch to the service under the caller scope', async () => {
    const response = await update({ status: 'disabled' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(updateCredential).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: 'org-a', userId: 'operator' }),
      'cred-1',
      { status: 'disabled' },
      undefined,
    );
  });

  it.each([{ status: 'disabled' }, { isDefault: false }])(
    'answers the refused edit %j as 409 CREDENTIAL_IN_USE with what uses it',
    async (patch) => {
      updateCredential.mockRejectedValue(
        new CredentialAdminError('CREDENTIAL_IN_USE', 'in use', 409, {
          usedBy: ['embedding'],
        }),
      );
      const response = await update(patch);
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: 'CREDENTIAL_IN_USE',
        message: 'in use',
        data: { usedBy: ['embedding'] },
      });
    },
  );
});
