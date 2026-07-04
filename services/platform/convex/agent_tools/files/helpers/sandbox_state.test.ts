/**
 * buildSandboxState groups the workspace manifest by sandbox area and
 * filters cross-org rows; formatSandboxState renders the compact summary.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../_generated/api', () => ({
  internal: {
    thread_files: {
      internal_queries: { listThreadFiles: 'mock-list-thread-files' },
    },
  },
}));

import { buildSandboxState, formatSandboxState } from './sandbox_state';

const ORG_ID = 'org-1';

function row(
  path: string,
  source: 'user_upload' | 'agent_write' | 'run_output',
  organizationId = ORG_ID,
) {
  return {
    organizationId,
    path,
    storageId: `sid-${path}`,
    size: 10,
    contentType: 'text/plain',
    source,
    updatedAt: 1,
  };
}

function ctxWithRows(rows: unknown[]) {
  return {
    runQuery: vi.fn().mockResolvedValue(rows),
  };
}

describe('buildSandboxState', () => {
  it('groups files by sandbox area and keeps fileId handoff tokens', async () => {
    const ctx = ctxWithRows([
      row('/user/uploads/data.csv', 'user_upload'),
      row('/user/code/gen.py', 'agent_write'),
      row('/user/output/report.xlsx', 'run_output'),
    ]);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- mock ctx shaped for the helper
    const state = await buildSandboxState(ctx as never, {
      organizationId: ORG_ID,
      workspaceThreadId: 'thread-1',
    });
    expect(state.uploads.map((e) => e.path)).toEqual([
      '/user/uploads/data.csv',
    ]);
    expect(state.code.map((e) => e.path)).toEqual(['/user/code/gen.py']);
    expect(state.outputs.map((e) => e.path)).toEqual([
      '/user/output/report.xlsx',
    ]);
    expect(state.code[0].fileId).toBe('sid-/user/code/gen.py');
    expect(ctx.runQuery).toHaveBeenCalledWith('mock-list-thread-files', {
      threadId: 'thread-1',
    });
  });

  it('filters out rows from another organization', async () => {
    const ctx = ctxWithRows([
      row('/user/code/other.py', 'agent_write', 'org-2'),
    ]);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- mock ctx shaped for the helper
    const state = await buildSandboxState(ctx as never, {
      organizationId: ORG_ID,
      workspaceThreadId: 'thread-1',
    });
    expect(state).toEqual({ uploads: [], code: [], outputs: [] });
  });
});

describe('formatSandboxState', () => {
  it('renders one line per non-empty area and elides the empty ones', () => {
    const summary = formatSandboxState({
      uploads: [],
      code: [
        {
          path: '/user/code/gen.py',
          fileId: 'sid-1',
          size: 2048,
          contentType: 'text/x-python',
        },
      ],
      outputs: [],
    });
    expect(summary).toContain('/user/code: gen.py (2.0 KB)');
    expect(summary).not.toContain('/user/uploads');
  });

  it('returns an empty string for an empty workspace', () => {
    expect(formatSandboxState({ uploads: [], code: [], outputs: [] })).toBe('');
  });
});
