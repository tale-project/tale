import { beforeEach, describe, expect, it, vi } from 'vitest';

// Unwrap the registered action so `.handler` is directly callable.
vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    internalAction: (config: Record<string, unknown>) => config,
    internalMutation: (config: Record<string, unknown>) => config,
  };
});

// Minimal api refs the poller hands to runQuery/runMutation/scheduler.
vi.mock('../_generated/api', () => ({
  internal: {
    file_metadata: {
      internal_queries: { getByStorageId: 'getByStorageId' },
      internal_mutations: { updateFileRagStatus: 'updateFileRagStatus' },
      internal_actions: { pollFileRagStatus: 'pollFileRagStatus' },
    },
  },
}));

// Neutralize heavy / network imports the module pulls at load time.
vi.mock('../lib/helpers/rag_config', () => ({ ragFetch: vi.fn() }));
vi.mock('../lib/helpers/org_slug', () => ({ orgSlugFromIdOrNull: vi.fn() }));
vi.mock('../documents/internal_actions', () => ({
  getPollingInterval: vi.fn(() => 1000),
}));
vi.mock('../documents/generate_document_helpers', () => ({
  getCrawlerUrl: vi.fn(),
}));
vi.mock('../workflow_engine/action_defs/rag/rag_action', () => ({
  ragAction: {},
}));

import { orgSlugFromIdOrNull } from '../lib/helpers/org_slug';
import { ragFetch } from '../lib/helpers/rag_config';
import { pollFileRagStatus } from './internal_actions';

const handler = (
  pollFileRagStatus as unknown as {
    handler: (
      ctx: unknown,
      args: { storageId: string; organizationId: string; attempt: number },
    ) => Promise<unknown>;
  }
).handler;
const ragFetchMock = ragFetch as unknown as ReturnType<typeof vi.fn>;
const orgSlugMock = orgSlugFromIdOrNull as unknown as ReturnType<typeof vi.fn>;

function createCtx(metadata: Record<string, unknown> | null) {
  const runMutation = vi.fn().mockResolvedValue(undefined);
  const runQuery = vi.fn().mockResolvedValue(metadata);
  const runAfter = vi.fn().mockResolvedValue(undefined);
  return {
    ctx: { runQuery, runMutation, scheduler: { runAfter } },
    runMutation,
    runAfter,
  };
}

function makeResp(opts: {
  status?: number;
  ok?: boolean;
  body?: unknown;
  jsonThrows?: boolean;
}) {
  const status = opts.status ?? 200;
  return {
    status,
    ok: opts.ok ?? (status >= 200 && status < 300),
    json: async () => {
      if (opts.jsonThrows) throw new Error('bad json');
      return opts.body;
    },
  };
}

const baseArgs = { storageId: 's1', organizationId: 'org1', attempt: 1 };
const statusBody = (s: Record<string, unknown>) => ({ statuses: { s1: s } });

describe('pollFileRagStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orgSlugMock.mockResolvedValue('org-slug');
  });

  it('short-circuits on a terminal/absent canonical status (no fetch, no write)', async () => {
    for (const ragStatus of ['completed', 'failed', undefined]) {
      const { ctx, runMutation, runAfter } = createCtx(
        ragStatus === undefined ? { _id: 'fm1' } : { _id: 'fm1', ragStatus },
      );
      const res = await handler(ctx, baseArgs);
      expect(res).toBeNull();
      expect(ragFetchMock).not.toHaveBeenCalled();
      expect(runMutation).not.toHaveBeenCalled();
      expect(runAfter).not.toHaveBeenCalled();
    }
  });

  it('returns early when the row is gone', async () => {
    const { ctx, runMutation } = createCtx(null);
    const res = await handler(ctx, baseArgs);
    expect(res).toBeNull();
    expect(runMutation).not.toHaveBeenCalled();
  });

  it('marks failed (no fetch) past MAX_POLL_ATTEMPTS', async () => {
    const { ctx, runMutation } = createCtx({
      _id: 'fm1',
      ragStatus: 'running',
    });
    await handler(ctx, { ...baseArgs, attempt: 51 });
    expect(ragFetchMock).not.toHaveBeenCalled();
    expect(runMutation).toHaveBeenCalledWith('updateFileRagStatus', {
      storageId: 's1',
      ragStatus: 'failed',
      ragError: expect.stringContaining('timed out'),
    });
  });

  it('marks failed (no fetch, no retry) when the org slug is unresolvable', async () => {
    orgSlugMock.mockResolvedValue(null);
    const { ctx, runMutation, runAfter } = createCtx({
      _id: 'fm1',
      ragStatus: 'queued',
    });
    await handler(ctx, baseArgs);
    expect(ragFetchMock).not.toHaveBeenCalled();
    expect(runMutation).toHaveBeenCalledWith(
      'updateFileRagStatus',
      expect.objectContaining({ ragStatus: 'failed' }),
    );
    expect(runAfter).not.toHaveBeenCalled();
  });

  it('reschedules on 429 without writing status', async () => {
    ragFetchMock.mockResolvedValue(makeResp({ status: 429, ok: false }));
    const { ctx, runMutation, runAfter } = createCtx({
      _id: 'fm1',
      ragStatus: 'queued',
    });
    await handler(ctx, baseArgs);
    expect(runMutation).not.toHaveBeenCalled();
    expect(runAfter).toHaveBeenCalledWith(1000, 'pollFileRagStatus', {
      storageId: 's1',
      organizationId: 'org1',
      attempt: 2,
    });
  });

  it('reschedules on 5xx', async () => {
    ragFetchMock.mockResolvedValue(makeResp({ status: 503, ok: false }));
    const { ctx, runMutation, runAfter } = createCtx({
      _id: 'fm1',
      ragStatus: 'queued',
    });
    await handler(ctx, baseArgs);
    expect(runMutation).not.toHaveBeenCalled();
    expect(runAfter).toHaveBeenCalledTimes(1);
  });

  it('marks failed (no retry) on a 4xx', async () => {
    ragFetchMock.mockResolvedValue(makeResp({ status: 404, ok: false }));
    const { ctx, runMutation, runAfter } = createCtx({
      _id: 'fm1',
      ragStatus: 'queued',
    });
    await handler(ctx, baseArgs);
    expect(runMutation).toHaveBeenCalledWith(
      'updateFileRagStatus',
      expect.objectContaining({
        ragStatus: 'failed',
        ragError: expect.stringContaining('404'),
      }),
    );
    expect(runAfter).not.toHaveBeenCalled();
  });

  it('reschedules when the JSON body fails to parse', async () => {
    ragFetchMock.mockResolvedValue(makeResp({ status: 200, jsonThrows: true }));
    const { ctx, runMutation, runAfter } = createCtx({
      _id: 'fm1',
      ragStatus: 'queued',
    });
    await handler(ctx, baseArgs);
    expect(runMutation).not.toHaveBeenCalled();
    expect(runAfter).toHaveBeenCalledTimes(1);
  });

  it('reschedules when RAG has not ingested the file yet (no statuses entry)', async () => {
    ragFetchMock.mockResolvedValue(
      makeResp({ status: 200, body: { statuses: {} } }),
    );
    const { ctx, runMutation, runAfter } = createCtx({
      _id: 'fm1',
      ragStatus: 'queued',
    });
    await handler(ctx, baseArgs);
    expect(runMutation).not.toHaveBeenCalled();
    expect(runAfter).toHaveBeenCalledTimes(1);
  });

  it('writes completed (with ocrApplied) and stops on a completed status', async () => {
    ragFetchMock.mockResolvedValue(
      makeResp({
        status: 200,
        body: statusBody({ status: 'completed', ocr_applied: true }),
      }),
    );
    const { ctx, runMutation, runAfter } = createCtx({
      _id: 'fm1',
      ragStatus: 'running',
    });
    await handler(ctx, baseArgs);
    expect(runMutation).toHaveBeenCalledWith('updateFileRagStatus', {
      storageId: 's1',
      ragStatus: 'completed',
      ocrApplied: true,
    });
    expect(runAfter).not.toHaveBeenCalled();
  });

  it('writes failed and stops on a failed status', async () => {
    ragFetchMock.mockResolvedValue(
      makeResp({
        status: 200,
        body: statusBody({ status: 'failed', error: 'extract error' }),
      }),
    );
    const { ctx, runMutation, runAfter } = createCtx({
      _id: 'fm1',
      ragStatus: 'running',
    });
    await handler(ctx, baseArgs);
    expect(runMutation).toHaveBeenCalledWith('updateFileRagStatus', {
      storageId: 's1',
      ragStatus: 'failed',
      ragError: 'extract error',
    });
    expect(runAfter).not.toHaveBeenCalled();
  });

  it('writes running and reschedules on a processing status', async () => {
    ragFetchMock.mockResolvedValue(
      makeResp({
        status: 200,
        body: statusBody({
          status: 'processing',
          progress_phase: 'embedding',
          progress_detail: '3/10',
        }),
      }),
    );
    const { ctx, runMutation, runAfter } = createCtx({
      _id: 'fm1',
      ragStatus: 'queued',
    });
    await handler(ctx, baseArgs);
    expect(runMutation).toHaveBeenCalledWith('updateFileRagStatus', {
      storageId: 's1',
      ragStatus: 'running',
      ragProgress: 'embedding 3/10',
    });
    expect(runAfter).toHaveBeenCalledTimes(1);
  });
});
