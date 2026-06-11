// Unit gate for latestAgentSessionId's `sinceStartedAt` scoping — the fix for
// stale --resume handles surviving a session teardown+recreate (the thread
// session id is deterministic, so old ops share the new session's id string).
// Mocks the generated query factory so the handler is callable directly.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    internalQuery: (config: Record<string, unknown>) => config,
  };
});

import { latestAgentSessionId } from './session_queries';

interface QueryHandler<TArgs, TReturn> {
  handler: (ctx: unknown, args: TArgs) => Promise<TReturn> | TReturn;
}

interface OpRow {
  sessionId: string;
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
    let sessionId: string | undefined;
    const builder: Record<string | symbol, unknown> = {};
    builder.withIndex = vi.fn((_name: string, cb: (q: unknown) => unknown) => {
      const q = {
        eq: (field: string, value: unknown) => {
          if (field === 'sessionId') sessionId = value as string;
          return q;
        },
      };
      cb(q);
      return builder;
    });
    builder[Symbol.asyncIterator] = function () {
      return asyncIter(rows.filter((r) => r.sessionId === sessionId))[
        Symbol.asyncIterator
      ]();
    };
    return builder;
  }
  return { db: { query: vi.fn(() => makeBuilder()) } };
}

const q = latestAgentSessionId as unknown as QueryHandler<
  { sessionId: string; sinceStartedAt?: number },
  string | null
>;

describe('latestAgentSessionId', () => {
  const SID = 'thr-abc';

  it('returns the most recent handle when unscoped', async () => {
    const ctx = createMockCtx([
      { sessionId: SID, startedAt: 100, agentSessionId: 'old' },
      { sessionId: SID, startedAt: 200, agentSessionId: 'new' },
    ]);
    expect(await q.handler(ctx, { sessionId: SID })).toBe('new');
  });

  it('excludes ops from before the current session (stale --resume fix)', async () => {
    // A prior session left an op at t=100; the current session was created at
    // t=150 and has no ops yet → no handle to resume (correct: empty workspace).
    const ctx = createMockCtx([
      { sessionId: SID, startedAt: 100, agentSessionId: 'stale-prior-session' },
    ]);
    expect(await q.handler(ctx, { sessionId: SID, sinceStartedAt: 150 })).toBe(
      null,
    );
  });

  it('returns only the current session lifetime handle', async () => {
    const ctx = createMockCtx([
      { sessionId: SID, startedAt: 100, agentSessionId: 'stale' },
      { sessionId: SID, startedAt: 300, agentSessionId: 'current-turn-1' },
      { sessionId: SID, startedAt: 400, agentSessionId: 'current-turn-2' },
    ]);
    expect(await q.handler(ctx, { sessionId: SID, sinceStartedAt: 150 })).toBe(
      'current-turn-2',
    );
  });

  it('ignores ops with no captured agentSessionId', async () => {
    const ctx = createMockCtx([
      { sessionId: SID, startedAt: 300 },
      { sessionId: SID, startedAt: 200, agentSessionId: 'has-handle' },
    ]);
    expect(await q.handler(ctx, { sessionId: SID, sinceStartedAt: 150 })).toBe(
      'has-handle',
    );
  });

  it('treats a missing sinceStartedAt as unbounded', async () => {
    const ctx = createMockCtx([
      { sessionId: SID, startedAt: 1, agentSessionId: 'ancient' },
    ]);
    expect(await q.handler(ctx, { sessionId: SID })).toBe('ancient');
  });
});
