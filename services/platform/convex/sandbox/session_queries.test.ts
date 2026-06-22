// Unit gate for latestAgentSessionId's per-THREAD + sinceStartedAt scoping.
// A per-user sandbox holds every thread's Claude conversation, so resume must
// pick THIS thread's last agentSessionId (by_threadId), bounded to the current
// session's lifetime (so a destroyed+recreated sandbox can't resume a stale
// conversation). Mocks the generated query factory so the handler is callable.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    internalQuery: (config: Record<string, unknown>) => config,
  };
});

import {
  latestAgentSessionId,
  listStaleWorkflowRunSessions,
} from './session_queries';

interface QueryHandler<TArgs, TReturn> {
  handler: (ctx: unknown, args: TArgs) => Promise<TReturn> | TReturn;
}

interface OpRow {
  threadId: string;
  startedAt: number;
  agentSessionId?: string;
}

function asyncIter<T>(rows: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const r of rows) yield r;
    },
  };
}

function createMockCtx(rows: OpRow[]) {
  function makeBuilder() {
    let threadId: string | undefined;
    const builder: Record<string | symbol, unknown> = {};
    builder.withIndex = vi.fn((_name: string, cb: (q: unknown) => unknown) => {
      const q = {
        eq: (field: string, value: unknown) => {
          if (field === 'threadId') threadId = value as string;
          return q;
        },
      };
      cb(q);
      return builder;
    });
    builder[Symbol.asyncIterator] = function () {
      return asyncIter(rows.filter((r) => r.threadId === threadId))[
        Symbol.asyncIterator
      ]();
    };
    return builder;
  }
  return { db: { query: vi.fn(() => makeBuilder()) } };
}

const q = latestAgentSessionId as unknown as QueryHandler<
  { threadId: string; sinceStartedAt?: number },
  string | null
>;

describe('latestAgentSessionId', () => {
  const T = 'thread-abc';

  it('returns the most recent handle for the thread when unscoped', async () => {
    const ctx = createMockCtx([
      { threadId: T, startedAt: 100, agentSessionId: 'old' },
      { threadId: T, startedAt: 200, agentSessionId: 'new' },
    ]);
    expect(await q.handler(ctx, { threadId: T })).toBe('new');
  });

  it("scopes to the thread — another thread's handle is ignored", async () => {
    const ctx = createMockCtx([
      { threadId: 'other-thread', startedAt: 300, agentSessionId: 'other' },
      { threadId: T, startedAt: 200, agentSessionId: 'mine' },
    ]);
    expect(await q.handler(ctx, { threadId: T })).toBe('mine');
  });

  it('excludes ops from before the current session (stale --resume fix)', async () => {
    // A prior sandbox left an op at t=100; the current session was created at
    // t=150 (workspace wiped) → no handle to resume.
    const ctx = createMockCtx([
      { threadId: T, startedAt: 100, agentSessionId: 'stale-prior-session' },
    ]);
    expect(await q.handler(ctx, { threadId: T, sinceStartedAt: 150 })).toBe(
      null,
    );
  });

  it('returns only the current session lifetime handle', async () => {
    const ctx = createMockCtx([
      { threadId: T, startedAt: 100, agentSessionId: 'stale' },
      { threadId: T, startedAt: 300, agentSessionId: 'current-turn-1' },
      { threadId: T, startedAt: 400, agentSessionId: 'current-turn-2' },
    ]);
    expect(await q.handler(ctx, { threadId: T, sinceStartedAt: 150 })).toBe(
      'current-turn-2',
    );
  });

  it('ignores ops with no captured agentSessionId', async () => {
    const ctx = createMockCtx([
      { threadId: T, startedAt: 300 },
      { threadId: T, startedAt: 200, agentSessionId: 'has-handle' },
    ]);
    expect(await q.handler(ctx, { threadId: T, sinceStartedAt: 150 })).toBe(
      'has-handle',
    );
  });

  it('treats a missing sinceStartedAt as unbounded', async () => {
    const ctx = createMockCtx([
      { threadId: T, startedAt: 1, agentSessionId: 'ancient' },
    ]);
    expect(await q.handler(ctx, { threadId: T })).toBe('ancient');
  });
});

interface SessionRow {
  organizationId: string;
  status: string;
  ownerType: string;
  sessionId: string;
  expiresAt: number;
  pinned?: boolean;
}

// Mock ctx for the org+status indexed scan: tracks both eq() fields and yields
// the rows matching the (organizationId, status) the handler is iterating.
function createSessionMockCtx(rows: SessionRow[]) {
  function makeBuilder() {
    let org: string | undefined;
    let status: string | undefined;
    const builder: Record<string | symbol, unknown> = {};
    builder.withIndex = vi.fn((_name: string, cb: (q: unknown) => unknown) => {
      const query = {
        eq: (field: string, value: unknown) => {
          if (field === 'organizationId') org = value as string;
          if (field === 'status') status = value as string;
          return query;
        },
      };
      cb(query);
      return builder;
    });
    builder[Symbol.asyncIterator] = function () {
      return asyncIter(
        rows.filter((r) => r.organizationId === org && r.status === status),
      )[Symbol.asyncIterator]();
    };
    return builder;
  }
  return { db: { query: vi.fn(() => makeBuilder()) } };
}

const stale = listStaleWorkflowRunSessions as unknown as QueryHandler<
  { organizationId: string; limit?: number },
  Array<{ sessionId: string }>
>;

describe('listStaleWorkflowRunSessions', () => {
  const ORG = 'org-1';
  const PAST = 1; // far in the past → expired
  const FUTURE = 8.64e15; // far future → not yet expired

  it('returns only expired, non-pinned workflow_run rows of the org', async () => {
    const ctx = createSessionMockCtx([
      // expired workflow_run rows across the scanned statuses → reaped
      {
        organizationId: ORG,
        status: 'active',
        ownerType: 'workflow_run',
        sessionId: 'wf-a',
        expiresAt: PAST,
      },
      {
        organizationId: ORG,
        status: 'stopped',
        ownerType: 'workflow_run',
        sessionId: 'wf-s',
        expiresAt: PAST,
      },
      // not expired yet → skipped
      {
        organizationId: ORG,
        status: 'active',
        ownerType: 'workflow_run',
        sessionId: 'wf-live',
        expiresAt: FUTURE,
      },
      // pinned → skipped
      {
        organizationId: ORG,
        status: 'active',
        ownerType: 'workflow_run',
        sessionId: 'wf-pin',
        expiresAt: PAST,
        pinned: true,
      },
      // other owner types → never reaped by this sweep
      {
        organizationId: ORG,
        status: 'active',
        ownerType: 'user',
        sessionId: 'usr-x',
        expiresAt: PAST,
      },
      {
        organizationId: ORG,
        status: 'active',
        ownerType: 'thread',
        sessionId: 'thr-x',
        expiresAt: PAST,
      },
      // another org → out of scope
      {
        organizationId: 'org-2',
        status: 'active',
        ownerType: 'workflow_run',
        sessionId: 'wf-other',
        expiresAt: PAST,
      },
    ]);
    const out = await stale.handler(ctx, { organizationId: ORG });
    expect(out.map((r) => r.sessionId).sort()).toEqual(['wf-a', 'wf-s']);
  });

  it('honors the limit', async () => {
    const ctx = createSessionMockCtx([
      {
        organizationId: ORG,
        status: 'active',
        ownerType: 'workflow_run',
        sessionId: 'wf-1',
        expiresAt: PAST,
      },
      {
        organizationId: ORG,
        status: 'active',
        ownerType: 'workflow_run',
        sessionId: 'wf-2',
        expiresAt: PAST,
      },
      {
        organizationId: ORG,
        status: 'active',
        ownerType: 'workflow_run',
        sessionId: 'wf-3',
        expiresAt: PAST,
      },
    ]);
    const out = await stale.handler(ctx, { organizationId: ORG, limit: 2 });
    expect(out).toHaveLength(2);
  });
});
