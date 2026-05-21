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
  finalize,
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
  installingRows?: FakeRow[];
  completedTodayRows?: FakeRow[];
}

function createMockCtx(opts: MockCtxOptions = {}) {
  const runningRows = opts.runningRows ?? [];
  const queuedRows = opts.queuedRows ?? [];
  const installingRows = opts.installingRows ?? [];
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
    const resolveRows = (): FakeRow[] => {
      const status = calls.find((c) => c.field === 'status')?.value;
      if (status === 'running') return runningRows;
      if (status === 'queued') return queuedRows;
      if (status === 'installing') return installingRows;
      // No status filter → completedToday daily-budget scan
      return [
        ...completedRows,
        ...runningRows,
        ...queuedRows,
        ...installingRows,
      ];
    };
    // Watchdog uses `.take(N)` to bound the per-status scan. Tests deal in
    // tens of rows so we just return everything (cap=200 production value).
    builder.take = vi.fn(async (_n: number) => resolveRows());
    // The mutation iterates the builder directly with `for await` for the
    // reserveSlotAndInsert quota scan path.
    builder[Symbol.asyncIterator] = function () {
      return asyncIter(resolveRows())[Symbol.asyncIterator]();
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
    });
    // lifecycleStatus is no longer persisted — confirm it isn't smuggled
    // back in by a future regression.
    expect(insertedRows[0]).not.toHaveProperty('lifecycleStatus');
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

  it('rejects when queued rows alone fill the cap (leaked-slot defence)', async () => {
    const queued: FakeRow[] = Array.from(
      { length: SANDBOX_MAX_CONCURRENT_PER_ORG },
      (_v, i) => ({
        _id: `q${i}`,
        _creationTime: Date.now() - 500,
        status: 'queued',
        estimatedSeconds: 30,
        heartbeatAt: Date.now(),
      }),
    );
    const { ctx } = createMockCtx({ queuedRows: queued });
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
  // Cutoff = max_timeout (300s) + 10 min upload tail = 900s = 15 min. Tests
  // use 20 min to comfortably clear the threshold.
  const STALE_HEARTBEAT_AGE_MS = 20 * 60_000;

  it('flips running rows whose heartbeat is older than the watchdog cutoff', async () => {
    const stale: FakeRow = {
      _id: 'stuck1',
      _creationTime: Date.now() - 3_600_000,
      status: 'running',
      estimatedSeconds: 120,
      heartbeatAt: Date.now() - STALE_HEARTBEAT_AGE_MS,
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

  it('also flips queued rows whose heartbeat is older than the watchdog cutoff', async () => {
    // Captures the "throw between reserveSlotAndInsert and setRunning" leak.
    const stale: FakeRow = {
      _id: 'queuedStuck',
      _creationTime: Date.now() - 3_600_000,
      status: 'queued',
      estimatedSeconds: 60,
      heartbeatAt: Date.now() - STALE_HEARTBEAT_AGE_MS,
    };
    const { ctx } = createMockCtx({ queuedRows: [stale] });
    const mut = recoverStuckSandboxes as unknown as MutHandler<
      Record<string, unknown>,
      number
    >;
    const count = await mut.handler(ctx, {});
    expect(count).toBe(1);
    expect(ctx.db.patch).toHaveBeenCalledWith(
      'queuedStuck',
      expect.objectContaining({
        status: 'failed',
        errorCode: 'SPAWNER_UNAVAILABLE',
      }),
    );
  });
});

describe('finalize', () => {
  const baseArgs = {
    executionId: 'exec_1' as never,
    status: 'completed' as const,
    outputFiles: [],
    durationMs: 1000,
    actualSeconds: 1,
  };

  it('refuses to overwrite a terminal row (watchdog-vs-action race)', async () => {
    const mut = finalize as unknown as MutHandler<typeof baseArgs, null>;
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: 'exec_1',
          status: 'failed',
          errorCode: 'SPAWNER_UNAVAILABLE',
        })),
        patch: vi.fn(),
      },
    };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await mut.handler(ctx, baseArgs);
    expect(result).toBeNull();
    expect(ctx.db.patch).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('patches when the row is still in-flight', async () => {
    const mut = finalize as unknown as MutHandler<typeof baseArgs, null>;
    const ctx = {
      db: {
        get: vi.fn(async () => ({ _id: 'exec_1', status: 'running' })),
        patch: vi.fn(),
      },
    };
    await mut.handler(ctx, baseArgs);
    expect(ctx.db.patch).toHaveBeenCalledWith(
      'exec_1',
      expect.objectContaining({ status: 'completed' }),
    );
  });
});
