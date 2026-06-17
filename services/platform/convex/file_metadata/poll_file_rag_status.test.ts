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

// Minimal api refs the poller hands to runQuery/runMutation/runAction/scheduler.
vi.mock('../_generated/api', () => ({
  internal: {
    file_metadata: {
      internal_queries: { getByStorageId: 'getByStorageId' },
      internal_mutations: { updateFileRagStatus: 'updateFileRagStatus' },
      internal_actions: { pollFileRagStatus: 'pollFileRagStatus' },
    },
    rag: {
      documents: { getStatuses: 'getStatuses' },
    },
  },
}));

// Neutralize heavy / network imports the module pulls at load time.
vi.mock('../lib/helpers/org_slug', () => ({ orgSlugFromIdOrNull: vi.fn() }));
vi.mock('../documents/internal_actions', () => ({
  getPollingInterval: vi.fn(() => 1000),
}));
vi.mock('../crawler/lib/document_metadata', () => ({
  extractDocumentMetadata: vi.fn(),
}));
vi.mock('../workflow_engine/action_defs/rag/rag_action', () => ({
  ragAction: {},
}));

import { orgSlugFromIdOrNull } from '../lib/helpers/org_slug';
import { pollFileRagStatus } from './internal_actions';

const handler = (
  pollFileRagStatus as unknown as {
    handler: (
      ctx: unknown,
      args: { storageId: string; organizationId: string; attempt: number },
    ) => Promise<unknown>;
  }
).handler;
const orgSlugMock = orgSlugFromIdOrNull as unknown as ReturnType<typeof vi.fn>;

/** A serialized status record as `internal.rag.documents.getStatuses` returns. */
interface SerializedStatus {
  status: string;
  error: string | null;
  progress_phase: string | null;
  progress_detail: string | null;
  source_created_at: string | null;
  source_modified_at: string | null;
  ocr_applied: boolean | null;
}

function status(overrides: Partial<SerializedStatus>): SerializedStatus {
  return {
    status: 'processing',
    error: null,
    progress_phase: null,
    progress_detail: null,
    source_created_at: null,
    source_modified_at: null,
    ocr_applied: null,
    ...overrides,
  };
}

function createCtx(
  metadata: Record<string, unknown> | null,
  options: {
    statuses?: Record<string, SerializedStatus | null>;
    runActionRejects?: Error;
  } = {},
) {
  const runMutation = vi.fn().mockResolvedValue(undefined);
  const runQuery = vi.fn().mockResolvedValue(metadata);
  const runAfter = vi.fn().mockResolvedValue(undefined);
  const runAction = options.runActionRejects
    ? vi.fn().mockRejectedValue(options.runActionRejects)
    : vi.fn().mockResolvedValue({ statuses: options.statuses ?? {} });
  return {
    ctx: { runQuery, runMutation, runAction, scheduler: { runAfter } },
    runMutation,
    runAfter,
    runAction,
  };
}

const baseArgs = { storageId: 's1', organizationId: 'org1', attempt: 1 };

describe('pollFileRagStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orgSlugMock.mockResolvedValue('org-slug');
  });

  it('short-circuits on a terminal/absent canonical status (no lookup, no write)', async () => {
    for (const ragStatus of ['completed', 'failed', undefined]) {
      const { ctx, runMutation, runAfter, runAction } = createCtx(
        ragStatus === undefined ? { _id: 'fm1' } : { _id: 'fm1', ragStatus },
      );
      const res = await handler(ctx, baseArgs);
      expect(res).toBeNull();
      expect(runAction).not.toHaveBeenCalled();
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

  it('marks failed (no lookup) past MAX_POLL_ATTEMPTS', async () => {
    const { ctx, runMutation, runAction } = createCtx({
      _id: 'fm1',
      ragStatus: 'running',
    });
    await handler(ctx, { ...baseArgs, attempt: 51 });
    expect(runAction).not.toHaveBeenCalled();
    expect(runMutation).toHaveBeenCalledWith('updateFileRagStatus', {
      storageId: 's1',
      ragStatus: 'failed',
      ragError: expect.stringContaining('timed out'),
    });
  });

  it('marks failed (no lookup, no retry) when the org slug is unresolvable', async () => {
    orgSlugMock.mockResolvedValue(null);
    const { ctx, runMutation, runAfter, runAction } = createCtx({
      _id: 'fm1',
      ragStatus: 'queued',
    });
    await handler(ctx, baseArgs);
    expect(runAction).not.toHaveBeenCalled();
    expect(runMutation).toHaveBeenCalledWith(
      'updateFileRagStatus',
      expect.objectContaining({ ragStatus: 'failed' }),
    );
    expect(runAfter).not.toHaveBeenCalled();
  });

  it('reschedules (no status write) when the status action throws', async () => {
    const { ctx, runMutation, runAfter } = createCtx(
      { _id: 'fm1', ragStatus: 'queued' },
      { runActionRejects: new Error('knowledge-db unavailable') },
    );
    await handler(ctx, baseArgs);
    expect(runMutation).not.toHaveBeenCalled();
    expect(runAfter).toHaveBeenCalledWith(1000, 'pollFileRagStatus', {
      storageId: 's1',
      organizationId: 'org1',
      attempt: 2,
    });
  });

  it('reschedules when the corpus has not ingested the file yet (no statuses entry)', async () => {
    const { ctx, runMutation, runAfter } = createCtx(
      { _id: 'fm1', ragStatus: 'queued' },
      { statuses: {} },
    );
    await handler(ctx, baseArgs);
    expect(runMutation).not.toHaveBeenCalled();
    expect(runAfter).toHaveBeenCalledTimes(1);
  });

  it('writes completed (with ocrApplied) and stops on a completed status', async () => {
    const { ctx, runMutation, runAfter } = createCtx(
      { _id: 'fm1', ragStatus: 'running' },
      { statuses: { s1: status({ status: 'completed', ocr_applied: true }) } },
    );
    await handler(ctx, baseArgs);
    expect(runMutation).toHaveBeenCalledWith('updateFileRagStatus', {
      storageId: 's1',
      ragStatus: 'completed',
      ocrApplied: true,
    });
    expect(runAfter).not.toHaveBeenCalled();
  });

  it('writes failed and stops on a failed status', async () => {
    const { ctx, runMutation, runAfter } = createCtx(
      { _id: 'fm1', ragStatus: 'running' },
      {
        statuses: { s1: status({ status: 'failed', error: 'extract error' }) },
      },
    );
    await handler(ctx, baseArgs);
    expect(runMutation).toHaveBeenCalledWith('updateFileRagStatus', {
      storageId: 's1',
      ragStatus: 'failed',
      ragError: 'extract error',
    });
    expect(runAfter).not.toHaveBeenCalled();
  });

  it('writes running and reschedules on a processing status', async () => {
    const { ctx, runMutation, runAfter } = createCtx(
      { _id: 'fm1', ragStatus: 'queued' },
      {
        statuses: {
          s1: status({
            status: 'processing',
            progress_phase: 'embedding',
            progress_detail: '3/10',
          }),
        },
      },
    );
    await handler(ctx, baseArgs);
    expect(runMutation).toHaveBeenCalledWith('updateFileRagStatus', {
      storageId: 's1',
      ragStatus: 'running',
      ragProgress: 'embedding 3/10',
    });
    expect(runAfter).toHaveBeenCalledTimes(1);
  });
});
