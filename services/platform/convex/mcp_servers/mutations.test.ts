import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('convex/values', () => {
  const stub = () => 'validator';
  return {
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
    internalMutation: (config: Record<string, unknown>) => config,
  };
});

type HandlerFn = (
  ctx: never,
  args: Record<string, unknown>,
) => Promise<unknown>;

describe('mcp_servers/mutations (internal)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('insert', () => {
    it('inserts a new MCP server record', async () => {
      const ctx = {
        db: {
          insert: vi.fn().mockResolvedValue('server_new'),
        },
      };

      const { insert } = await import('./mutations');
      const handler = (insert as unknown as { handler: HandlerFn }).handler;
      const result = await handler(ctx as never, {
        organizationId: 'org_1',
        name: 'test-server',
        displayName: 'Test Server',
        description: 'A test server',
        transportType: 'streamable_http',
        url: 'https://example.com/mcp',
        authType: 'none',
        status: 'inactive',
      });

      expect(ctx.db.insert).toHaveBeenCalledWith('mcpServers', {
        organizationId: 'org_1',
        name: 'test-server',
        displayName: 'Test Server',
        description: 'A test server',
        transportType: 'streamable_http',
        url: 'https://example.com/mcp',
        authType: 'none',
        status: 'inactive',
      });
      expect(result).toBe('server_new');
    });

    it('inserts with encrypted API key', async () => {
      const ctx = {
        db: {
          insert: vi.fn().mockResolvedValue('server_new'),
        },
      };

      const { insert } = await import('./mutations');
      const handler = (insert as unknown as { handler: HandlerFn }).handler;
      await handler(ctx as never, {
        organizationId: 'org_1',
        name: 'api-key-server',
        displayName: 'API Key Server',
        transportType: 'sse',
        url: 'https://example.com/sse',
        authType: 'api_key',
        apiKeyEncrypted: 'encrypted-key-value',
        status: 'inactive',
      });

      expect(ctx.db.insert).toHaveBeenCalledWith(
        'mcpServers',
        expect.objectContaining({
          authType: 'api_key',
          apiKeyEncrypted: 'encrypted-key-value',
        }),
      );
    });
  });

  describe('update', () => {
    it('patches an existing server', async () => {
      const ctx = {
        db: {
          get: vi.fn().mockResolvedValue({ _id: 'server_1', name: 'old' }),
          patch: vi.fn().mockResolvedValue(undefined),
        },
      };

      const { update } = await import('./mutations');
      const handler = (update as unknown as { handler: HandlerFn }).handler;
      const result = await handler(ctx as never, {
        id: 'server_1',
        displayName: 'Updated Server',
      });

      expect(ctx.db.patch).toHaveBeenCalledWith('server_1', {
        displayName: 'Updated Server',
      });
      expect(result).toBeNull();
    });

    it('throws when server not found', async () => {
      const ctx = {
        db: {
          get: vi.fn().mockResolvedValue(null),
          patch: vi.fn(),
        },
      };

      const { update } = await import('./mutations');
      const handler = (update as unknown as { handler: HandlerFn }).handler;
      await expect(
        handler(ctx as never, {
          id: 'nonexistent',
          displayName: 'Updated',
        }),
      ).rejects.toThrow('MCP server not found');
    });
  });

  describe('remove', () => {
    it('deletes an existing server', async () => {
      const ctx = {
        db: {
          get: vi.fn().mockResolvedValue({ _id: 'server_1' }),
          delete: vi.fn().mockResolvedValue(undefined),
        },
      };

      const { remove } = await import('./mutations');
      const handler = (remove as unknown as { handler: HandlerFn }).handler;
      const result = await handler(ctx as never, {
        id: 'server_1',
      });

      expect(ctx.db.delete).toHaveBeenCalledWith('server_1');
      expect(result).toBeNull();
    });

    it('throws when server not found', async () => {
      const ctx = {
        db: {
          get: vi.fn().mockResolvedValue(null),
          delete: vi.fn(),
        },
      };

      const { remove } = await import('./mutations');
      const handler = (remove as unknown as { handler: HandlerFn }).handler;
      await expect(
        handler(ctx as never, {
          id: 'nonexistent',
        }),
      ).rejects.toThrow('MCP server not found');
    });
  });

  describe('setStatus', () => {
    it('updates status to active', async () => {
      const ctx = {
        db: {
          get: vi
            .fn()
            .mockResolvedValue({ _id: 'server_1', status: 'inactive' }),
          patch: vi.fn().mockResolvedValue(undefined),
        },
      };

      const { setStatus } = await import('./mutations');
      const handler = (setStatus as unknown as { handler: HandlerFn }).handler;
      const result = await handler(ctx as never, {
        id: 'server_1',
        status: 'active',
      });

      expect(ctx.db.patch).toHaveBeenCalledWith('server_1', {
        status: 'active',
      });
      expect(result).toBeNull();
    });

    it('throws when server not found', async () => {
      const ctx = {
        db: {
          get: vi.fn().mockResolvedValue(null),
          patch: vi.fn(),
        },
      };

      const { setStatus } = await import('./mutations');
      const handler = (setStatus as unknown as { handler: HandlerFn }).handler;
      await expect(
        handler(ctx as never, {
          id: 'nonexistent',
          status: 'active',
        }),
      ).rejects.toThrow('MCP server not found');
    });
  });
});
