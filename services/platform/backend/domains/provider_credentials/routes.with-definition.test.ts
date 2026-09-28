// @vitest-environment node
import type { Context } from 'hono';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org';
import { ConfigurationError } from '../../core/lib/config_store/precondition';
import { createProviderCredentialRoutes } from './routes';
import { CredentialAdminError } from './service';

/**
 * The edit dialog's door for a custom provider's credential: one strict
 * body — the credential's non-secret fields, its hash, and the provider's
 * definition with the hash its facts were read at — handed whole to the one
 * write, whose refusals come back as coded JSON with their status.
 */

const { updateCredentialWithDefinition, requeue } = vi.hoisted(() => ({
  updateCredentialWithDefinition: vi.fn(),
  requeue: vi.fn(),
}));

vi.mock('./custom-provider-edit', () => ({ updateCredentialWithDefinition }));
vi.mock('../knowledge/service', async (original) => ({
  ...(await original<typeof import('../knowledge/service')>()),
  requeueEmbeddingBlockedDocuments: requeue,
}));
vi.mock('./service', async (original) => ({
  ...(await original<typeof import('./service')>()),
  credentialDependents: vi.fn(async () => ({ usedBy: ['embedding'] })),
}));
vi.mock('../../lib/org-config', async (original) => ({
  ...(await original<typeof import('../../lib/org-config')>()),
  resolveOrgSlug: vi.fn(async () => 'north'),
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

const sql = (async () => []) as unknown as Sql;
const definitionHash = 'd'.repeat(64);
const credentialHash = 'c'.repeat(64);
const config = {
  name: 'gateway',
  displayName: 'Gateway A2',
  apiFormat: 'openai',
  baseUrl: 'https://models-v2.gateway.invalid/v1',
  catalog: { source: 'none' },
  auth: [{ method: 'api-key' }, { method: 'env' }],
};
const body = {
  name: 'Gateway A2',
  modelAllowlist: ['gateway-model'],
  expectedHash: credentialHash,
  definition: { config, expectedHash: definitionHash },
};

const post = (raw: string) =>
  createProviderCredentialRoutes({ sql, auth: {} as never }).request(
    '/cred-a/with-definition?orgId=org-a',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: raw,
    },
  );

beforeEach(() => {
  vi.clearAllMocks();
  updateCredentialWithDefinition.mockResolvedValue(undefined);
  requeue.mockResolvedValue({ requeued: 0 });
});

describe('POST /provider-credentials/:id/with-definition', () => {
  it('hands the fields and both reviewed versions to the one write', async () => {
    const response = await post(JSON.stringify(body));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(updateCredentialWithDefinition).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({
        organizationId: 'org-a',
        userId: 'operator',
        role: 'admin',
      }),
      'north',
      'cred-a',
      { name: 'Gateway A2', modelAllowlist: ['gateway-model'] },
      credentialHash,
      { config, expectedHash: definitionHash },
    );
    // No field the credential resolver reads changed.
    expect(requeue).not.toHaveBeenCalled();
  });

  it('re-queues what failed on the embedding model when the endpoint changes', async () => {
    const response = await post(
      JSON.stringify({ ...body, endpointUrl: 'https://gateway.invalid/v1' }),
    );
    expect(response.status).toBe(200);
    expect(requeue).toHaveBeenCalledWith(sql, { organizationId: 'org-a' });
  });

  it('refuses an unknown field, a missing version and a repeated key before any write', async () => {
    const refused = [
      JSON.stringify({ ...body, status: 'disabled' }),
      JSON.stringify({ ...body, expectedHash: undefined }),
      JSON.stringify({
        ...body,
        definition: { config, expectedHash: null },
      }),
      JSON.stringify(body).replace(
        '"name":"Gateway A2",',
        '"name":"Gateway A2","name":"Gateway B",',
      ),
      'not json',
    ];
    for (const raw of refused) {
      expect((await post(raw)).status).toBe(400);
    }
    expect(updateCredentialWithDefinition).not.toHaveBeenCalled();
  });

  it('answers the refusals of the write as coded JSON', async () => {
    updateCredentialWithDefinition.mockRejectedValueOnce(
      new CredentialAdminError(
        'CREDENTIAL_NAME_TAKEN',
        'A credential named "Gateway B" already exists for this provider — pick a different name.',
        409,
      ),
    );
    const taken = await post(JSON.stringify(body));
    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({
      error: 'CREDENTIAL_NAME_TAKEN',
      message:
        'A credential named "Gateway B" already exists for this provider — pick a different name.',
    });

    updateCredentialWithDefinition.mockRejectedValueOnce(
      new ConfigurationError(
        'CONFIG_VERSION_CONFLICT',
        'Configuration changed since it was reviewed. Read the current value and plan again.',
      ),
    );
    const stale = await post(JSON.stringify(body));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      error: 'CONFIG_VERSION_CONFLICT',
    });
  });
});
