import { beforeEach, describe, expect, it, vi } from 'vitest';

// Unwrap the registered mutation so `.handler` is directly callable (mirrors
// file_metadata/internal_mutations.test.ts).
vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    internalMutation: (config: Record<string, unknown>) => config,
  };
});

import { backfillFilemetadataRagStatus } from './backfill_filemetadata_rag_status';

type Doc = Record<string, unknown>;
type Fm = Record<string, unknown> & { _id: string; ragStatus?: string };

/**
 * Mock ctx for the backfill mutation. `documents` resolves to a paginated page;
 * `fileMetadata` resolves to a `by_storageId` `.first()` lookup keyed by the
 * provided map. Tracks inserts, patches, and self-scheduling.
 */
function createMockCtx(opts: {
  docs: Doc[];
  fmByStorageId?: Record<string, Fm>;
  sysByStorageId?: Record<string, { size: number; contentType?: string }>;
  isDone?: boolean;
}) {
  const fmByStorageId = opts.fmByStorageId ?? {};
  const sysByStorageId = opts.sysByStorageId ?? {};
  const inserts: Array<{ table: string; doc: Doc }> = [];
  const patches: Array<{ id: string; patch: Doc }> = [];
  const scheduled: Array<{ delay: number; args: Doc }> = [];

  const ctx = {
    db: {
      query: (table: string) => {
        if (table === 'documents') {
          return {
            paginate: async () => ({
              page: opts.docs,
              isDone: opts.isDone ?? true,
              continueCursor: 'next-cursor',
            }),
          };
        }
        // fileMetadata by_storageId .first()
        let storageId: string | undefined;
        const builder = {
          withIndex: (_idx: string, cb: (q: unknown) => unknown) => {
            const q = {
              eq: (field: string, value: unknown) => {
                if (field === 'storageId') storageId = value as string;
                return q;
              },
            };
            cb(q);
            return builder;
          },
          first: async () =>
            storageId ? (fmByStorageId[storageId] ?? null) : null,
        };
        return builder;
      },
      system: {
        get: async (id: unknown) => sysByStorageId[id as string] ?? null,
      },
      insert: async (table: string, doc: Doc) => {
        inserts.push({ table, doc });
        return `fm_inserted_${inserts.length}`;
      },
      patch: async (id: string, patch: Doc) => {
        patches.push({ id, patch });
      },
    },
    scheduler: {
      runAfter: async (delay: number, _ref: unknown, args: Doc) => {
        scheduled.push({ delay, args });
      },
    },
  };

  return { ctx, inserts, patches, scheduled };
}

const handler = (
  backfillFilemetadataRagStatus as unknown as {
    handler: (
      ctx: unknown,
      args: { cursor?: string | null },
    ) => Promise<{
      patched: number;
      inserted: number;
      skipped: number;
      isDone: boolean;
    }>;
  }
).handler;

describe('backfillFilemetadataRagStatus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('M1: skips non-terminal legacy statuses (queued/running) — no write', async () => {
    const { ctx, inserts, patches } = createMockCtx({
      docs: [
        {
          _id: 'd1',
          organizationId: 'org1',
          fileId: 's1',
          ragInfo: { status: 'queued' },
        },
        {
          _id: 'd2',
          organizationId: 'org1',
          fileId: 's2',
          ragInfo: { status: 'running' },
        },
      ],
      // even though a hole exists, non-terminal must not be copied
      fmByStorageId: { s1: { _id: 'fm1' }, s2: { _id: 'fm2' } },
    });

    const res = await handler(ctx, {});

    expect(inserts).toHaveLength(0);
    expect(patches).toHaveLength(0);
    expect(res).toMatchObject({ patched: 0, inserted: 0, skipped: 2 });
  });

  it('patches the hole on an existing fileMetadata row for a terminal status', async () => {
    const { ctx, patches, inserts } = createMockCtx({
      docs: [
        {
          _id: 'd1',
          organizationId: 'org1',
          fileId: 's1',
          ragInfo: {
            status: 'completed',
            indexedAt: 1_700_000_000,
            error: undefined,
          },
        },
      ],
      fmByStorageId: { s1: { _id: 'fm1' } }, // exists, ragStatus unset
    });

    const res = await handler(ctx, {});

    expect(inserts).toHaveLength(0);
    expect(patches).toEqual([
      {
        id: 'fm1',
        patch: { ragStatus: 'completed', ragIndexedAt: 1_700_000_000 },
      },
    ]);
    expect(res).toMatchObject({ patched: 1, inserted: 0 });
  });

  it('idempotent: never overwrites an already-set canonical ragStatus', async () => {
    const { ctx, patches, inserts } = createMockCtx({
      docs: [
        {
          _id: 'd1',
          organizationId: 'org1',
          fileId: 's1',
          ragInfo: { status: 'failed', error: 'boom' },
        },
      ],
      fmByStorageId: { s1: { _id: 'fm1', ragStatus: 'completed' } }, // already canonical
    });

    const res = await handler(ctx, {});

    expect(patches).toHaveLength(0);
    expect(inserts).toHaveLength(0);
    expect(res).toMatchObject({ patched: 0, inserted: 0, skipped: 1 });
  });

  it('M2: creates the canonical row when missing, reading size/contentType from _storage', async () => {
    const { ctx, inserts, patches } = createMockCtx({
      docs: [
        {
          _id: 'd1',
          organizationId: 'org1',
          fileId: 's1',
          title: 'Report.pdf',
          mimeType: undefined,
          ragInfo: { status: 'completed', indexedAt: 1_700_000_000 },
        },
      ],
      fmByStorageId: {}, // no row → must insert
      sysByStorageId: { s1: { size: 2048, contentType: 'application/pdf' } },
    });

    const res = await handler(ctx, {});

    expect(patches).toHaveLength(0);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toEqual({
      table: 'fileMetadata',
      doc: {
        organizationId: 'org1',
        storageId: 's1',
        documentId: 'd1',
        fileName: 'Report.pdf',
        contentType: 'application/pdf',
        size: 2048,
        ragStatus: 'completed',
        ragIndexedAt: 1_700_000_000,
      },
    });
    expect(res).toMatchObject({ inserted: 1, patched: 0 });
  });

  it('M2: defaults contentType/size when the blob has no system metadata', async () => {
    const { ctx, inserts } = createMockCtx({
      docs: [
        {
          _id: 'd1',
          organizationId: 'org1',
          fileId: 's1',
          title: undefined,
          mimeType: undefined,
          ragInfo: { status: 'failed', error: 'nope' },
        },
      ],
      fmByStorageId: {},
      sysByStorageId: {}, // no system metadata
    });

    await handler(ctx, {});

    expect(inserts[0].doc).toMatchObject({
      fileName: 'document',
      contentType: 'application/octet-stream',
      size: 0,
      ragStatus: 'failed',
      ragError: 'nope',
    });
  });

  it('skips docs with no ragInfo.status or no fileId', async () => {
    const { ctx, inserts, patches, scheduled } = createMockCtx({
      docs: [
        { _id: 'd1', organizationId: 'org1', fileId: 's1' }, // no ragInfo
        { _id: 'd2', organizationId: 'org1', ragInfo: { status: 'completed' } }, // no fileId
      ],
    });

    const res = await handler(ctx, {});

    expect(inserts).toHaveLength(0);
    expect(patches).toHaveLength(0);
    expect(scheduled).toHaveLength(0);
    expect(res).toMatchObject({ skipped: 2, isDone: true });
  });

  it('self-schedules the next batch when not done', async () => {
    const { ctx, scheduled } = createMockCtx({
      docs: [],
      isDone: false,
    });

    await handler(ctx, {});

    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]).toMatchObject({
      delay: 0,
      args: { cursor: 'next-cursor' },
    });
  });
});
