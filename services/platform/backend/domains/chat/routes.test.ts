// @vitest-environment node

/**
 * The chat routes' boundary behaviours, on a fake `sql` and stubbed session
 * + membership: what a door validates before the domain sees the call, and
 * which domain cascades a door triggers.
 */

import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const {
  trashThread,
  listArchivedThreads,
  branchForEdit,
  branchForRegenerate,
  setBranchSelection,
  assertChatTurnBudget,
  getArenaPair,
  hasLiveGeneration,
  isBackendDraining,
  runChatTurn,
  appendMessageRow,
  searchApprovedMemories,
  saveMemory,
  deleteMemory,
  cancelDeferredSendsForThread,
  emitHintInTx,
  bulkUpdateThreads,
} = vi.hoisted(() => ({
  trashThread: vi.fn(),
  listArchivedThreads: vi.fn(),
  branchForEdit: vi.fn(),
  branchForRegenerate: vi.fn(),
  setBranchSelection: vi.fn(),
  assertChatTurnBudget: vi.fn(),
  getArenaPair: vi.fn(),
  hasLiveGeneration: vi.fn(),
  isBackendDraining: vi.fn(),
  runChatTurn: vi.fn(),
  appendMessageRow: vi.fn(),
  searchApprovedMemories: vi.fn(),
  saveMemory: vi.fn(),
  deleteMemory: vi.fn(),
  cancelDeferredSendsForThread: vi.fn(),
  emitHintInTx: vi.fn(),
  bulkUpdateThreads: vi.fn(),
}));

vi.mock('./bulk.ts', () => ({ bulkUpdateThreads }));

vi.mock('./threads.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./threads.ts')>()),
  trashThread,
  listArchivedThreads,
  branchForEdit,
  branchForRegenerate,
  setBranchSelection,
}));
vi.mock('./budget-admission.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./budget-admission.ts')>()),
  assertChatTurnBudget,
}));
vi.mock('./arena.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./arena.ts')>()),
  getArenaPair,
  hasLiveGeneration,
}));
vi.mock('../control/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../control/service.ts')>()),
  isBackendDraining,
}));
vi.mock('./service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./service.ts')>()),
  runChatTurn,
}));
vi.mock('./store.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./store.ts')>()),
  appendMessageRow,
}));
vi.mock('./memories.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./memories.ts')>()),
  searchApprovedMemories,
  saveMemory,
  deleteMemory,
}));
vi.mock('./deferred-sends.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./deferred-sends.ts')>()),
  cancelDeferredSendsForThread,
}));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx }));

vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', {
        user: { id: 'u1', email: 'u@example.test' },
      } as never);
      await next();
    },
}));

vi.mock('../../auth/org.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth/org.ts')>();
  return {
    ...actual,
    requireOrgMember:
      () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
        c.set('orgId', 'o1');
        c.set('orgMember', { role: 'member' } as never);
        await next();
      },
  };
});

import { endAllEventStreams } from '../../realtime/sse.ts';
import { ChatBudgetExceededError } from './budget-admission.ts';
import { MemoryError } from './memories.ts';
import { createChatRoutes } from './routes.ts';

function makeApp(sql: unknown = {}) {
  return createChatRoutes({ sql: sql as never, auth: {} as never });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A reached cap, as the admission names it. */
function budgetExceeded(): ChatBudgetExceededError {
  return new ChatBudgetExceededError({
    code: 'BUDGET_EXCEEDED',
    message: 'Usage limit reached. Your monthly cost limit is used up.',
    scope: 'user',
    limitCode: 'COST_LIMIT',
    period: 'monthly',
    used: 500,
    limit: 500,
    resetsAt: Date.now() + 60_000,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  emitHintInTx.mockResolvedValue(undefined);
  cancelDeferredSendsForThread.mockResolvedValue(0);
  assertChatTurnBudget.mockResolvedValue(undefined);
});

/**
 * An edit or regenerate is a fork PLUS a turn. A cap that would refuse the
 * turn refuses the fork first: nothing is created and nothing is selected,
 * so a refused edit never strands the view on a prefix-only sibling.
 */
describe('the edit / regenerate forks measure the budget before forking', () => {
  const post = (route: string, body: unknown) =>
    makeApp().request(`${route}?orgId=o1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('answers 429 BUDGET_EXCEEDED on branch-edit without forking', async () => {
    assertChatTurnBudget.mockRejectedValueOnce(budgetExceeded());
    const res = await post('/threads/t1/branch-edit', {
      editedMessageId: 'm1',
    });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toMatch(/^\d+$/);
    await expect(res.json()).resolves.toMatchObject({
      error: 'BUDGET_EXCEEDED',
      message: expect.stringContaining('Usage limit reached'),
      data: { scope: 'user', limitCode: 'COST_LIMIT' },
    });
    expect(assertChatTurnBudget).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'o1',
      userId: 'u1',
    });
    expect(branchForEdit).not.toHaveBeenCalled();
    expect(emitHintInTx).not.toHaveBeenCalled();
  });

  it('answers 429 BUDGET_EXCEEDED on branch-regenerate without forking', async () => {
    assertChatTurnBudget.mockRejectedValueOnce(budgetExceeded());
    const res = await post('/threads/t1/branch-regenerate', {
      assistantMessageId: 'm2',
    });
    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toMatchObject({
      error: 'BUDGET_EXCEEDED',
    });
    expect(branchForRegenerate).not.toHaveBeenCalled();
    expect(emitHintInTx).not.toHaveBeenCalled();
  });

  it('forks when every cap has room, answering the sibling AND its fork point', async () => {
    // The door passes the domain's fork point through: forked from `t1`,
    // the sibling may hang off t1's own parent (another version of the
    // same turn), and the client keys its selection on THAT id.
    branchForEdit.mockResolvedValueOnce({
      id: 'b1',
      parentId: 't0',
      forkSequence: 2,
    });
    const res = await post('/threads/t1/branch-edit', {
      editedMessageId: 'm1',
    });
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({
      id: 'b1',
      parentId: 't0',
      forkSequence: 2,
    });
    expect(branchForEdit).toHaveBeenCalledWith(
      expect.anything(),
      'o1',
      'u1',
      't1',
      'm1',
    );
  });

  it('answers the regenerate fork point the same way', async () => {
    branchForRegenerate.mockResolvedValueOnce({
      id: 'b2',
      parentId: 't1',
      forkSequence: 4,
    });
    const res = await post('/threads/t1/branch-regenerate', {
      assistantMessageId: 'm2',
    });
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({
      id: 'b2',
      parentId: 't1',
      forkSequence: 4,
    });
  });

  it('lets a non-budget admission failure surface as an error, not a fork', async () => {
    assertChatTurnBudget.mockRejectedValueOnce(new Error('db down'));
    const res = await post('/threads/t1/branch-regenerate', {
      assistantMessageId: 'm2',
    });
    expect(res.status).toBe(500);
    expect(branchForRegenerate).not.toHaveBeenCalled();
  });
});

/**
 * A selection flip lands every key it needs in ONE write; the single-key
 * shape stays for an older tab.
 */
describe('POST /threads/:threadId/branch-selection body', () => {
  const post = (route: string, body?: string) =>
    makeApp().request(`${route}?orgId=o1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body } : {}),
    });

  it('writes a selection chain in one call, and wraps the single-key shape', async () => {
    setBranchSelection.mockResolvedValue(undefined);
    const chain = [
      { forkKey: 't1:2', selectedThreadId: 'b1' },
      { forkKey: 'b1:2', selectedThreadId: 'b2' },
    ];
    const res = await post(
      '/threads/t1/branch-selection',
      JSON.stringify({ selections: chain }),
    );
    expect(res.status).toBe(200);
    expect(setBranchSelection).toHaveBeenLastCalledWith(
      expect.anything(),
      'o1',
      'u1',
      't1',
      chain,
    );

    await post(
      '/threads/t1/branch-selection',
      JSON.stringify({ forkKey: 't1:2', selectedThreadId: 'b1' }),
    );
    expect(setBranchSelection).toHaveBeenLastCalledWith(
      expect.anything(),
      'o1',
      'u1',
      't1',
      [{ forkKey: 't1:2', selectedThreadId: 'b1' }],
    );
  });
});

/**
 * The arena fan-out is admitted as ONE unit: room for both requests is
 * measured up front and a reached cap refuses the pair (never one column),
 * each column's open leaves its partner's hold out of its own measure, and
 * a side that still loses its open names the cap with its stable code.
 */
describe('POST /threads/:threadId/arena/turn admits the pair', () => {
  /** `ownedThread` reads the thread through the fake pool. */
  const ownedSql = () => [
    {
      id: 't1',
      title: null,
      projectId: null,
      generationStatus: null,
      createdAt: 1,
      updatedAt: 1,
    },
  ];
  const turn = () =>
    makeApp(ownedSql).request('/threads/t1/arena/turn?orgId=o1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userText: 'compare this',
        modelIdA: 'model-a',
        modelIdB: 'model-b',
      }),
    });

  beforeEach(() => {
    getArenaPair.mockResolvedValue({
      pairId: 'p1',
      threadIdA: 't1',
      threadIdB: 't2',
      createdAt: 1,
    });
    hasLiveGeneration.mockResolvedValue(false);
    isBackendDraining.mockResolvedValue(false);
    runChatTurn.mockResolvedValue({ status: 'completed' });
    appendMessageRow.mockResolvedValue({ id: 'err_row', sequence: 3 });
  });

  it('measures room for two requests and refuses the whole pair on a reached cap', async () => {
    assertChatTurnBudget.mockRejectedValueOnce(budgetExceeded());
    const res = await turn();
    expect(res.status).toBe(200);
    const refused = {
      status: 'refused',
      code: 'BUDGET_EXCEEDED',
      persisted: false,
    };
    await expect(res.json()).resolves.toMatchObject({
      a: refused,
      b: refused,
    });
    expect(assertChatTurnBudget).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'o1',
      userId: 'u1',
      prospectiveRequests: 2,
    });
    expect(runChatTurn).not.toHaveBeenCalled();
    expect(appendMessageRow).not.toHaveBeenCalled();
  });

  it('lets each column leave its partner’s hold out of its own admission', async () => {
    const res = await turn();
    await expect(res.json()).resolves.toEqual({
      a: { status: 'completed' },
      b: { status: 'completed' },
    });
    expect(runChatTurn).toHaveBeenCalledTimes(2);
    expect(runChatTurn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        threadId: 't1',
        modelId: 'model-a',
        admissionExclude: { threadId: 't2' },
      }),
    );
    expect(runChatTurn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        threadId: 't2',
        modelId: 'model-b',
        admissionExclude: { threadId: 't1' },
      }),
    );
  });

  it('names the cap on a side whose open still lost, on its own record', async () => {
    runChatTurn.mockImplementation(
      async (_sql: unknown, request: { threadId: string }) => {
        if (request.threadId === 't2') throw budgetExceeded();
        return { status: 'completed' };
      },
    );
    const res = await turn();
    await expect(res.json()).resolves.toMatchObject({
      a: { status: 'completed' },
      b: { status: 'refused', code: 'BUDGET_EXCEEDED', persisted: true },
    });
    expect(appendMessageRow).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        threadId: 't2',
        role: 'assistant',
        model: 'model-b',
      }),
    );
  });
});

describe('POST /threads/bulk', () => {
  it('binds the bulk operation to the authenticated owner and organization', async () => {
    bulkUpdateThreads.mockResolvedValue({ changedIds: [], failed: 2 });
    const res = await makeApp().request('/threads/bulk?orgId=o1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: 'trash',
        userId: 'foreign-user',
        organizationId: 'foreign-org',
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ changed: 0, failed: 2 });
    expect(bulkUpdateThreads).toHaveBeenCalledWith(
      expect.anything(),
      {
        organizationId: 'o1',
        userId: 'u1',
        email: 'u@example.test',
      },
      'trash',
    );
  });

  it('rejects unknown operations without invoking the domain', async () => {
    const res = await makeApp().request('/threads/bulk?orgId=o1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: 'permanent-delete' }),
    });
    expect(res.status).toBe(400);
    expect(bulkUpdateThreads).not.toHaveBeenCalled();
  });
});

describe('POST /threads/:threadId/trash', () => {
  it('cancels the parked sends of a thread it trashed', async () => {
    trashThread.mockResolvedValue(true);

    const res = await makeApp().request('/threads/t1/trash?orgId=o1', {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(cancelDeferredSendsForThread).toHaveBeenCalledWith(
      expect.anything(),
      { organizationId: 'o1', userId: 'u1', threadId: 't1' },
    );
  });

  it('leaves the parked sends alone when the thread did not trash', async () => {
    trashThread.mockResolvedValue(false);

    const res = await makeApp().request('/threads/t1/trash?orgId=o1', {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: false });
    expect(cancelDeferredSendsForThread).not.toHaveBeenCalled();
  });
});

describe('GET /threads/archived — the numeric query params are a boundary', () => {
  beforeEach(() => {
    listArchivedThreads.mockResolvedValue({ rows: [], nextCursor: null });
  });

  it('coerces well-formed cursor and limit', async () => {
    const res = await makeApp().request(
      '/threads/archived?orgId=o1&cursor=1700000000000&limit=10',
    );

    expect(res.status).toBe(200);
    expect(listArchivedThreads).toHaveBeenCalledWith(
      expect.anything(),
      'o1',
      'u1',
      { cursor: 1_700_000_000_000, limit: 10 },
    );
  });

  it('answers 400 to a malformed cursor instead of binding NaN', async () => {
    const res = await makeApp().request(
      '/threads/archived?orgId=o1&cursor=abc',
    );

    expect(res.status).toBe(400);
    expect(listArchivedThreads).not.toHaveBeenCalled();
  });

  it('answers 400 to a limit outside the page ceiling', async () => {
    const res = await makeApp().request('/threads/archived?orgId=o1&limit=500');

    expect(res.status).toBe(400);
    expect(listArchivedThreads).not.toHaveBeenCalled();
  });
});

describe('GET /memories/search — the limit is a boundary', () => {
  beforeEach(() => {
    searchApprovedMemories.mockResolvedValue([]);
  });

  it('passes a well-formed query and limit through', async () => {
    const res = await makeApp().request(
      '/memories/search?orgId=o1&q=metric&limit=5',
    );

    expect(res.status).toBe(200);
    expect(searchApprovedMemories).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'o1',
      userId: 'u1',
      query: 'metric',
      limit: 5,
    });
  });

  it('answers 400 to a malformed limit instead of silently returning nothing', async () => {
    const res = await makeApp().request(
      '/memories/search?orgId=o1&q=metric&limit=abc',
    );

    expect(res.status).toBe(400);
    expect(searchApprovedMemories).not.toHaveBeenCalled();
  });
});

describe('GET /threads/:threadId/stream — enrolled in the shutdown drain', () => {
  it('ends with every other SSE stream when the process drains', async () => {
    // A tagged-template `sql` stub: the owned-thread read answers a thread,
    // the generation read answers idle, everything else is empty.
    const sql = (strings: TemplateStringsArray): Promise<unknown[]> => {
      const text = strings.join('?');
      if (text.includes('FROM app.threads t')) {
        return Promise.resolve([{ id: 't1', title: null }]);
      }
      return Promise.resolve([]);
    };

    const res = await makeApp(sql).request('/threads/t1/stream?orgId=o1');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body?.getReader();
    if (!reader) throw new Error('no body');
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain('event: idle');

    // The chat lane is in the same registry as `/events`: draining ends it,
    // and its loop — which otherwise runs until the client leaves — exits.
    expect(endAllEventStreams()).toBe(1);
    await expect(
      Promise.race([
        reader
          .read()
          .then((chunk) => (chunk.done ? 'ended' : 'data'))
          .catch(() => 'ended'),
        sleep(2_000).then(() => 'timeout'),
      ]),
    ).resolves.toBe('ended');
    // Unregistered on the way out: nothing left to drain.
    expect(endAllEventStreams()).toBe(0);
  });
});

describe('the memory doors', () => {
  it('answers a refused proposal with its code and status, not a 500', async () => {
    saveMemory.mockRejectedValue(
      new MemoryError('MEMORIES_DISABLED', 'Memories are turned off.', 403),
    );

    const res = await makeApp().request('/memories?orgId=o1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'Prefers metric units' }),
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: 'MEMORIES_DISABLED',
      message: 'Memories are turned off.',
    });
  });

  it('deletes a memory of the caller through DELETE /memories/:id', async () => {
    deleteMemory.mockResolvedValue(true);

    const res = await makeApp().request('/memories/mem_1?orgId=o1', {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(deleteMemory).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'o1',
      userId: 'u1',
      memoryId: 'mem_1',
    });
  });
});
