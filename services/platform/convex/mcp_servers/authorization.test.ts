/**
 * Regression tests for the cross-tenant authorization gates added to the
 * public MCP-server actions/mutations (issue #2040).
 *
 * Before the fix, `create`/`update`/`remove`/`updateStatus` (public_mutations)
 * and `testConnection` (actions) checked only that the caller was
 * authenticated — any member of any org could create servers in, or
 * read/tamper with, another tenant's servers (and `executeMcpTool` was a
 * public action with no auth at all). Each public surface must now resolve the
 * owning org and enforce `requireOrgAdminOrDeveloper`, and `executeMcpTool`
 * must no longer be a public `api.*` action.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('convex/values', () => {
  const stub = () => 'validator';
  class ConvexError extends Error {
    data: unknown;
    constructor(data: unknown) {
      super(typeof data === 'string' ? data : JSON.stringify(data));
      this.name = 'ConvexError';
      this.data = data;
    }
  }
  return {
    ConvexError,
    v: {
      string: stub,
      optional: stub,
      union: stub,
      object: stub,
      literal: stub,
      array: stub,
      boolean: stub,
      number: stub,
      id: stub,
      null: stub,
      any: stub,
    },
  };
});

vi.mock('../lib/validators/json', () => ({
  jsonRecordValidator: 'jsonRecordValidator',
}));

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    action: (config: Record<string, unknown>) => config,
    internalAction: (config: Record<string, unknown>) => ({
      ...config,
      isInternalAction: true,
    }),
  };
});

vi.mock('../_generated/api', () => ({
  api: {},
  internal: {
    mcp_servers: {
      internal_queries: { getById: 'internal_queries.getById' },
      mutations: {
        insert: 'mutations.insert',
        update: 'mutations.update',
        remove: 'mutations.remove',
        setStatus: 'mutations.setStatus',
      },
    },
  },
}));

vi.mock('../lib/crypto/encrypt_string', () => ({
  encryptString: vi.fn(async (s: string) => `enc:${s}`),
}));

// Avoid pulling in the MCP SDK / node client factory in unit tests.
vi.mock('./client_factory', () => ({
  discoverTools: vi.fn(),
  executeTool: vi.fn(),
}));

const requireOrgAdminOrDeveloper = vi.fn();
vi.mock('../lib/auth/require_org_admin_or_developer', () => ({
  requireOrgAdminOrDeveloper: (...args: unknown[]) =>
    requireOrgAdminOrDeveloper(...args),
}));

type HandlerFn = (
  ctx: unknown,
  args: Record<string, unknown>,
) => Promise<unknown>;

const FORBIDDEN = new Error('FORBIDDEN_DEVELOPER_SETTINGS');

beforeEach(() => {
  vi.clearAllMocks();
  requireOrgAdminOrDeveloper.mockResolvedValue({ member: { role: 'admin' } });
});

describe('public_mutations authorization (#2040)', () => {
  describe('create', () => {
    it('enforces admin/developer on the supplied organizationId before inserting', async () => {
      // `runQuery` resolves the duplicate-name lookup (getIdByOrgAndName) to
      // null so the happy path reaches the insert.
      const ctx = {
        runQuery: vi.fn().mockResolvedValue(null),
        runMutation: vi.fn(),
      };
      const { create } = await import('./public_mutations');
      const handler = (create as unknown as { handler: HandlerFn }).handler;

      await handler(ctx, {
        organizationId: 'org_1',
        name: 'srv',
        displayName: 'Srv',
        transportType: 'streamable_http',
        url: 'https://example.com/mcp',
        authType: 'none',
      });

      expect(requireOrgAdminOrDeveloper).toHaveBeenCalledWith(ctx, 'org_1');
      expect(ctx.runMutation).toHaveBeenCalledWith(
        'mutations.insert',
        expect.objectContaining({ organizationId: 'org_1' }),
      );
    });

    it('does not insert when the caller is not authorized for the org', async () => {
      requireOrgAdminOrDeveloper.mockRejectedValueOnce(FORBIDDEN);
      const ctx = { runQuery: vi.fn(), runMutation: vi.fn() };
      const { create } = await import('./public_mutations');
      const handler = (create as unknown as { handler: HandlerFn }).handler;

      await expect(
        handler(ctx, {
          organizationId: 'org_other',
          name: 'srv',
          displayName: 'Srv',
          transportType: 'streamable_http',
          authType: 'none',
        }),
      ).rejects.toThrow('FORBIDDEN_DEVELOPER_SETTINGS');
      expect(ctx.runMutation).not.toHaveBeenCalled();
    });
  });

  describe.each([
    ['update', { id: 'server_1', displayName: 'x' }, 'mutations.update'],
    ['remove', { id: 'server_1' }, 'mutations.remove'],
    [
      'updateStatus',
      { id: 'server_1', status: 'active' },
      'mutations.setStatus',
    ],
  ])('%s', (name, args, mutationRef) => {
    it('resolves the owning org from the stored doc and gates on it', async () => {
      const ctx = {
        runQuery: vi
          .fn()
          .mockResolvedValue({ _id: 'server_1', organizationId: 'org_owner' }),
        runMutation: vi.fn().mockResolvedValue(null),
      };
      const mod = await import('./public_mutations');
      const handler = (
        mod as unknown as Record<string, { handler: HandlerFn }>
      )[name].handler;

      await handler(ctx, args);

      expect(ctx.runQuery).toHaveBeenCalledWith('internal_queries.getById', {
        id: 'server_1',
      });
      expect(requireOrgAdminOrDeveloper).toHaveBeenCalledWith(ctx, 'org_owner');
      expect(ctx.runMutation).toHaveBeenCalledWith(
        mutationRef,
        expect.objectContaining({ id: 'server_1' }),
      );
    });

    it('throws when the server does not exist (no mutation)', async () => {
      const ctx = {
        runQuery: vi.fn().mockResolvedValue(null),
        runMutation: vi.fn(),
      };
      const mod = await import('./public_mutations');
      const handler = (
        mod as unknown as Record<string, { handler: HandlerFn }>
      )[name].handler;

      await expect(handler(ctx, args)).rejects.toMatchObject({
        data: { code: 'not_found' },
      });
      expect(requireOrgAdminOrDeveloper).not.toHaveBeenCalled();
      expect(ctx.runMutation).not.toHaveBeenCalled();
    });

    it('does not mutate when the caller is not authorized for the owning org', async () => {
      requireOrgAdminOrDeveloper.mockRejectedValueOnce(FORBIDDEN);
      const ctx = {
        runQuery: vi
          .fn()
          .mockResolvedValue({ _id: 'server_1', organizationId: 'org_owner' }),
        runMutation: vi.fn(),
      };
      const mod = await import('./public_mutations');
      const handler = (
        mod as unknown as Record<string, { handler: HandlerFn }>
      )[name].handler;

      await expect(handler(ctx, args)).rejects.toThrow(
        'FORBIDDEN_DEVELOPER_SETTINGS',
      );
      expect(ctx.runMutation).not.toHaveBeenCalled();
    });
  });
});

describe('actions authorization (#2040)', () => {
  it('testConnection gates on the owning org before running discovery', async () => {
    requireOrgAdminOrDeveloper.mockRejectedValueOnce(FORBIDDEN);
    const ctx = {
      runQuery: vi
        .fn()
        .mockResolvedValue({ _id: 'server_1', organizationId: 'org_owner' }),
      runMutation: vi.fn(),
    };
    const { testConnection } = await import('./actions');
    const handler = (testConnection as unknown as { handler: HandlerFn })
      .handler;

    await expect(handler(ctx, { id: 'server_1' })).rejects.toThrow(
      'FORBIDDEN_DEVELOPER_SETTINGS',
    );
    // Status was never flipped to "discovering" and no discovery ran.
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it('executeMcpTool is an internalAction, not a public api.* action', async () => {
    const { executeMcpTool } = await import('./actions');
    expect(
      (executeMcpTool as unknown as { isInternalAction?: boolean })
        .isInternalAction,
    ).toBe(true);
  });
});
