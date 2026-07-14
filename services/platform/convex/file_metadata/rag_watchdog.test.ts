import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock-ctx idiom: passthrough `internalAction({...})` so we can call its
// `handler` directly with a plain mock ctx (this is a Convex action; the
// convex-test edge runtime can't load a node-flavoured orchestrator cleanly).
vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    internalAction: (config: Record<string, unknown>) => config,
  };
});

vi.mock('../_generated/api', () => ({
  internal: {
    file_metadata: {
      internal_queries: { listStuckRagCandidates: 'listStuckRagCandidates' },
      internal_mutations: { updateFileRagStatus: 'updateFileRagStatus' },
    },
    rag: { documents: { getStatuses: 'getStatuses' } },
  },
}));

const mockIsE2ECronSuppressed = vi.fn(() => false);
vi.mock('../lib/e2e_cron_guard', () => ({
  isE2ECronSuppressed: () => mockIsE2ECronSuppressed(),
}));

const mockOrgSlugFromIdOrNull = vi.fn(
  async (): Promise<string | null> => 'acme',
);
vi.mock('../lib/helpers/org_slug', () => ({
  orgSlugFromIdOrNull: () => mockOrgSlugFromIdOrNull(),
}));

const { recoverStuckRagIndexing } = await import('./rag_watchdog');

// oxlint-disable-next-line typescript/no-explicit-any -- vi.mock narrows to { handler }
type Handler = { handler: (ctx: unknown) => Promise<any> };
const handler = (recoverStuckRagIndexing as unknown as Handler).handler;

type Candidate = {
  storageId: string;
  organizationId: string;
  ragStatus: 'queued' | 'running';
};
type DocStatus = {
  status: string;
  error: string | null;
  ocr_applied: boolean | null;
};

function createCtx(opts: {
  candidates: Candidate[];
  statuses?: Record<string, DocStatus | null>;
  getStatusesThrows?: boolean;
}) {
  const mutationCalls: Array<{ ref: unknown; args: Record<string, unknown> }> =
    [];
  const getStatusesCalls: Array<Record<string, unknown>> = [];
  const ctx = {
    runQuery: vi.fn(async (ref: unknown) => {
      if (ref === 'listStuckRagCandidates') return opts.candidates;
      return null;
    }),
    runAction: vi.fn(async (ref: unknown, args: Record<string, unknown>) => {
      if (ref === 'getStatuses') {
        getStatusesCalls.push(args);
        if (opts.getStatusesThrows) throw new Error('knowledge-db down');
        return { statuses: opts.statuses ?? {} };
      }
      return null;
    }),
    runMutation: vi.fn(async (ref: unknown, args: Record<string, unknown>) => {
      mutationCalls.push({ ref, args });
      return null;
    }),
  };
  return { ctx, mutationCalls, getStatusesCalls };
}

const STORAGE = 'storage_1';

describe('recoverStuckRagIndexing watchdog', () => {
  beforeEach(() => {
    mockIsE2ECronSuppressed.mockReturnValue(false);
    mockOrgSlugFromIdOrNull.mockResolvedValue('acme');
  });

  it('no-ops under E2E suppression without touching the corpus', async () => {
    mockIsE2ECronSuppressed.mockReturnValue(true);
    const { ctx, mutationCalls, getStatusesCalls } = createCtx({
      candidates: [
        { storageId: STORAGE, organizationId: 'org_1', ragStatus: 'running' },
      ],
    });

    await handler(ctx);

    expect(ctx.runQuery).not.toHaveBeenCalled();
    expect(getStatusesCalls).toHaveLength(0);
    expect(mutationCalls).toHaveLength(0);
  });

  it('does nothing when there are no stale candidates', async () => {
    const { ctx, mutationCalls, getStatusesCalls } = createCtx({
      candidates: [],
    });

    await handler(ctx);

    expect(getStatusesCalls).toHaveLength(0);
    expect(mutationCalls).toHaveLength(0);
  });

  it('adopts a late completion instead of failing a stuck row', async () => {
    const { ctx, mutationCalls } = createCtx({
      candidates: [
        { storageId: STORAGE, organizationId: 'org_1', ragStatus: 'running' },
      ],
      statuses: {
        [STORAGE]: { status: 'completed', error: null, ocr_applied: true },
      },
    });

    await handler(ctx);

    expect(mutationCalls).toHaveLength(1);
    expect(mutationCalls[0].ref).toBe('updateFileRagStatus');
    expect(mutationCalls[0].args).toMatchObject({
      storageId: STORAGE,
      ragStatus: 'completed',
      ocrApplied: true,
    });
  });

  it('fails a row the corpus still reports as processing (dead job)', async () => {
    const { ctx, mutationCalls } = createCtx({
      candidates: [
        { storageId: STORAGE, organizationId: 'org_1', ragStatus: 'running' },
      ],
      statuses: {
        [STORAGE]: { status: 'processing', error: null, ocr_applied: null },
      },
    });

    await handler(ctx);

    expect(mutationCalls[0].args).toMatchObject({
      storageId: STORAGE,
      ragStatus: 'failed',
    });
    expect(String(mutationCalls[0].args.ragError)).toMatch(/interrupted/i);
  });

  it('fails a queued row the corpus never ingested (null status)', async () => {
    const { ctx, mutationCalls } = createCtx({
      candidates: [
        { storageId: STORAGE, organizationId: 'org_1', ragStatus: 'queued' },
      ],
      statuses: { [STORAGE]: null },
    });

    await handler(ctx);

    expect(mutationCalls[0].args).toMatchObject({
      storageId: STORAGE,
      ragStatus: 'failed',
    });
    expect(String(mutationCalls[0].args.ragError)).toMatch(/interrupted/i);
  });

  it('adopts a corpus-reported failure with its error text', async () => {
    const { ctx, mutationCalls } = createCtx({
      candidates: [
        { storageId: STORAGE, organizationId: 'org_1', ragStatus: 'running' },
      ],
      statuses: {
        [STORAGE]: {
          status: 'failed',
          error: 'embedding provider 500',
          ocr_applied: null,
        },
      },
    });

    await handler(ctx);

    expect(mutationCalls[0].args).toMatchObject({
      ragStatus: 'failed',
      ragError: 'embedding provider 500',
    });
  });

  it('defers (does NOT fail) an org whose corpus lookup throws', async () => {
    const { ctx, mutationCalls } = createCtx({
      candidates: [
        { storageId: STORAGE, organizationId: 'org_1', ragStatus: 'running' },
      ],
      getStatusesThrows: true,
    });

    await handler(ctx);

    // A knowledge-db reachability blip must not mass-fail the org's rows.
    expect(mutationCalls).toHaveLength(0);
  });

  it('fails orphaned rows when the org can no longer be resolved', async () => {
    mockOrgSlugFromIdOrNull.mockResolvedValue(null);
    const { ctx, mutationCalls, getStatusesCalls } = createCtx({
      candidates: [
        { storageId: STORAGE, organizationId: 'gone', ragStatus: 'running' },
      ],
    });

    await handler(ctx);

    expect(getStatusesCalls).toHaveLength(0);
    expect(mutationCalls[0].args).toMatchObject({
      storageId: STORAGE,
      ragStatus: 'failed',
    });
    expect(String(mutationCalls[0].args.ragError)).toMatch(/unresolvable/i);
  });

  it('issues one corpus call per org and reconciles each file', async () => {
    const { ctx, mutationCalls, getStatusesCalls } = createCtx({
      candidates: [
        { storageId: 'a', organizationId: 'org_1', ragStatus: 'running' },
        { storageId: 'b', organizationId: 'org_1', ragStatus: 'queued' },
      ],
      statuses: {
        a: { status: 'completed', error: null, ocr_applied: null },
        b: { status: 'processing', error: null, ocr_applied: null },
      },
    });

    await handler(ctx);

    // Both files belong to org_1 → a single getStatuses call for the pair.
    expect(getStatusesCalls).toHaveLength(1);
    expect(getStatusesCalls[0]).toMatchObject({
      orgSlug: 'acme',
      fileIds: ['a', 'b'],
    });
    expect(mutationCalls).toHaveLength(2);
  });
});
