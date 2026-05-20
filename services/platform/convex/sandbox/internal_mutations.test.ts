// R1.22 #3 — atomic quota mutation regression gate. Mocks the convex
// generated layer (same pattern as file_metadata/internal_mutations.test.ts)
// so the mutation body is unit-testable without a running backend.

import { ConvexError } from 'convex/values';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    // The mutation factory just hands the config straight through so we
    // can call `.handler(ctx, args)` from tests.
    internalMutation: (config: Record<string, unknown>) => config,
  };
});

import {
  reserveSlotAndInsert,
  recoverStuckSandboxes,
} from './internal_mutations';
import { SANDBOX_MAX_CONCURRENT_PER_ORG } from './schema';

interface MutHandler<TArgs, TReturn> {
  handler: (ctx: unknown, args: TArgs) => Promise<TReturn> | TReturn;
}

function asyncIter<T>(rows: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const r of rows) yield r;
    },
  };
}

interface FakeRow {
  estimatedSeconds: number;
  _creationTime: number;
  status: string;
  actualSeconds?: number;
  _id: string;
  heartbeatAt: number;
}

interface MockCtxOptions {
  runningRows?: FakeRow[];
  queuedRows?: FakeRow[];
  completedTodayRows?: FakeRow[];
}

function createMockCtx(opts: MockCtxOptions = {}) {
  const runningRows = opts.runningRows ?? [];
  const queuedRows = opts.queuedRows ?? [];
  const completedRows = opts.completedTodayRows ?? [];
  const insertedRows: Record<string, unknown>[] = [];

  // The fluent `.withIndex` chain — store the eq() args so the handler
  // returning the right async iterator can be selected.
  function makeBuilder() {
    const calls: Array<Record<string, unknown>> = [];
    const builder: Record<string | symbol, unknown> = {};
    builder.withIndex = vi.fn((_name: string, cb: (q: unknown) => unknown) => {
      const q = {
        eq: (field: string, value: unknown) => {
          calls.push({ field, value });
          return q;
        },
      };
      cb(q);
      return builder;
    });
    builder.order = vi.fn(() => builder);
    // The mutation iterates the builder directly with `for await`.
    builder[Symbol.asyncIterator] = function () {
      const status = calls.find((c) => c.field === 'status')?.value;
      if (status === 'running')
        return asyncIter(runningRows)[Symbol.asyncIterator]();
      if (status === 'queued')
        return asyncIter(queuedRows)[Symbol.asyncIterator]();
      // No status filter → completedToday daily-budget scan
      return asyncIter([...completedRows, ...runningRows])[
        Symbol.asyncIterator
      ]();
    };
    return builder;
  }

  return {
    ctx: {
      db: {
        query: vi.fn(() => makeBuilder()),
        insert: vi.fn(
          async (_table: string, payload: Record<string, unknown>) => {
            insertedRows.push(payload);
            return `exec_${insertedRows.length}`;
          },
        ),
        get: vi.fn(),
        patch: vi.fn(),
      },
    },
    insertedRows,
  };
}

describe('reserveSlotAndInsert', () => {
  const baseArgs = {
    organizationId: 'org_alpha',
    uploadedBy: 'user_1',
    language: 'python' as const,
    codePreview: 'print("hi")',
    packages: [],
    estimatedSeconds: 30,
  };

  it('inserts a row when no in-flight and budget has room', async () => {
    const { ctx, insertedRows } = createMockCtx();
    const mut = reserveSlotAndInsert as unknown as MutHandler<
      typeof baseArgs,
      string
    >;
    const id = await mut.handler(ctx, baseArgs);
    expect(id).toBe('exec_1');
    expect(insertedRows[0]).toMatchObject({
      organizationId: 'org_alpha',
      status: 'queued',
      estimatedSeconds: 30,
      lifecycleStatus: 'active',
    });
  });

  it(`rejects when running count is already at the cap (${SANDBOX_MAX_CONCURRENT_PER_ORG})`, async () => {
    const running: FakeRow[] = Array.from(
      { length: SANDBOX_MAX_CONCURRENT_PER_ORG },
      (_v, i) => ({
        _id: `r${i}`,
        _creationTime: Date.now() - 1000,
        status: 'running',
        estimatedSeconds: 30,
        heartbeatAt: Date.now(),
      }),
    );
    const { ctx } = createMockCtx({ runningRows: running });
    const mut = reserveSlotAndInsert as unknown as MutHandler<
      typeof baseArgs,
      string
    >;
    await expect(mut.handler(ctx, baseArgs)).rejects.toBeInstanceOf(
      ConvexError,
    );
  });

  it('rejects when daily CPU budget pre-debit overflows', async () => {
    // 4 prior runs of 500s each = 2000s; cap is 1800s → next call should reject.
    const completed: FakeRow[] = Array.from({ length: 4 }, (_v, i) => ({
      _id: `c${i}`,
      _creationTime: Date.now() - 60_000,
      status: 'completed',
      estimatedSeconds: 500,
      actualSeconds: 500,
      heartbeatAt: Date.now(),
    }));
    const { ctx } = createMockCtx({ completedTodayRows: completed });
    const mut = reserveSlotAndInsert as unknown as MutHandler<
      typeof baseArgs,
      string
    >;
    await expect(
      mut.handler(ctx, { ...baseArgs, estimatedSeconds: 30 }),
    ).rejects.toThrow(/budget/i);
  });
});

describe('recoverStuckSandboxes', () => {
  it('flips running rows whose heartbeat is older than 2× max-timeout', async () => {
    const stale: FakeRow = {
      _id: 'stuck1',
      _creationTime: Date.now() - 3_600_000,
      status: 'running',
      estimatedSeconds: 120,
      heartbeatAt: Date.now() - 11 * 60_000,
    };
    const fresh: FakeRow = {
      _id: 'live1',
      _creationTime: Date.now() - 60_000,
      status: 'running',
      estimatedSeconds: 60,
      heartbeatAt: Date.now() - 5_000,
    };
    const { ctx } = createMockCtx({ runningRows: [stale, fresh] });
    const mut = recoverStuckSandboxes as unknown as MutHandler<
      Record<string, unknown>,
      number
    >;
    const count = await mut.handler(ctx, {});
    expect(count).toBe(1);
    expect(ctx.db.patch).toHaveBeenCalledWith(
      'stuck1',
      expect.objectContaining({
        status: 'failed',
        errorCode: 'SPAWNER_UNAVAILABLE',
      }),
    );
    expect(ctx.db.patch).not.toHaveBeenCalledWith('live1', expect.anything());
  });
});
