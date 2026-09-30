// @vitest-environment node
import type { Context } from 'hono';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org';
import { createProviderCredentialRoutes } from './routes';
import { CredentialAdminError } from './service';

/**
 * A document that failed because the embedding model's credential did not
 * resolve says an admin must add or fix the credential. Following that on
 * this door re-queued nothing: every document stayed `failed` until someone
 * saved the embedding settings or retried each one by hand. The door now
 * re-queues them after a save that can lift the refusal — a create, or an
 * edit of what the resolver reads — of the credential the embedding model
 * resolves, and of no other.
 */

const {
  createCredential,
  updateCredential,
  credentialDependents,
  requeueEmbeddingBlockedDocuments,
  websitesAfterEmbeddingChange,
} = vi.hoisted(() => ({
  createCredential: vi.fn(),
  updateCredential: vi.fn(),
  credentialDependents: vi.fn(),
  requeueEmbeddingBlockedDocuments: vi.fn(),
  websitesAfterEmbeddingChange: vi.fn(),
}));

vi.mock('@tale/shared/db/serializable', () => ({
  transactSerializable: async (
    sql: unknown,
    work: (tx: unknown) => Promise<unknown>,
  ) => work(sql),
}));
vi.mock('./service', async (original) => ({
  ...(await original<typeof import('./service')>()),
  createCredential,
  updateCredential,
  credentialDependents,
}));
vi.mock('../knowledge/service.ts', () => ({
  requeueEmbeddingBlockedDocuments,
}));
vi.mock('../websites/service.ts', () => ({ websitesAfterEmbeddingChange }));
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

const post = (path: string, body: Record<string, unknown>) =>
  app().request(`${path}?orgId=org-a`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const NEW_KEY = {
  providerSlug: 'itest-vendor',
  authMethod: 'api-key',
  name: 'Embedding key',
  secret: 'synthetic-secret',
};

beforeEach(() => {
  vi.clearAllMocks();
  createCredential.mockResolvedValue('cred-new');
  updateCredential.mockResolvedValue(undefined);
  credentialDependents.mockResolvedValue({ usedBy: ['embedding'] });
  requeueEmbeddingBlockedDocuments.mockResolvedValue({ requeued: 2 });
  websitesAfterEmbeddingChange.mockResolvedValue({ queued: 1 });
});

describe('the credential door re-queues what the embedding model failed on', () => {
  it('re-queues after creating the credential the embedding model resolves', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const response = await post('/', NEW_KEY);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ credentialId: 'cred-new' });
    expect(credentialDependents).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: 'org-a' }),
      'cred-new',
    );
    expect(requeueEmbeddingBlockedDocuments).toHaveBeenCalledWith(
      expect.anything(),
      { organizationId: 'org-a' },
    );
  });

  // A website scan that ended on "the embedding model couldn't process the
  // pages" names this credential too; repairing it used to leave the site
  // in Error until someone chose Scan now.
  it('lets the websites follow as they follow a saved model', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    await post('/cred-1', { secret: 'synthetic-rotated-secret' });

    expect(websitesAfterEmbeddingChange).toHaveBeenCalledWith(
      expect.anything(),
      'org-a',
      'saved',
    );
  });

  it('leaves the documents and the websites alone for a credential the embedding model does not use', async () => {
    credentialDependents.mockResolvedValue({ usedBy: [] });
    const response = await post('/', NEW_KEY);

    expect(response.status).toBe(200);
    expect(requeueEmbeddingBlockedDocuments).not.toHaveBeenCalled();
    expect(websitesAfterEmbeddingChange).not.toHaveBeenCalled();
  });

  it.each([
    { status: 'active' },
    { isDefault: true },
    { secret: 'synthetic-rotated-secret' },
    { envName: 'TALE_PROVIDER_KEY_ITEST' },
    { endpointUrl: 'https://vendor.example/v1' },
  ])('re-queues after the repair %j', async (patch) => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const response = await post('/cred-1', patch);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(credentialDependents).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: 'org-a' }),
      'cred-1',
    );
    expect(requeueEmbeddingBlockedDocuments).toHaveBeenCalledOnce();
  });

  it.each([{ name: 'Renamed' }, { modelAllowlist: ['embed-small'] }])(
    'leaves the documents alone after %j, which resolves nothing new',
    async (patch) => {
      const response = await post('/cred-1', patch);

      expect(response.status).toBe(200);
      expect(credentialDependents).not.toHaveBeenCalled();
      expect(requeueEmbeddingBlockedDocuments).not.toHaveBeenCalled();
    },
  );

  it('re-queues nothing when the save itself is refused', async () => {
    createCredential.mockRejectedValue(
      new CredentialAdminError(
        'CREDENTIAL_NAME_TAKEN',
        'A credential named "Embedding key" already exists for this provider.',
        409,
      ),
    );
    const response = await post('/', NEW_KEY);

    expect(response.status).toBe(409);
    expect(requeueEmbeddingBlockedDocuments).not.toHaveBeenCalled();
  });

  it('keeps the saved credential when the re-queue fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    requeueEmbeddingBlockedDocuments.mockRejectedValue(
      new Error('connection reset'),
    );
    const response = await post('/', NEW_KEY);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ credentialId: 'cred-new' });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('could not re-queue'),
      'connection reset',
    );
    // The documents' trouble is not the websites'.
    expect(websitesAfterEmbeddingChange).toHaveBeenCalledOnce();
  });

  it('keeps the saved credential when the websites cannot follow', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    websitesAfterEmbeddingChange.mockRejectedValue(new Error('pool closed'));
    const response = await post('/', NEW_KEY);

    expect(response.status).toBe(200);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('websites could not follow'),
      'pool closed',
    );
  });
});
