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
  saveKnowledgeConnection,
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

function makeCtx(runActionResult: unknown = { ok: true }): {
  runAction: ReturnType<typeof vi.fn>;
} {
  return { runAction: vi.fn().mockResolvedValue(runActionResult) };
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
