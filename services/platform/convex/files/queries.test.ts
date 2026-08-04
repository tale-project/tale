import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return { ...mod, query: (config: Record<string, unknown>) => config };
});

const mockGetAuthUserIdentity = vi.fn();
vi.mock('../lib/rls/auth/get_auth_user_identity', () => ({
  getAuthUserIdentity: (...args: unknown[]) => mockGetAuthUserIdentity(...args),
}));

const { getFileUrl } = await import('./queries');

// oxlint-disable-next-line typescript/no-explicit-any -- vi.mock narrows to { handler }
type Handler = { handler: (ctx: unknown, args: unknown) => Promise<any> };
const handler = (getFileUrl as unknown as Handler).handler;

const CONVEX_ID = 'kg2abc123';
const RAW_STORAGE_URL = `http://127.0.0.1:3210/api/storage/${CONVEX_ID}`;

function createCtx(opts: {
  storageUrl?: string | null;
  fileMetadata?: unknown;
}) {
  return {
    storage: {
      getUrl: vi.fn(async () => opts.storageUrl ?? null),
    },
    db: {
      query: () => ({
        withIndex: () => ({
          first: async () => opts.fileMetadata ?? null,
        }),
      }),
    },
  };
}

beforeEach(() => {
  vi.stubEnv('SITE_URL', 'https://tale.example');
  vi.stubEnv('BASE_PATH', '');
  mockGetAuthUserIdentity.mockResolvedValue({ userId: 'user_1' });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('getFileUrl', () => {
  it('returns the bare proxy-rewritten storage URL without a fileName', async () => {
    const ctx = createCtx({ storageUrl: RAW_STORAGE_URL });

    const url = await handler(ctx, { fileId: CONVEX_ID });

    expect(url).toBe(`https://tale.example/api/storage/${CONVEX_ID}`);
  });

  it('routes through the Content-Disposition endpoint when a fileName is passed', async () => {
    const ctx = createCtx({ storageUrl: RAW_STORAGE_URL });

    const url = await handler(ctx, {
      fileId: CONVEX_ID,
      fileName: '大熊猫介绍.pptx',
    });

    // The `/storage` httpAction serves `filename=` as
    // `Content-Disposition: attachment` — the browser saves the real name
    // instead of the storage uuid.
    expect(url).toBe(
      `https://tale.example/http_api/storage?id=${CONVEX_ID}&filename=${encodeURIComponent('大熊猫介绍.pptx')}`,
    );
  });

  it('still resolves deleted blobs to null on the named path', async () => {
    const ctx = createCtx({ storageUrl: null });

    const url = await handler(ctx, {
      fileId: CONVEX_ID,
      fileName: 'gone.pdf',
    });

    // Callers (e.g. FilePartDisplay) drop dead references on null — a named
    // download URL must never be fabricated for a deleted blob.
    expect(url).toBeNull();
    expect(ctx.storage.getUrl).toHaveBeenCalledWith(CONVEX_ID);
  });

  it('prefers the passed fileName over the fileMetadata name for an s3 ref', async () => {
    const ctx = createCtx({
      fileMetadata: { organizationId: 'org_1', fileName: 'server-name.pdf' },
    });

    const url = await handler(ctx, {
      fileId: 's3:org_1/abc',
      fileName: 'client-name.pdf',
    });

    expect(url).toBe(
      `https://tale.example/http_api/storage?ref=${encodeURIComponent('s3:org_1/abc')}&org=org_1&filename=client-name.pdf`,
    );
  });

  it('falls back to the fileMetadata name for an s3 ref without a fileName', async () => {
    const ctx = createCtx({
      fileMetadata: { organizationId: 'org_1', fileName: 'server-name.pdf' },
    });

    const url = await handler(ctx, { fileId: 's3:org_1/abc' });

    expect(url).toBe(
      `https://tale.example/http_api/storage?ref=${encodeURIComponent('s3:org_1/abc')}&org=org_1&filename=server-name.pdf`,
    );
  });

  it('returns null when unauthenticated', async () => {
    mockGetAuthUserIdentity.mockResolvedValue(null);
    const ctx = createCtx({ storageUrl: RAW_STORAGE_URL });

    const url = await handler(ctx, { fileId: CONVEX_ID, fileName: 'a.pdf' });

    expect(url).toBeNull();
  });
});
