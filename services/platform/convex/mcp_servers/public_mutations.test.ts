import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock-ctx idiom (see tasks/public_actions.test.ts): the generated server
// wrapper returns its config so `.handler` is callable; api/internal refs become
// string sentinels the fake ctx dispatches on; auth + crypto are no-ops.
//
// `convex/values` keeps the real `ConvexError` (the actions throw it and the
// tests assert on its `.data`) while stubbing the `v` validators that only run
// at module-load time.
vi.mock('convex/values', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  const stub = () => 'validator';
  return {
    ...mod,
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
  return { ...mod, action: (config: Record<string, unknown>) => config };
});

vi.mock('../_generated/api', () => ({
  internal: {
    mcp_servers: {
      internal_queries: {
        getById: 'getById',
        getIdByOrgAndName: 'getIdByOrgAndName',
      },
      mutations: {
        insert: 'insert',
        update: 'update',
      },
    },
  },
}));

vi.mock('../lib/crypto/encrypt_string', () => ({
  encryptString: vi.fn(async (value: string) => `encrypted:${value}`),
}));

const getAuthUserIdentity = vi.fn(async () => ({ userId: 'user_1' }));
vi.mock('../lib/rls/auth/get_auth_user_identity', () => ({
  getAuthUserIdentity: (_ctx: unknown) => getAuthUserIdentity(),
}));

type HandlerFn = (
  ctx: unknown,
  args: Record<string, unknown>,
) => Promise<unknown>;

function createCtx(opts: {
  // _id returned by getIdByOrgAndName for the (org, name) lookup.
  duplicateId?: string | null;
  // row returned by getById (update only).
  existing?: { _id: string; organizationId: string } | null;
}) {
  const mutationCalls: Array<{ ref: unknown; args: Record<string, unknown> }> =
    [];
  const ctx = {
    auth: { getUserIdentity: vi.fn() },
    runQuery: vi.fn(async (ref: unknown) => {
      if (ref === 'getIdByOrgAndName') return opts.duplicateId ?? null;
      if (ref === 'getById')
        return opts.existing === undefined ? null : opts.existing;
      return null;
    }),
    runMutation: vi.fn(async (ref: unknown, args: Record<string, unknown>) => {
      mutationCalls.push({ ref, args });
      if (ref === 'insert') return 'server_new';
      return null;
    }),
  };
  return { ctx, mutationCalls };
}

describe('mcp_servers/public_mutations (actions)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthUserIdentity.mockResolvedValue({ userId: 'user_1' });
  });

  describe('create', () => {
    const baseArgs = {
      organizationId: 'org_1',
      displayName: 'My Server',
      transportType: 'streamable_http' as const,
      url: 'https://example.com/mcp',
      authType: 'none' as const,
    };

    async function getCreateHandler() {
      const { create } = await import('./public_mutations');
      return (create as unknown as { handler: HandlerFn }).handler;
    }

    it('rejects an invalid slug before touching the database', async () => {
      const handler = await getCreateHandler();
      const { ctx } = createCtx({ duplicateId: null });
      await expect(
        handler(ctx, { ...baseArgs, name: 'Invalid Name' }),
      ).rejects.toMatchObject({ data: { code: 'invalid' } });
      expect(ctx.runQuery).not.toHaveBeenCalled();
      expect(ctx.runMutation).not.toHaveBeenCalled();
    });

    it('rejects a duplicate (organizationId, name) pair', async () => {
      const handler = await getCreateHandler();
      const { ctx, mutationCalls } = createCtx({ duplicateId: 'server_dup' });
      await expect(
        handler(ctx, { ...baseArgs, name: 'my-server' }),
      ).rejects.toMatchObject({ data: { code: 'conflict' } });
      expect(ctx.runQuery).toHaveBeenCalledWith('getIdByOrgAndName', {
        organizationId: 'org_1',
        name: 'my-server',
      });
      expect(mutationCalls).toHaveLength(0);
    });

    it('trims the name and inserts a unique server', async () => {
      const handler = await getCreateHandler();
      const { ctx, mutationCalls } = createCtx({ duplicateId: null });
      const result = await handler(ctx, { ...baseArgs, name: '  my-server  ' });
      expect(result).toBe('server_new');
      expect(ctx.runQuery).toHaveBeenCalledWith('getIdByOrgAndName', {
        organizationId: 'org_1',
        name: 'my-server',
      });
      expect(mutationCalls).toHaveLength(1);
      expect(mutationCalls[0].ref).toBe('insert');
      expect(mutationCalls[0].args).toMatchObject({
        name: 'my-server',
        status: 'inactive',
      });
    });
  });

  describe('update', () => {
    async function getUpdateHandler() {
      const { update } = await import('./public_mutations');
      return (update as unknown as { handler: HandlerFn }).handler;
    }

    it('rejects an invalid slug on rename', async () => {
      const handler = await getUpdateHandler();
      const { ctx, mutationCalls } = createCtx({
        existing: { _id: 'server_1', organizationId: 'org_1' },
      });
      await expect(
        handler(ctx, { id: 'server_1', name: 'Not A Slug' }),
      ).rejects.toMatchObject({ data: { code: 'invalid' } });
      expect(ctx.runQuery).not.toHaveBeenCalled();
      expect(mutationCalls).toHaveLength(0);
    });

    it('throws not_found when the row is missing', async () => {
      const handler = await getUpdateHandler();
      const { ctx, mutationCalls } = createCtx({ existing: null });
      await expect(
        handler(ctx, { id: 'missing', name: 'new-name' }),
      ).rejects.toMatchObject({ data: { code: 'not_found' } });
      expect(mutationCalls).toHaveLength(0);
    });

    it("allows a no-op rename to the row's own name", async () => {
      const handler = await getUpdateHandler();
      const { ctx, mutationCalls } = createCtx({
        existing: { _id: 'server_1', organizationId: 'org_1' },
        // getIdByOrgAndName resolves to the row being edited.
        duplicateId: 'server_1',
      });
      const result = await handler(ctx, {
        id: 'server_1',
        name: 'my-server',
      });
      expect(result).toBeNull();
      expect(mutationCalls).toHaveLength(1);
      expect(mutationCalls[0].ref).toBe('update');
      expect(mutationCalls[0].args).toMatchObject({
        id: 'server_1',
        name: 'my-server',
      });
    });

    it('rejects a rename colliding with a different server', async () => {
      const handler = await getUpdateHandler();
      const { ctx, mutationCalls } = createCtx({
        existing: { _id: 'server_1', organizationId: 'org_1' },
        // A different server already owns the target name.
        duplicateId: 'server_2',
      });
      await expect(
        handler(ctx, { id: 'server_1', name: 'taken-name' }),
      ).rejects.toMatchObject({ data: { code: 'conflict' } });
      expect(mutationCalls).toHaveLength(0);
    });
  });
});
