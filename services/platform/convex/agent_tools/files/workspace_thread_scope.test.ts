/**
 * Regression: workspace file tools operate on the PARENT chat thread's
 * workspace when running inside a sub-thread (spawned agent job or legacy
 * delegate). A worker's `file_write` must land where the parent agent's
 * `file_list` / `file_read` and the user's canvas look — before this fix
 * the tools keyed everything on the sub-thread's own id, so the parent saw
 * `count: 0` after the job finished.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@convex-dev/agent', () => ({
  createTool: vi.fn((def) => ({ _handler: def.execute })),
}));

vi.mock('../../_generated/api', () => ({
  internal: {
    thread_files: {
      internal_queries: {
        listThreadFiles: 'mock-list-thread-files',
        getThreadFileByPath: 'mock-get-thread-file-by-path',
      },
      internal_mutations: {
        upsertThreadFile: 'mock-upsert-thread-file',
        deleteThreadFile: 'mock-delete-thread-file',
      },
    },
  },
  components: {
    agent: { threads: { getThread: 'mock-get-thread' } },
  },
}));

import { getWorkspaceThreadId } from '../../threads/get_parent_thread_id';
import { fileListTool } from './file_list_tool';
import { fileWriteTool } from './file_write_tool';

const JOB_THREAD_ID = 'job-thread-1';
const PARENT_THREAD_ID = 'parent-thread-1';
const ORG_ID = 'org-1';

/** The summary `startJob` writes on every agent-job sub-thread. */
const JOB_SUMMARY = JSON.stringify({
  kind: 'agent_job',
  parentThreadId: PARENT_THREAD_ID,
  organizationId: ORG_ID,
});

type Handler = (
  ctx: Record<string, unknown>,
  args: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

function handlerOf(tool: { tool: unknown }): Handler {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- accessing the mocked createTool handler for testing
  return (tool.tool as { _handler: Handler })._handler;
}

/**
 * Fake ToolCtx whose runQuery answers the component getThread lookup (thread
 * summary) and records every thread_files query/mutation it receives.
 */
function createMockCtx(opts: { summary?: string }) {
  const calls: Array<{ ref: string; args: Record<string, unknown> }> = [];
  const runQuery = vi.fn(
    (ref: string, args: Record<string, unknown>): Promise<unknown> => {
      calls.push({ ref, args });
      if (ref === 'mock-get-thread') {
        return Promise.resolve(
          opts.summary === undefined
            ? { _id: args.threadId, summary: undefined }
            : { _id: args.threadId, summary: opts.summary },
        );
      }
      if (ref === 'mock-list-thread-files') {
        return Promise.resolve([
          {
            organizationId: ORG_ID,
            path: '/user/code/report.md',
            storageId: 'storage-1',
            size: 5,
            contentType: 'text/markdown',
            source: 'agent_write',
            updatedAt: 1,
          },
        ]);
      }
      throw new Error(`unexpected runQuery ref: ${ref}`);
    },
  );
  const runMutation = vi.fn(
    (ref: string, args: Record<string, unknown>): Promise<unknown> => {
      calls.push({ ref, args });
      if (ref === 'mock-upsert-thread-file') {
        return Promise.resolve({ replaced: false });
      }
      throw new Error(`unexpected runMutation ref: ${ref}`);
    },
  );
  return {
    ctx: {
      organizationId: ORG_ID,
      threadId: JOB_THREAD_ID,
      runQuery,
      runMutation,
      storage: {
        store: vi.fn().mockResolvedValue('storage-new'),
        delete: vi.fn(),
      },
    },
    calls,
  };
}

describe('getWorkspaceThreadId', () => {
  it('resolves an agent-job sub-thread to its parent chat thread', async () => {
    const { ctx } = createMockCtx({ summary: JOB_SUMMARY });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- mock ctx shaped for the helper
    const resolved = await getWorkspaceThreadId(ctx as never, JOB_THREAD_ID);
    expect(resolved).toBe(PARENT_THREAD_ID);
  });

  it('returns the thread itself when it has no parent (main thread)', async () => {
    const { ctx } = createMockCtx({});
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- mock ctx shaped for the helper
    const resolved = await getWorkspaceThreadId(ctx as never, 'main-thread');
    expect(resolved).toBe('main-thread');
  });

  it('returns the thread itself when the summary is not JSON', async () => {
    const { ctx } = createMockCtx({ summary: 'a plain prose summary' });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- mock ctx shaped for the helper
    const resolved = await getWorkspaceThreadId(ctx as never, 'main-thread');
    expect(resolved).toBe('main-thread');
  });
});

describe('workspace tools inside a job sub-thread', () => {
  it('file_write stores into the parent workspace', async () => {
    const { ctx, calls } = createMockCtx({ summary: JOB_SUMMARY });
    const result = await handlerOf(fileWriteTool)(ctx, {
      path: '/user/code/report.md',
      content: 'hello',
    });
    expect(result.ok).toBe(true);
    const upsert = calls.find((c) => c.ref === 'mock-upsert-thread-file');
    expect(upsert?.args.threadId).toBe(PARENT_THREAD_ID);
    // Every outcome carries the workspace ground truth, keyed on the parent.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test reads the manifest shape
    const state = result.sandboxState as { code: Array<{ path: string }> };
    expect(state.code.map((e) => e.path)).toEqual(['/user/code/report.md']);
  });

  it('file_write reports sandboxState on failure too', async () => {
    const { ctx } = createMockCtx({ summary: JOB_SUMMARY });
    const result = await handlerOf(fileWriteTool)(ctx, {
      path: '/user/output/wrong-root.md',
      content: 'hello',
    });
    expect(result.ok).toBe(false);
    expect(result.sandboxState).toBeDefined();
  });

  it('file_list reads the parent workspace', async () => {
    const { ctx, calls } = createMockCtx({ summary: JOB_SUMMARY });
    const result = await handlerOf(fileListTool)(ctx, {});
    expect(result.ok).toBe(true);
    expect(result.count).toBe(1);
    const list = calls.find((c) => c.ref === 'mock-list-thread-files');
    expect(list?.args.threadId).toBe(PARENT_THREAD_ID);
  });

  it('file_list on a main thread stays on that thread', async () => {
    const { ctx, calls } = createMockCtx({});
    const result = await handlerOf(fileListTool)(ctx, {});
    expect(result.ok).toBe(true);
    const list = calls.find((c) => c.ref === 'mock-list-thread-files');
    expect(list?.args.threadId).toBe(JOB_THREAD_ID);
  });
});
