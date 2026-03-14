import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../_generated/api', () => ({
  components: {
    betterAuth: {
      adapter: {
        findMany: 'betterAuth:adapter:findMany',
        updateMany: 'betterAuth:adapter:updateMany',
      },
    },
  },
}));

const mockGetAuthUser = vi.fn();
vi.mock('../../auth', () => ({
  authComponent: {
    getAuthUser: (...args: unknown[]) => mockGetAuthUser(...args),
  },
}));

vi.mock('convex/values', () => {
  const stub = () => 'validator';
  return {
    v: {
      string: stub,
      number: stub,
      boolean: stub,
      optional: stub,
      union: stub,
      object: stub,
      literal: stub,
      array: stub,
      null: stub,
      id: stub,
    },
  };
});

vi.mock('../../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    mutation: (config: Record<string, unknown>) => config,
  };
});

function createMockCtx() {
  return {
    runQuery: vi.fn(),
    runMutation: vi.fn(),
    db: {},
    auth: {},
  };
}

const AUTH_USER = {
  _id: 'user_1',
  email: 'user@example.com',
  name: 'Old Name',
};

describe('updateUserName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function getHandler() {
    const { updateUserName } = await import('../mutations');
    return (updateUserName as unknown as { handler: Function }).handler;
  }

  it('throws when unauthenticated', async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const ctx = createMockCtx();
    const handler = await getHandler();

    await expect(handler(ctx, { name: 'New Name' })).rejects.toThrow(
      'Unauthenticated',
    );
  });

  it('throws when name is empty', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    const handler = await getHandler();

    await expect(handler(ctx, { name: '   ' })).rejects.toThrow(
      'Name is required',
    );
  });

  it('throws when name exceeds 100 characters', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    const handler = await getHandler();

    await expect(handler(ctx, { name: 'a'.repeat(101) })).rejects.toThrow(
      'Name must be 100 characters or less',
    );
  });

  it('throws when user not found', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    ctx.runQuery.mockResolvedValueOnce({ page: [] });
    const handler = await getHandler();

    await expect(handler(ctx, { name: 'New Name' })).rejects.toThrow(
      'User not found',
    );
  });

  it('updates the user name successfully', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    // findMany for user lookup
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'user_1', name: 'Old Name', email: 'user@example.com' }],
    });
    // updateMany for name
    ctx.runMutation.mockResolvedValueOnce(undefined);
    const handler = await getHandler();

    const result = await handler(ctx, { name: 'New Name' });

    expect(result).toBeNull();
    expect(ctx.runMutation).toHaveBeenCalledWith(
      'betterAuth:adapter:updateMany',
      expect.objectContaining({
        input: expect.objectContaining({
          model: 'user',
          where: [{ field: '_id', value: 'user_1', operator: 'eq' }],
          update: expect.objectContaining({
            name: 'New Name',
          }),
        }),
      }),
    );
  });

  it('trims whitespace from name', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const ctx = createMockCtx();
    ctx.runQuery.mockResolvedValueOnce({
      page: [{ _id: 'user_1', name: 'Old Name', email: 'user@example.com' }],
    });
    ctx.runMutation.mockResolvedValueOnce(undefined);
    const handler = await getHandler();

    await handler(ctx, { name: '  Trimmed Name  ' });

    expect(ctx.runMutation).toHaveBeenCalledWith(
      'betterAuth:adapter:updateMany',
      expect.objectContaining({
        input: expect.objectContaining({
          update: expect.objectContaining({
            name: 'Trimmed Name',
          }),
        }),
      }),
    );
  });
});
