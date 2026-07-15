import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return { ...mod, mutation: (config: Record<string, unknown>) => config };
});

const mockGetAuthUserIdentity = vi.fn();
vi.mock('../lib/rls/auth/get_auth_user_identity', () => ({
  getAuthUserIdentity: (...args: unknown[]) => mockGetAuthUserIdentity(...args),
}));

vi.mock('../lib/helpers/public_storage_url', () => ({
  toPublicUrl: (u: string) => u,
}));

const { deleteRejectedUploadBlob } = await import('./mutations');

// oxlint-disable-next-line typescript/no-explicit-any -- vi.mock narrows to { handler }
type Handler = { handler: (ctx: unknown, args: unknown) => Promise<any> };
const handler = (deleteRejectedUploadBlob as unknown as Handler).handler;

const STORAGE = 'storage_1';

function createCtx(opts: {
  fileMetadata?: unknown;
  blobCreationTime?: number | null;
}) {
  const deleteCalls: string[] = [];
  const ctx = {
    db: {
      query: () => ({
        withIndex: () => ({
          first: async () => opts.fileMetadata ?? null,
        }),
      }),
      system: {
        get: async () =>
          opts.blobCreationTime == null
            ? null
            : { _creationTime: opts.blobCreationTime, size: 10 },
      },
    },
    storage: {
      delete: vi.fn(async (id: string) => {
        deleteCalls.push(id);
      }),
    },
  };
  return { ctx, deleteCalls };
}

describe('deleteRejectedUploadBlob', () => {
  beforeEach(() => {
    mockGetAuthUserIdentity.mockResolvedValue({ userId: 'user_1' });
  });

  it('rejects an unauthenticated caller', async () => {
    mockGetAuthUserIdentity.mockResolvedValue(null);
    const { ctx } = createCtx({ blobCreationTime: Date.now() });
    await expect(handler(ctx, { storageId: STORAGE })).rejects.toThrow(
      /unauthenticated/i,
    );
  });

  it('deletes a recent orphan (no fileMetadata row)', async () => {
    const { ctx, deleteCalls } = createCtx({ blobCreationTime: Date.now() });
    const result = await handler(ctx, { storageId: STORAGE });
    expect(result).toEqual({ deleted: true });
    expect(deleteCalls).toEqual([STORAGE]);
  });

  it('never deletes a blob that became a real file', async () => {
    const { ctx, deleteCalls } = createCtx({
      fileMetadata: { _id: 'fm_1', storageId: STORAGE },
      blobCreationTime: Date.now(),
    });
    const result = await handler(ctx, { storageId: STORAGE });
    expect(result).toEqual({ deleted: false });
    expect(deleteCalls).toEqual([]);
  });

  it('does not delete a blob older than the cleanup window', async () => {
    const { ctx, deleteCalls } = createCtx({
      blobCreationTime: Date.now() - 60 * 60 * 1000, // 1h old
    });
    const result = await handler(ctx, { storageId: STORAGE });
    expect(result).toEqual({ deleted: false });
    expect(deleteCalls).toEqual([]);
  });

  it('no-ops when the blob is already gone', async () => {
    const { ctx, deleteCalls } = createCtx({ blobCreationTime: null });
    const result = await handler(ctx, { storageId: STORAGE });
    expect(result).toEqual({ deleted: false });
    expect(deleteCalls).toEqual([]);
  });
});
