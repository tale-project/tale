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
    internalMutation: (config: Record<string, unknown>) => config,
  };
});

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

async function getSaveHandler() {
  const { saveFileMetadata } = await import('../internal_mutations');
  return (saveFileMetadata as unknown as { handler: Function }).handler;
}

async function getLinkHandler() {
  const { linkDocumentToFile } = await import('../internal_mutations');
  return (linkDocumentToFile as unknown as { handler: Function }).handler;
}

const baseArgs = {
  organizationId: 'org_1',
  storageId: 'storage_1',
  fileName: 'test.pdf',
  contentType: 'application/pdf',
  size: 1024,
};

describe('saveFileMetadata (internal)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts new file metadata when none exists', async () => {
    const { ctx } = createMockCtx(null);
    const handler = await getSaveHandler();

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
    const existing = {
      _id: 'fm_existing',
      organizationId: 'org_1',
      storageId: 'storage_1',
      fileName: 'old.pdf',
      contentType: 'application/pdf',
      size: 512,
    };
    const { ctx } = createMockCtx(existing);
    const handler = await getSaveHandler();

    const result = await handler(ctx, {
      ...baseArgs,
      fileName: 'updated.pdf',
      size: 2048,
    });

    expect(result).toBe('fm_existing');
    expect(ctx.db.patch).toHaveBeenCalledWith('fm_existing', {
      fileName: 'updated.pdf',
      contentType: 'application/pdf',
      size: 2048,
    });
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it('queries by storageId index', async () => {
    const { ctx, builder } = createMockCtx(null);
    const handler = await getSaveHandler();

    await handler(ctx, baseArgs);

    expect(ctx.db.query).toHaveBeenCalledWith('fileMetadata');
    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_storageId',
      expect.any(Function),
    );
  });

  it('includes documentId on insert when provided', async () => {
    const { ctx } = createMockCtx(null);
    const handler = await getSaveHandler();

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

  it('includes documentId on patch when provided', async () => {
    const existing = {
      _id: 'fm_existing',
      organizationId: 'org_1',
      storageId: 'storage_1',
      fileName: 'old.pdf',
      contentType: 'application/pdf',
      size: 512,
    };
    const { ctx } = createMockCtx(existing);
    const handler = await getSaveHandler();

    await handler(ctx, { ...baseArgs, documentId: 'doc_1' });

    expect(ctx.db.patch).toHaveBeenCalledWith('fm_existing', {
      fileName: 'test.pdf',
      contentType: 'application/pdf',
      size: 1024,
      documentId: 'doc_1',
    });
  });

  it('does not clear existing documentId when not provided', async () => {
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
    const handler = await getSaveHandler();

    await handler(ctx, baseArgs);

    expect(ctx.db.patch).toHaveBeenCalledWith('fm_existing', {
      fileName: 'test.pdf',
      contentType: 'application/pdf',
      size: 1024,
    });
  });
});

describe('linkDocumentToFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('patches metadata with documentId when found', async () => {
    const existing = {
      _id: 'fm_existing',
      storageId: 'storage_1',
    };
    const { ctx } = createMockCtx(existing);
    const handler = await getLinkHandler();

    await handler(ctx, { storageId: 'storage_1', documentId: 'doc_1' });

    expect(ctx.db.patch).toHaveBeenCalledWith('fm_existing', {
      documentId: 'doc_1',
    });
  });

  it('is a no-op when metadata not found', async () => {
    const { ctx } = createMockCtx(null);
    const handler = await getLinkHandler();

    await handler(ctx, { storageId: 'storage_1', documentId: 'doc_1' });

    expect(ctx.db.patch).not.toHaveBeenCalled();
  });
});
