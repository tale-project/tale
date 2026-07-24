// Coverage for `getProjectAgentCapabilitiesForThread` — the Phase B resolver a
// coding turn calls to run its agent pre-equipped with the project's binding.
// Locks the three "nothing bound" fallbacks (thread not in a project, project
// gone, agent unbound) that all collapse to empty lists, plus the happy path.
//
// Same mock-the-factory pattern as the sibling mutation tests: the handler is
// unit-tested against a hand-built db ctx, no running backend.

import { describe, it, expect, vi } from 'vitest';

vi.mock('convex/values', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const stub = () => 'validator';
  return {
    ...actual,
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
      record: stub,
    },
  };
});

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    internalQuery: (config: Record<string, unknown>) => config,
  };
});

vi.mock('../lib/get_user_teams', () => ({
  getUserTeamIds: vi.fn().mockResolvedValue([]),
}));

vi.mock('../lib/rls', () => ({
  getOrganizationMember: vi.fn(),
}));

type Handler = (
  ctx: unknown,
  args: Record<string, unknown>,
) => Promise<unknown>;

async function getQuery(): Promise<{ handler: Handler }> {
  const { getProjectAgentCapabilitiesForThread } =
    await import('./internal_queries');
  return getProjectAgentCapabilitiesForThread as unknown as {
    handler: Handler;
  };
}

function createCtx(opts: {
  meta: Record<string, unknown> | null;
  project?: Record<string, unknown> | null;
  /** A rebuilt chat `threads` row: `normalizeId('threads', …)` resolves and
   * `db.get(threadId)` returns this row. Absent = a legacy string thread id
   * (normalizeId → null), which is every pre-existing case below. */
  chatThread?: Record<string, unknown> | null;
}) {
  const get = vi.fn((id: string) =>
    Promise.resolve(
      id === 'thread_1' ? (opts.chatThread ?? null) : (opts.project ?? null),
    ),
  );
  const query = vi.fn(() => ({
    withIndex: vi.fn(() => ({
      first: vi.fn().mockResolvedValue(opts.meta),
    })),
  }));
  return {
    ctx: {
      db: {
        normalizeId: vi.fn((_table: string, id: string) =>
          opts.chatThread !== undefined ? id : null,
        ),
        query,
        get,
      },
    },
    get,
    query,
  };
}

const EMPTY = { skills: [], connectors: [] };

describe('getProjectAgentCapabilitiesForThread', () => {
  it("returns the project's binding for the agent", async () => {
    const { ctx } = createCtx({
      meta: { projectId: 'project_1' },
      project: {
        agentCapabilities: {
          'claude-code': { skills: ['review'], connectors: ['github'] },
          codex: { skills: ['plan'], connectors: [] },
        },
      },
    });
    const { handler } = await getQuery();

    await expect(
      handler(ctx, { threadId: 'thread_1', agentId: 'claude-code' }),
    ).resolves.toEqual({ skills: ['review'], connectors: ['github'] });
  });

  it('is empty when the thread is not in a project', async () => {
    const { ctx, get } = createCtx({ meta: null });
    const { handler } = await getQuery();

    await expect(
      handler(ctx, { threadId: 'thread_1', agentId: 'claude-code' }),
    ).resolves.toEqual(EMPTY);
    // No project link → never touch the projects table.
    expect(get).not.toHaveBeenCalled();
  });

  it('is empty when the thread metadata has no projectId', async () => {
    const { ctx, get } = createCtx({ meta: { projectId: undefined } });
    const { handler } = await getQuery();

    await expect(
      handler(ctx, { threadId: 'thread_1', agentId: 'claude-code' }),
    ).resolves.toEqual(EMPTY);
    expect(get).not.toHaveBeenCalled();
  });

  it('is empty when the project is gone', async () => {
    const { ctx } = createCtx({
      meta: { projectId: 'project_1' },
      project: null,
    });
    const { handler } = await getQuery();

    await expect(
      handler(ctx, { threadId: 'thread_1', agentId: 'claude-code' }),
    ).resolves.toEqual(EMPTY);
  });

  it('is empty when the agent has no binding in the project', async () => {
    const { ctx } = createCtx({
      meta: { projectId: 'project_1' },
      project: {
        agentCapabilities: { codex: { skills: ['plan'], connectors: [] } },
      },
    });
    const { handler } = await getQuery();

    await expect(
      handler(ctx, { threadId: 'thread_1', agentId: 'claude-code' }),
    ).resolves.toEqual(EMPTY);
  });

  it('is empty when the project has no agentCapabilities at all', async () => {
    const { ctx } = createCtx({
      meta: { projectId: 'project_1' },
      project: { name: 'Apollo' },
    });
    const { handler } = await getQuery();

    await expect(
      handler(ctx, { threadId: 'thread_1', agentId: 'claude-code' }),
    ).resolves.toEqual(EMPTY);
  });

  it('resolves a rebuilt chat thread via threads.projectId, no metadata read', async () => {
    const { ctx, query } = createCtx({
      meta: null,
      chatThread: { projectId: 'project_1' },
      project: {
        agentCapabilities: {
          'claude-code': { skills: ['review'], connectors: ['tavily'] },
        },
      },
    });
    const { handler } = await getQuery();

    await expect(
      handler(ctx, { threadId: 'thread_1', agentId: 'claude-code' }),
    ).resolves.toEqual({ skills: ['review'], connectors: ['tavily'] });
    // The threads row answered — the legacy metadata table is never queried.
    expect(query).not.toHaveBeenCalled();
  });

  it('falls back to threadMetadata when the chat thread has no link', async () => {
    const { ctx } = createCtx({
      meta: { projectId: 'project_1' },
      chatThread: { title: 'no link here' },
      project: {
        agentCapabilities: {
          'claude-code': { skills: [], connectors: ['github'] },
        },
      },
    });
    const { handler } = await getQuery();

    await expect(
      handler(ctx, { threadId: 'thread_1', agentId: 'claude-code' }),
    ).resolves.toEqual({ skills: [], connectors: ['github'] });
  });
});
