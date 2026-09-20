// @vitest-environment node
import type { Context } from 'hono';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org';
import { createProviderCredentialRoutes } from './routes';

/**
 * The credential door's one cross-resource effect: a custom provider created
 * from the credential dialog goes with its LAST credential, when the caller
 * asks — never a shipped provider, never while another credential remains,
 * never without the flag. The credential delete itself and the definition
 * removal are covered by their own tests; here they are stubs.
 */

const { caller, deleteCredential, deleteDefinition, remaining, customNames } =
  vi.hoisted(() => ({
    caller: { role: 'admin', orgId: 'org-a', slug: 'north' },
    deleteCredential: vi.fn(),
    deleteDefinition: vi.fn(),
    remaining: { count: 0 },
    customNames: ['qwen-cn'],
  }));

vi.mock('@tale/shared/db/serializable', () => ({
  transactSerializable: async (
    sql: unknown,
    work: (tx: unknown) => Promise<unknown>,
  ) => work(sql),
}));
vi.mock('./service', async (original) => ({
  ...(await original<typeof import('./service')>()),
  deleteCredential,
}));
vi.mock('../providers/config', () => ({
  deleteProviderDefinition: deleteDefinition,
}));
vi.mock('../../core/lib/providers/org_providers', () => ({
  loadOrgCustomProviders: () => customNames.map((name) => ({ name })),
}));
vi.mock('../../lib/org-config', async (original) => ({
  ...(await original<typeof import('../../lib/org-config')>()),
  resolveOrgSlug: vi.fn(async () => caller.slug),
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
      c.set('orgId', caller.orgId);
      c.set('orgMember', { role: caller.role } as never);
      await next();
    },
}));

function app() {
  // Every query answers the remaining-credential count.
  const tag = async () => [remaining];
  return createProviderCredentialRoutes({
    sql: tag as unknown as Sql,
    auth: {} as never,
  });
}

const remove = (query = '') =>
  app().request(`/cred-1?orgId=org-a${query}`, { method: 'DELETE' });

beforeEach(() => {
  vi.clearAllMocks();
  remaining.count = 0;
  customNames.splice(0, customNames.length, 'qwen-cn');
  deleteCredential.mockResolvedValue({ providerSlug: 'qwen-cn' });
  deleteDefinition.mockResolvedValue({ deleted: true });
});

describe('DELETE /provider-credentials/:id — custom provider retirement', () => {
  it('retires the custom provider with its last credential when asked', async () => {
    const response = await remove('&retireUnusedCustomProvider=1');
    expect(response.status).toBe(200);
    expect(deleteCredential).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: 'org-a', userId: 'operator' }),
      'cred-1',
    );
    expect(deleteDefinition).toHaveBeenCalledWith(
      expect.anything(),
      {
        organizationId: 'org-a',
        orgSlug: 'north',
        userId: 'operator',
        email: 'operator@example.test',
      },
      'qwen-cn',
      undefined,
    );
  });

  it('leaves the provider alone without the flag, while another credential remains, or when it is shipped', async () => {
    expect((await remove()).status).toBe(200);
    expect(deleteDefinition).not.toHaveBeenCalled();

    remaining.count = 1;
    expect((await remove('&retireUnusedCustomProvider=1')).status).toBe(200);
    expect(deleteDefinition).not.toHaveBeenCalled();

    remaining.count = 0;
    deleteCredential.mockResolvedValue({ providerSlug: 'openai' });
    expect((await remove('&retireUnusedCustomProvider=1')).status).toBe(200);
    expect(deleteDefinition).not.toHaveBeenCalled();
  });

  it('keeps the credential deletion a success when the retirement itself fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    deleteDefinition.mockRejectedValue(new Error('config root read-only'));
    const response = await remove('&retireUnusedCustomProvider=1');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('could not retire the unused custom provider'),
      'config root read-only',
    );
    warn.mockRestore();
  });
});
