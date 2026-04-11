import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/rls', () => ({
  getAuthUserIdentity: vi.fn(),
  getOrganizationMember: vi.fn(),
}));

vi.mock('../../lib/rls/errors', () => {
  class RLSError extends Error {
    constructor(
      message: string,
      public code: string,
    ) {
      super(message);
      this.name = 'RLSError';
    }
  }
  return {
    UnauthorizedError: class extends RLSError {
      constructor() {
        super('Not authorized to access this resource', 'UNAUTHORIZED');
      }
    },
  };
});

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
      any: stub,
    },
  };
});

vi.mock('../../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    query: (config: Record<string, unknown>) => config,
  };
});

const { getAuthUserIdentity, getOrganizationMember } =
  await import('../../lib/rls');
const { UnauthorizedError } = await import('../../lib/rls/errors');

const mockGetAuth = vi.mocked(getAuthUserIdentity);
const mockGetOrgMember = vi.mocked(getOrganizationMember);

function createMockServer(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    _id: 'server_1',
    _creationTime: 1700000000000,
    organizationId: 'org_1',
    name: 'test-server',
    displayName: 'Test Server',
    description: 'A test MCP server',
    transportType: 'streamable_http',
    url: 'https://example.com/mcp',
    authType: 'none',
    status: 'active',
    capabilities: { tools: true },
    discoveredTools: [{ name: 'tool1', description: 'Test tool' }],
    lastConnectedAt: 1700000000000,
    lastError: undefined,
    apiKeyEncrypted: 'encrypted-key',
    oauth2Config: undefined,
    oauth2Tokens: undefined,
    ...overrides,
  };
}

function createMockQueryCtx(servers: Record<string, unknown>[] = []) {
  const indexBuilder = {
    withIndex: vi.fn().mockReturnValue({
      [Symbol.asyncIterator]: () => {
        let index = 0;
        return {
          next: async () => {
            if (index < servers.length) {
              return { value: servers[index++], done: false };
            }
            return { value: undefined, done: true };
          },
        };
      },
    }),
  };

  return {
    db: {
      query: vi.fn().mockReturnValue(indexBuilder),
      get: vi.fn().mockImplementation(async (id: string) => {
        return servers.find((s) => s._id === id) ?? null;
      }),
    },
    auth: {
      getUserIdentity: vi.fn(),
    },
  };
}

type HandlerFn = (
  ctx: never,
  args: Record<string, unknown>,
) => Promise<unknown>;

describe('mcp_servers/queries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('list', () => {
    it('returns empty array when unauthenticated', async () => {
      mockGetAuth.mockResolvedValue(null);
      const ctx = createMockQueryCtx();

      const { list } = await import('../queries');
      const handler = (list as unknown as { handler: HandlerFn }).handler;
      const result = await handler(ctx as never, {
        organizationId: 'org_1',
      });

      expect(result).toEqual([]);
    });

    it('returns empty array when not an org member', async () => {
      mockGetAuth.mockResolvedValue({
        userId: 'user_1',
        email: 'test@test.com',
        name: 'Test',
      } as never);
      mockGetOrgMember.mockRejectedValue(new UnauthorizedError());
      const ctx = createMockQueryCtx();

      const { list } = await import('../queries');
      const handler = (list as unknown as { handler: HandlerFn }).handler;
      const result = await handler(ctx as never, {
        organizationId: 'org_1',
      });

      expect(result).toEqual([]);
    });

    it('returns servers without encrypted fields', async () => {
      mockGetAuth.mockResolvedValue({
        userId: 'user_1',
        email: 'test@test.com',
        name: 'Test',
      } as never);
      mockGetOrgMember.mockResolvedValue({} as never);

      const server = createMockServer();
      const ctx = createMockQueryCtx([server]);

      const { list } = await import('../queries');
      const handler = (list as unknown as { handler: HandlerFn }).handler;
      const result = (await handler(ctx as never, {
        organizationId: 'org_1',
      })) as Record<string, unknown>[];

      expect(result).toHaveLength(1);
      expect(result[0]).not.toHaveProperty('apiKeyEncrypted');
      expect(result[0]).not.toHaveProperty('oauth2Config');
      expect(result[0]).not.toHaveProperty('oauth2Tokens');
      expect(result[0]).toHaveProperty('name', 'test-server');
      expect(result[0]).toHaveProperty('displayName', 'Test Server');
      expect(result[0]).toHaveProperty('status', 'active');
    });
  });

  describe('getById', () => {
    it('returns null when unauthenticated', async () => {
      mockGetAuth.mockResolvedValue(null);
      const ctx = createMockQueryCtx();

      const { getById } = await import('../queries');
      const handler = (getById as unknown as { handler: HandlerFn }).handler;
      const result = await handler(ctx as never, {
        id: 'server_1',
      });

      expect(result).toBeNull();
    });

    it('returns null when server not found', async () => {
      mockGetAuth.mockResolvedValue({
        userId: 'user_1',
        email: 'test@test.com',
        name: 'Test',
      } as never);
      const ctx = createMockQueryCtx([]);

      const { getById } = await import('../queries');
      const handler = (getById as unknown as { handler: HandlerFn }).handler;
      const result = await handler(ctx as never, {
        id: 'nonexistent',
      });

      expect(result).toBeNull();
    });

    it('returns server without encrypted fields', async () => {
      mockGetAuth.mockResolvedValue({
        userId: 'user_1',
        email: 'test@test.com',
        name: 'Test',
      } as never);
      mockGetOrgMember.mockResolvedValue({} as never);

      const server = createMockServer();
      const ctx = createMockQueryCtx([server]);

      const { getById } = await import('../queries');
      const handler = (getById as unknown as { handler: HandlerFn }).handler;
      const result = await handler(ctx as never, {
        id: 'server_1',
      });

      expect(result).not.toBeNull();
      expect(result).not.toHaveProperty('apiKeyEncrypted');
      expect(result).toHaveProperty('displayName', 'Test Server');
    });
  });
});
