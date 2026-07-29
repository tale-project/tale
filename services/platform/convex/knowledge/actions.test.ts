import { ConvexError } from 'convex/values';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `action(config)` returns the config so `.handler` is directly invokable
// (same codegen-surface mock as organizations/actions.test.ts).
vi.mock('../_generated/server', () => ({
  action: vi.fn((config) => config),
}));

vi.mock('../_generated/api', () => ({
  internal: {
    knowledge: {
      file_actions: {
        readConnection: 'readConnection',
        writeConnection: 'writeConnection',
        deleteConnection: 'deleteConnection',
        probeConnection: 'probeConnection',
        readEmbedding: 'readEmbedding',
        writeEmbedding: 'writeEmbedding',
        deleteEmbedding: 'deleteEmbedding',
      },
    },
    provider_credentials: {
      queries: {
        getCredentialInternal: 'getCredentialInternal',
      },
    },
  },
}));

vi.mock('../lib/auth/require_org_membership', () => ({
  requireOrgMembershipById: vi.fn(),
}));

vi.mock('../../lib/permissions/ability', () => ({
  defineAbilityFor: vi.fn(),
}));

import { defineAbilityFor } from '../../lib/permissions/ability';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import {
  deleteKnowledgeConnection,
  deleteKnowledgeEmbedding,
  getKnowledgeConnection,
  getKnowledgeEmbedding,
  saveKnowledgeConnection,
  saveKnowledgeEmbedding,
  testKnowledgeConnection,
} from './actions';

interface ActionLike {
  handler: (ctx: unknown, args: unknown) => Promise<unknown>;
}
function asAction(a: unknown): ActionLike {
  return a as ActionLike;
}

const VALID = {
  organizationId: 'org_123',
  host: 'db.acme.example',
  port: 6432,
  database: 'acme_rag',
  user: 'acme',
  sslmode: 'require' as const,
  password: 'pw',
};

const VALID_EMBEDDING = {
  organizationId: 'org_123',
  providerSlug: 'openai',
  model: 'text-embedding-3-small',
  dimensions: 1536,
};

/** Set the caller's org role + whether it may write org settings. */
function setCaller(role: string, canWrite: boolean): void {
  vi.mocked(requireOrgMembershipById).mockResolvedValue({
    orgId: 'org_123',
    orgSlug: 'acme',
    userId: 'user_1',
    email: 'a@acme.example',
    name: 'A',
    member: { _id: 'm1', role },
  } as unknown as Awaited<ReturnType<typeof requireOrgMembershipById>>);
  vi.mocked(defineAbilityFor).mockReturnValue({
    cannot: () => !canWrite,
  } as unknown as ReturnType<typeof defineAbilityFor>);
}

function makeCtx(
  runActionResult: unknown = { ok: true },
  runQueryResult: unknown = null,
): {
  runAction: ReturnType<typeof vi.fn>;
  runQuery: ReturnType<typeof vi.fn>;
} {
  return {
    runAction: vi.fn().mockResolvedValue(runActionResult),
    runQuery: vi.fn().mockResolvedValue(runQueryResult),
  };
}

/** The `code` of a thrown ConvexError, for exact error-contract assertions. */
async function thrownCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ConvexError) {
      return (err.data as { code: string }).code;
    }
    throw err;
  }
  throw new Error('expected the promise to reject');
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('testKnowledgeConnection (the org connection test)', () => {
  it('rejects a non-admin caller', async () => {
    setCaller('member', false);
    const ctx = makeCtx();
    await expect(
      asAction(testKnowledgeConnection).handler(ctx, VALID),
    ).rejects.toBeInstanceOf(ConvexError);
    expect(ctx.runAction).not.toHaveBeenCalled();
  });

  it('gates an admin, then delegates to the probe with the parsed connection', async () => {
    setCaller('admin', true);
    const ctx = makeCtx({ ok: true, vectorAvailable: true });
    const result = await asAction(testKnowledgeConnection).handler(ctx, VALID);
    expect(ctx.runAction).toHaveBeenCalledWith('probeConnection', {
      host: 'db.acme.example',
      port: 6432,
      database: 'acme_rag',
      user: 'acme',
      sslmode: 'require',
      password: 'pw',
      // Passed so the probe can fall back to the stored secret when the
      // write-only password field is left blank on a re-test after Save.
      orgSlug: 'acme',
    });
    expect(result).toEqual({ ok: true, vectorAvailable: true });
  });

  it('rejects an invalid host before probing (no runAction)', async () => {
    setCaller('admin', true);
    const ctx = makeCtx();
    const result = (await asAction(testKnowledgeConnection).handler(ctx, {
      ...VALID,
      host: 'evil host/../x',
    })) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Invalid knowledge connection/);
    expect(ctx.runAction).not.toHaveBeenCalled();
  });

  it('still passes orgSlug when the password is omitted (stored-secret fallback for Save-then-Test)', async () => {
    setCaller('admin', true);
    const ctx = makeCtx({ ok: true });
    const { password: _password, ...withoutPassword } = VALID;
    await asAction(testKnowledgeConnection).handler(ctx, withoutPassword);
    expect(ctx.runAction).toHaveBeenCalledWith(
      'probeConnection',
      expect.objectContaining({ orgSlug: 'acme', password: undefined }),
    );
  });
});

describe('saveKnowledgeConnection', () => {
  it('rejects a non-admin caller', async () => {
    setCaller('member', false);
    const ctx = makeCtx(null);
    await expect(
      asAction(saveKnowledgeConnection).handler(ctx, VALID),
    ).rejects.toBeInstanceOf(ConvexError);
    expect(ctx.runAction).not.toHaveBeenCalled();
  });

  it('writes the connection under the caller-resolved org slug', async () => {
    setCaller('owner', true);
    const ctx = makeCtx(null);
    await asAction(saveKnowledgeConnection).handler(ctx, VALID);
    expect(ctx.runAction).toHaveBeenCalledWith('writeConnection', {
      orgSlug: 'acme',
      host: 'db.acme.example',
      port: 6432,
      database: 'acme_rag',
      user: 'acme',
      sslmode: 'require',
      password: 'pw',
    });
  });

  it('rejects an invalid connection with a ConvexError', async () => {
    setCaller('admin', true);
    const ctx = makeCtx(null);
    await expect(
      asAction(saveKnowledgeConnection).handler(ctx, {
        ...VALID,
        host: 'bad host',
      }),
    ).rejects.toBeInstanceOf(ConvexError);
    expect(ctx.runAction).not.toHaveBeenCalled();
  });
});

describe('deleteKnowledgeConnection', () => {
  it('reverts to default under the caller-resolved org slug', async () => {
    setCaller('admin', true);
    const ctx = makeCtx(null);
    await asAction(deleteKnowledgeConnection).handler(ctx, {
      organizationId: 'org_123',
    });
    expect(ctx.runAction).toHaveBeenCalledWith('deleteConnection', {
      orgSlug: 'acme',
    });
  });
});

describe('getKnowledgeConnection', () => {
  it('rejects a non-admin caller', async () => {
    setCaller('member', false);
    const ctx = makeCtx();
    await expect(
      asAction(getKnowledgeConnection).handler(ctx, {
        organizationId: 'org_123',
      }),
    ).rejects.toBeInstanceOf(ConvexError);
    expect(ctx.runAction).not.toHaveBeenCalled();
  });

  it('reads under the caller-resolved org slug', async () => {
    setCaller('admin', true);
    const ctx = makeCtx({ configured: false });
    const result = await asAction(getKnowledgeConnection).handler(ctx, {
      organizationId: 'org_123',
    });
    expect(ctx.runAction).toHaveBeenCalledWith('readConnection', {
      orgSlug: 'acme',
    });
    expect(result).toEqual({ configured: false });
  });
});

describe('getKnowledgeEmbedding', () => {
  it('rejects a non-admin caller', async () => {
    setCaller('member', false);
    const ctx = makeCtx();
    await expect(
      asAction(getKnowledgeEmbedding).handler(ctx, {
        organizationId: 'org_123',
      }),
    ).rejects.toBeInstanceOf(ConvexError);
    expect(ctx.runAction).not.toHaveBeenCalled();
  });

  it('reads under the caller-resolved org slug', async () => {
    setCaller('admin', true);
    const ctx = makeCtx({ configured: false });
    const result = await asAction(getKnowledgeEmbedding).handler(ctx, {
      organizationId: 'org_123',
    });
    expect(ctx.runAction).toHaveBeenCalledWith('readEmbedding', {
      orgSlug: 'acme',
    });
    expect(result).toEqual({ configured: false });
  });
});

describe('saveKnowledgeEmbedding', () => {
  it('rejects a non-admin caller', async () => {
    setCaller('member', false);
    const ctx = makeCtx(null);
    await expect(
      asAction(saveKnowledgeEmbedding).handler(ctx, VALID_EMBEDDING),
    ).rejects.toBeInstanceOf(ConvexError);
    expect(ctx.runAction).not.toHaveBeenCalled();
  });

  it('rejects an invalid config (dimensions must be stated within bounds)', async () => {
    setCaller('admin', true);
    const ctx = makeCtx(null);
    expect(
      await thrownCode(
        asAction(saveKnowledgeEmbedding).handler(ctx, {
          ...VALID_EMBEDDING,
          dimensions: 0,
        }),
      ),
    ).toBe('INVALID_EMBEDDING');
    expect(ctx.runAction).not.toHaveBeenCalled();
  });

  it('writes without a credential lookup when no credentialId is named', async () => {
    setCaller('owner', true);
    const ctx = makeCtx(null);
    await asAction(saveKnowledgeEmbedding).handler(ctx, VALID_EMBEDDING);
    expect(ctx.runQuery).not.toHaveBeenCalled();
    expect(ctx.runAction).toHaveBeenCalledWith('writeEmbedding', {
      orgSlug: 'acme',
      providerSlug: 'openai',
      credentialId: undefined,
      model: 'text-embedding-3-small',
      dimensions: 1536,
      baseUrl: undefined,
    });
  });

  it('writes when the named credential matches org and provider', async () => {
    setCaller('admin', true);
    const ctx = makeCtx(null, {
      organizationId: 'org_123',
      providerSlug: 'openai',
    });
    await asAction(saveKnowledgeEmbedding).handler(ctx, {
      ...VALID_EMBEDDING,
      credentialId: 'cred_1',
    });
    expect(ctx.runQuery).toHaveBeenCalledWith('getCredentialInternal', {
      credentialId: 'cred_1',
    });
    expect(ctx.runAction).toHaveBeenCalledWith(
      'writeEmbedding',
      expect.objectContaining({ credentialId: 'cred_1' }),
    );
  });

  it('rejects a missing credential', async () => {
    setCaller('admin', true);
    const ctx = makeCtx(null, null);
    expect(
      await thrownCode(
        asAction(saveKnowledgeEmbedding).handler(ctx, {
          ...VALID_EMBEDDING,
          credentialId: 'cred_gone',
        }),
      ),
    ).toBe('CREDENTIAL_NOT_FOUND');
    expect(ctx.runAction).not.toHaveBeenCalled();
  });

  it("rejects another organization's credential as not-found (no cross-tenant existence leak)", async () => {
    setCaller('admin', true);
    const ctx = makeCtx(null, {
      organizationId: 'org_OTHER',
      providerSlug: 'openai',
    });
    expect(
      await thrownCode(
        asAction(saveKnowledgeEmbedding).handler(ctx, {
          ...VALID_EMBEDDING,
          credentialId: 'cred_foreign',
        }),
      ),
    ).toBe('CREDENTIAL_NOT_FOUND');
    expect(ctx.runAction).not.toHaveBeenCalled();
  });

  it('rejects a credential of a different provider', async () => {
    setCaller('admin', true);
    const ctx = makeCtx(null, {
      organizationId: 'org_123',
      providerSlug: 'mistral',
    });
    expect(
      await thrownCode(
        asAction(saveKnowledgeEmbedding).handler(ctx, {
          ...VALID_EMBEDDING,
          credentialId: 'cred_1',
        }),
      ),
    ).toBe('CREDENTIAL_PROVIDER_MISMATCH');
    expect(ctx.runAction).not.toHaveBeenCalled();
  });

  it('treats a malformed credential id like a miss (validation error is caught)', async () => {
    setCaller('admin', true);
    const ctx = makeCtx(null);
    ctx.runQuery.mockRejectedValue(new Error('ArgumentValidationError'));
    expect(
      await thrownCode(
        asAction(saveKnowledgeEmbedding).handler(ctx, {
          ...VALID_EMBEDDING,
          credentialId: 'not-an-id',
        }),
      ),
    ).toBe('CREDENTIAL_NOT_FOUND');
    expect(ctx.runAction).not.toHaveBeenCalled();
  });

  it('rejects a disabled credential rather than deferring the failure to search time', async () => {
    setCaller('admin', true);
    const ctx = makeCtx(null, {
      organizationId: 'org_123',
      providerSlug: 'openai',
      status: 'disabled',
    });
    expect(
      await thrownCode(
        asAction(saveKnowledgeEmbedding).handler(ctx, {
          ...VALID_EMBEDDING,
          credentialId: 'cred_1',
        }),
      ),
    ).toBe('CREDENTIAL_DISABLED');
    expect(ctx.runAction).not.toHaveBeenCalled();
  });

  it('rethrows a transient lookup failure instead of reporting a phantom missing credential', async () => {
    setCaller('admin', true);
    const ctx = makeCtx(null);
    ctx.runQuery.mockRejectedValue(new Error('backend unavailable'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(
        asAction(saveKnowledgeEmbedding).handler(ctx, {
          ...VALID_EMBEDDING,
          credentialId: 'cred_1',
        }),
      ).rejects.toThrow('backend unavailable');
    } finally {
      warn.mockRestore();
    }
    expect(ctx.runAction).not.toHaveBeenCalled();
  });
});

describe('deleteKnowledgeEmbedding', () => {
  it('removes under the caller-resolved org slug', async () => {
    setCaller('admin', true);
    const ctx = makeCtx(null);
    await asAction(deleteKnowledgeEmbedding).handler(ctx, {
      organizationId: 'org_123',
    });
    expect(ctx.runAction).toHaveBeenCalledWith('deleteEmbedding', {
      orgSlug: 'acme',
    });
  });
});
