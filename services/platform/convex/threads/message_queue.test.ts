import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Doc } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

const mockCreateStream = vi.fn();

vi.mock('@convex-dev/agent', () => ({
  saveMessage: vi.fn(),
}));

vi.mock('../_generated/api', () => ({
  components: {
    agent: { messages: { deleteByIds: 'mock-deleteByIds' } },
  },
  internal: {
    agents: {
      chat_turn_generate: { runChatTurnGeneration: 'mock-runChatTurn' },
    },
    node_only: {
      sandbox: { steer_delivery: { deliverSteerMessages: 'mock-deliver' } },
    },
  },
}));

vi.mock('../streaming/helpers', () => ({
  persistentStreaming: {
    createStream: (...args: unknown[]) => mockCreateStream(...args),
  },
}));

// Identity factory so registered functions expose their raw config (same
// pattern as session_queries.test.ts) — lets tests call handlers directly.
vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    internalMutation: (config: Record<string, unknown>) => config,
    internalQuery: (config: Record<string, unknown>) => config,
    query: (config: Record<string, unknown>) => config,
    mutation: (config: Record<string, unknown>) => config,
  };
});

// Public query/mutation handlers gate on auth + thread access; convexTest can't
// register betterAuth, so stub both to a fixed authorized user (see
// reference_convextest_components memory). Handlers are then callable directly.
vi.mock('../lib/rls/auth/get_auth_user_identity', () => ({
  getAuthUserIdentity: vi.fn().mockResolvedValue({ userId: 'user_1' }),
}));
vi.mock('../lib/rls/auth/can_access_thread', () => ({
  canAccessThread: vi.fn().mockResolvedValue({ _id: 'meta_1' }),
}));

import {
  listDeliveredForExec,
  listQueuedMessages,
  markConsumed,
  markDelivered,
  markStdinRedelivered,
  reconcileDelivered,
  settleQueueOnTurnEnd,
} from './message_queue';

interface MutationDef<TArgs, TReturn> {
  handler: (ctx: unknown, args: TArgs) => Promise<TReturn>;
}

const markConsumedHandler = (
  markConsumed as unknown as MutationDef<
    { threadId: string; messageIds: string[] },
    number
  >
).handler;

type Row = Record<string, unknown> & { _id: string };

/** Tiny in-memory convex db: filters rows by the eq() calls the index
 * callback makes, supports collect() + async iteration, and mutates rows
 * in place on patch so later reads inside one call see prior writes. */
function makeCtx(tables: Record<string, Row[]>) {
  const deleted: string[] = [];
  const applyIndex = (rows: Row[], cb?: (q: unknown) => unknown): Row[] => {
    if (!cb) return rows;
    const eqs: Array<[string, unknown]> = [];
    const q = {
      eq(field: string, value: unknown) {
        eqs.push([field, value]);
        return q;
      },
    };
    cb(q);
    return rows.filter((r) => eqs.every(([f, v]) => r[f] === v));
  };
  const ctx = {
    db: {
      query: (table: string) => ({
        withIndex: (_name: string, cb?: (q: unknown) => unknown) => {
          const rows = applyIndex(tables[table] ?? [], cb);
          return {
            collect: () => Promise.resolve([...rows]),
            first: () => Promise.resolve(rows[0] ?? null),
            [Symbol.asyncIterator]: function* () {
              yield* rows;
            } as unknown as () => AsyncIterator<Row>,
          };
        },
      }),
      patch: vi.fn((id: string, patch: Record<string, unknown>) => {
        for (const rows of Object.values(tables)) {
          const row = rows.find((r) => r._id === id);
          if (row) Object.assign(row, patch);
        }
        return Promise.resolve();
      }),
      delete: vi.fn((id: string) => {
        deleted.push(id);
        for (const rows of Object.values(tables)) {
          const i = rows.findIndex((r) => r._id === id);
          if (i >= 0) rows.splice(i, 1);
        }
        return Promise.resolve();
      }),
      get: vi.fn(),
      insert: vi.fn(),
    },
    scheduler: { runAfter: vi.fn().mockResolvedValue(undefined) },
    runMutation: vi.fn().mockResolvedValue(undefined),
  };
  return { ctx, deleted };
}

function queueRow(over: Partial<Row> & { messageId: string }): Row {
  return {
    _id: `q_${over.messageId}`,
    _creationTime: 1,
    organizationId: 'org_1',
    threadId: 'thread_1',
    userId: 'user_1',
    userEmail: 'u@example.com',
    userName: 'U',
    agentSlug: 'claude-coder',
    text: 'hello',
    status: 'queued',
    createdAt: 1,
    ...over,
  };
}

const meta = {
  _id: 'meta_1',
  threadId: 'thread_1',
} as unknown as Doc<'threadMetadata'>;

describe('markConsumed', () => {
  it('flips matching delivered rows and returns the count', async () => {
    const tables = {
      chatMessageQueue: [
        queueRow({ messageId: 'm1', status: 'delivered' }),
        queueRow({ messageId: 'm2', status: 'delivered' }),
      ],
    };
    const { ctx } = makeCtx(tables);
    const flipped = await markConsumedHandler(ctx, {
      threadId: 'thread_1',
      messageIds: ['m1', 'm2'],
    });
    expect(flipped).toBe(2);
    for (const row of tables.chatMessageQueue) {
      expect(row.status).toBe('consumed');
    }
  });

  it('returns 0 on a second call for the same ids — the seam-trip gate', async () => {
    // The drain trips the steer seam only on flipped > 0; the delivered-only
    // scan is what makes a replayed sentinel (or the marker+sentinel double
    // signal of a Stop-hook consumption) unable to seam twice.
    const tables = {
      chatMessageQueue: [queueRow({ messageId: 'm1', status: 'delivered' })],
    };
    const { ctx } = makeCtx(tables);
    expect(
      await markConsumedHandler(ctx, {
        threadId: 'thread_1',
        messageIds: ['m1'],
      }),
    ).toBe(1);
    expect(
      await markConsumedHandler(ctx, {
        threadId: 'thread_1',
        messageIds: ['m1'],
      }),
    ).toBe(0);
    expect(tables.chatMessageQueue[0]?.status).toBe('consumed');
  });

  it('counts only delivered rows among the requested ids', async () => {
    const tables = {
      chatMessageQueue: [
        queueRow({ messageId: 'm1', status: 'delivered' }),
        queueRow({ messageId: 'm2', status: 'queued' }),
        queueRow({ messageId: 'm3', status: 'consumed' }),
      ],
    };
    const { ctx } = makeCtx(tables);
    const flipped = await markConsumedHandler(ctx, {
      threadId: 'thread_1',
      messageIds: ['m1', 'm2', 'm3', 'm_unknown'],
    });
    expect(flipped).toBe(1);
    expect(tables.chatMessageQueue.map((r) => [r.messageId, r.status])).toEqual(
      [
        ['m1', 'consumed'],
        ['m2', 'queued'],
        ['m3', 'consumed'],
      ],
    );
  });
});

describe('settleQueueOnTurnEnd', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateStream.mockResolvedValue('stream_new');
  });

  it('returns drained:false on an empty queue and patches nothing', async () => {
    const { ctx } = makeCtx({ chatMessageQueue: [], sandboxSessionOps: [] });
    const result = await settleQueueOnTurnEnd(
      ctx as unknown as MutationCtx,
      meta,
      'stream_old',
    );
    expect(result).toEqual({ drained: false });
    expect(ctx.db.patch).not.toHaveBeenCalled();
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("deletes the ending stream's claimed batch and consumed rows, keeps others", async () => {
    const tables = {
      chatMessageQueue: [
        queueRow({
          messageId: 'm1',
          status: 'claimed',
          claimedByStreamId: 'stream_old',
        }),
        queueRow({
          messageId: 'm2',
          status: 'claimed',
          claimedByStreamId: 'stream_other',
        }),
        queueRow({ messageId: 'm3', status: 'consumed' }),
      ],
      sandboxSessionOps: [],
    };
    const { ctx, deleted } = makeCtx(tables);
    const result = await settleQueueOnTurnEnd(
      ctx as unknown as MutationCtx,
      meta,
      'stream_old',
    );
    expect(result).toEqual({ drained: false });
    expect(deleted).toEqual(['q_m1', 'q_m3']);
    expect(tables.chatMessageQueue.map((r) => r.messageId)).toEqual(['m2']);
  });

  it('drains queued rows: claims in order, combines text, keeps generating', async () => {
    const tables = {
      chatMessageQueue: [
        queueRow({
          messageId: 'm2',
          text: 'second',
          _creationTime: 2,
          createdAt: 2,
        }),
        queueRow({
          messageId: 'm1',
          text: 'first',
          _creationTime: 1,
          createdAt: 1,
        }),
      ],
      sandboxSessionOps: [],
    };
    const { ctx } = makeCtx(tables);
    const result = await settleQueueOnTurnEnd(
      ctx as unknown as MutationCtx,
      meta,
      'stream_old',
    );
    expect(result).toEqual({ drained: true });

    // Both rows claimed under the fresh stream.
    for (const row of tables.chatMessageQueue) {
      expect(row.status).toBe('claimed');
      expect(row.claimedByStreamId).toBe('stream_new');
    }
    // Thread stays generating on the new stream (no idle flicker).
    expect(ctx.db.patch).toHaveBeenCalledWith(
      'meta_1',
      expect.objectContaining({
        generationStatus: 'generating',
        streamId: 'stream_new',
      }),
    );
    // One combined turn, in creation order, prompt message = last row's.
    expect(ctx.scheduler.runAfter).toHaveBeenCalledTimes(1);
    const [, ref, args] = ctx.scheduler.runAfter.mock.calls[0] ?? [];
    expect(ref).toBe('mock-runChatTurn');
    expect(args).toMatchObject({
      threadId: 'thread_1',
      streamId: 'stream_new',
      message: 'first\n\nsecond',
      queuedPromptMessageId: 'm2',
      agentSlug: 'claude-coder',
    });
  });

  it('does not settle a claimed batch belonging to a different stream', async () => {
    const tables = {
      chatMessageQueue: [
        queueRow({
          messageId: 'm1',
          status: 'claimed',
          claimedByStreamId: 'stream_other',
        }),
      ],
      sandboxSessionOps: [],
    };
    const { ctx, deleted } = makeCtx(tables);
    await settleQueueOnTurnEnd(
      ctx as unknown as MutationCtx,
      meta,
      'stream_old',
    );
    expect(deleted).toEqual([]);
    expect(tables.chatMessageQueue[0]?.status).toBe('claimed');
  });

  it('self-heals delivered rows whose exec died (missed reconciliation) into the drain', async () => {
    const tables = {
      chatMessageQueue: [
        queueRow({
          messageId: 'm1',
          status: 'delivered',
          deliveredExecId: 'exec_dead',
          deliveredAt: 5,
        }),
        queueRow({
          messageId: 'm2',
          status: 'delivered',
          deliveredExecId: 'exec_live',
          deliveredAt: 6,
          _creationTime: 2,
        }),
      ],
      sandboxSessionOps: [
        {
          _id: 'op_1',
          threadId: 'thread_1',
          execId: 'exec_live',
          status: 'running',
        },
        {
          _id: 'op_2',
          threadId: 'thread_1',
          execId: 'exec_dead',
          status: 'cancelled',
        },
      ],
    };
    const { ctx } = makeCtx(tables);
    const result = await settleQueueOnTurnEnd(
      ctx as unknown as MutationCtx,
      meta,
      'stream_old',
    );
    // m1 rolled back to queued and drained; m2 still steerable, untouched.
    expect(result).toEqual({ drained: true });
    const m1 = tables.chatMessageQueue.find((r) => r.messageId === 'm1');
    const m2 = tables.chatMessageQueue.find((r) => r.messageId === 'm2');
    expect(m1?.status).toBe('claimed'); // re-queued, then claimed by the drain
    expect(m1?.deliveredExecId).toBeUndefined();
    expect(m2?.status).toBe('delivered');
    const [, , args] = ctx.scheduler.runAfter.mock.calls[0] ?? [];
    expect(args).toMatchObject({
      message: 'hello',
      queuedPromptMessageId: 'm1',
    });
  });
});

// --- delivery channel (stdin steering) --------------------------------------

interface QueryDef<TArgs, TReturn> {
  handler: (ctx: unknown, args: TArgs) => Promise<TReturn>;
}

const markDeliveredHandler = (
  markDelivered as unknown as MutationDef<
    {
      threadId: string;
      queueIds: string[];
      execId: string;
      channel?: 'file' | 'stdin';
    },
    null
  >
).handler;
const markStdinRedeliveredHandler = (
  markStdinRedelivered as unknown as MutationDef<
    { threadId: string; queueIds: string[] },
    null
  >
).handler;
const reconcileDeliveredHandler = (
  reconcileDelivered as unknown as MutationDef<
    { threadId: string; execId: string; consumedMessageIds: string[] },
    null
  >
).handler;
const listDeliveredForExecHandler = (
  listDeliveredForExec as unknown as QueryDef<
    { threadId: string; execId: string },
    Array<{ messageId: string; text: string; channel: string }>
  >
).handler;

describe('delivery channel stamping', () => {
  const opsTable = [
    { _id: 'op_1', threadId: 'thread_1', execId: 'exec_1', status: 'running' },
  ];

  it('markDelivered stamps the channel (and defaults to file)', async () => {
    const tables = {
      chatMessageQueue: [
        queueRow({ messageId: 'm1' }),
        queueRow({ messageId: 'm2' }),
      ],
      sandboxSessionOps: [...opsTable],
    };
    const { ctx } = makeCtx(tables);
    ctx.db.get.mockImplementation((id: string) =>
      Promise.resolve(tables.chatMessageQueue.find((r) => r._id === id)),
    );
    await markDeliveredHandler(ctx, {
      threadId: 'thread_1',
      queueIds: ['q_m1'],
      execId: 'exec_1',
      channel: 'stdin',
    });
    await markDeliveredHandler(ctx, {
      threadId: 'thread_1',
      queueIds: ['q_m2'],
      execId: 'exec_1',
    });
    const m1 = tables.chatMessageQueue.find((r) => r.messageId === 'm1');
    const m2 = tables.chatMessageQueue.find((r) => r.messageId === 'm2');
    expect(m1).toMatchObject({
      status: 'delivered',
      deliveredChannel: 'stdin',
    });
    expect(m2).toMatchObject({ status: 'delivered', deliveredChannel: 'file' });
  });

  it('markStdinRedelivered converts delivered rows only', async () => {
    const tables = {
      chatMessageQueue: [
        queueRow({
          messageId: 'm1',
          status: 'delivered',
          deliveredExecId: 'exec_1',
          deliveredChannel: 'file',
        }),
        queueRow({ messageId: 'm2', status: 'queued' }),
      ],
    };
    const { ctx } = makeCtx(tables);
    ctx.db.get.mockImplementation((id: string) =>
      Promise.resolve(tables.chatMessageQueue.find((r) => r._id === id)),
    );
    await markStdinRedeliveredHandler(ctx, {
      threadId: 'thread_1',
      queueIds: ['q_m1', 'q_m2'],
    });
    const m1 = tables.chatMessageQueue.find((r) => r.messageId === 'm1');
    const m2 = tables.chatMessageQueue.find((r) => r.messageId === 'm2');
    expect(m1?.deliveredChannel).toBe('stdin');
    expect(m2?.deliveredChannel).toBeUndefined();
    expect(m2?.status).toBe('queued');
  });

  it('listDeliveredForExec surfaces text + channel (file default for legacy rows)', async () => {
    const tables = {
      chatMessageQueue: [
        queueRow({
          messageId: 'm1',
          status: 'delivered',
          deliveredExecId: 'exec_1',
          deliveredChannel: 'stdin',
          text: 'via stdin',
        }),
        queueRow({
          messageId: 'm2',
          status: 'delivered',
          deliveredExecId: 'exec_1',
          text: 'legacy file row',
        }),
        queueRow({
          messageId: 'm3',
          status: 'delivered',
          deliveredExecId: 'exec_other',
        }),
      ],
    };
    const { ctx } = makeCtx(tables);
    const rows = await listDeliveredForExecHandler(ctx, {
      threadId: 'thread_1',
      execId: 'exec_1',
    });
    expect(rows.map((r) => [r.messageId, r.channel, r.text])).toEqual([
      ['m1', 'stdin', 'via stdin'],
      ['m2', 'file', 'legacy file row'],
    ]);
  });

  it('reconcileDelivered rollback clears the channel; confirm keeps consumed', async () => {
    const tables = {
      chatMessageQueue: [
        queueRow({
          messageId: 'm1',
          status: 'delivered',
          deliveredExecId: 'exec_1',
          deliveredChannel: 'stdin',
          deliveredAt: 5,
        }),
        queueRow({
          messageId: 'm2',
          status: 'delivered',
          deliveredExecId: 'exec_1',
          deliveredChannel: 'file',
          deliveredAt: 5,
        }),
      ],
    };
    const { ctx } = makeCtx(tables);
    await reconcileDeliveredHandler(ctx, {
      threadId: 'thread_1',
      execId: 'exec_1',
      consumedMessageIds: ['m2'],
    });
    const m1 = tables.chatMessageQueue.find((r) => r.messageId === 'm1');
    const m2 = tables.chatMessageQueue.find((r) => r.messageId === 'm2');
    // Unconfirmed stdin row rolls back clean — re-queued for the boundary drain.
    expect(m1).toMatchObject({ status: 'queued' });
    expect(m1?.deliveredChannel).toBeUndefined();
    expect(m1?.deliveredExecId).toBeUndefined();
    expect(m2?.status).toBe('consumed');
  });
});

describe('listQueuedMessages', () => {
  const listQueuedMessagesHandler = (
    listQueuedMessages as unknown as MutationDef<
      { threadId: string; organizationId?: string },
      Array<{ messageId: string; text: string; createdAt: number }>
    >
  ).handler;

  it('returns the message text and sorts by createdAt (send order)', async () => {
    const tables = {
      chatMessageQueue: [
        queueRow({ messageId: 'm3', text: 'third', createdAt: 30 }),
        queueRow({ messageId: 'm1', text: 'first', createdAt: 10 }),
        queueRow({ messageId: 'm2', text: 'second', createdAt: 20 }),
      ],
    };
    const { ctx } = makeCtx(tables);
    const result = await listQueuedMessagesHandler(ctx, {
      threadId: 'thread_1',
    });
    expect(result.map((r) => r.messageId)).toEqual(['m1', 'm2', 'm3']);
    expect(result.map((r) => r.text)).toEqual(['first', 'second', 'third']);
  });
});
