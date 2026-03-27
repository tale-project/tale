import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('convex/values', () => {
  const stub = () => 'validator';
  return {
    v: {
      string: stub,
      number: stub,
      boolean: stub,
      optional: stub,
      id: stub,
      object: stub,
      union: stub,
      literal: stub,
      array: stub,
      null: stub,
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

const mockGetAuthUser = vi.fn();
vi.mock('../../auth', () => ({
  authComponent: {
    getAuthUser: (...args: unknown[]) => mockGetAuthUser(...args),
  },
}));

function createMockCtx(existingDoc: Record<string, unknown> | null = null) {
  const builder = {
    withIndex: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(existingDoc),
  };

  const ctx = {
    db: {
      query: vi.fn().mockReturnValue(builder),
      insert: vi.fn().mockResolvedValue('fm_new'),
      patch: vi.fn().mockResolvedValue(undefined),
    },
  };

  return { ctx, builder };
}

async function getHandler() {
  const { saveFileMetadata } = await import('../mutations');
  return (saveFileMetadata as unknown as { handler: Function }).handler;
}

const baseArgs = {
  organizationId: 'org_1',
  storageId: 'storage_1',
  fileName: 'test.pdf',
  contentType: 'application/pdf',
  size: 1024,
};

const AUTH_USER = {
  _id: 'user_1',
  email: 'test@example.com',
  name: 'Test User',
};

describe('saveFileMetadata (public)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unauthenticated requests', async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const { ctx } = createMockCtx();
    const handler = await getHandler();

    await expect(handler(ctx, baseArgs)).rejects.toThrow('Unauthenticated');
  });

  it('inserts new file metadata when none exists', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const { ctx } = createMockCtx(null);
    const handler = await getHandler();

    const result = await handler(ctx, baseArgs);

    expect(result).toBe('fm_new');
    expect(ctx.db.insert).toHaveBeenCalledWith('fileMetadata', {
      organizationId: 'org_1',
      storageId: 'storage_1',
      fileName: 'test.pdf',
      contentType: 'application/pdf',
      size: 1024,
    });
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it('patches existing file metadata by storageId', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const existing = {
      _id: 'fm_existing',
      organizationId: 'org_1',
      storageId: 'storage_1',
      fileName: 'old.pdf',
      contentType: 'application/pdf',
      size: 512,
    };
    const { ctx } = createMockCtx(existing);
    const handler = await getHandler();

    const result = await handler(ctx, {
      ...baseArgs,
      fileName: 'new.pdf',
      size: 2048,
    });

    expect(result).toBe('fm_existing');
    expect(ctx.db.patch).toHaveBeenCalledWith('fm_existing', {
      fileName: 'new.pdf',
      contentType: 'application/pdf',
      size: 2048,
    });
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it('queries by storageId index', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const { ctx, builder } = createMockCtx(null);
    const handler = await getHandler();

    await handler(ctx, baseArgs);

    expect(ctx.db.query).toHaveBeenCalledWith('fileMetadata');
    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_storageId',
      expect.any(Function),
    );
  });

  it('includes documentId on insert when provided', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const { ctx } = createMockCtx(null);
    const handler = await getHandler();

    await handler(ctx, { ...baseArgs, documentId: 'doc_1' });

    expect(ctx.db.insert).toHaveBeenCalledWith('fileMetadata', {
      organizationId: 'org_1',
      storageId: 'storage_1',
      fileName: 'test.pdf',
      contentType: 'application/pdf',
      size: 1024,
      documentId: 'doc_1',
    });
  });

  it('does not clear existing documentId when not provided', async () => {
    mockGetAuthUser.mockResolvedValue(AUTH_USER);
    const existing = {
      _id: 'fm_existing',
      organizationId: 'org_1',
      storageId: 'storage_1',
      documentId: 'doc_existing',
      fileName: 'old.pdf',
      contentType: 'application/pdf',
      size: 512,
    };
    const { ctx } = createMockCtx(existing);
    const handler = await getHandler();

    await handler(ctx, baseArgs);

    expect(ctx.db.patch).toHaveBeenCalledWith('fm_existing', {
      fileName: 'test.pdf',
      contentType: 'application/pdf',
      size: 1024,
    });
  });
});
