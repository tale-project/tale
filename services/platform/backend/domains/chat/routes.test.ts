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
  searchApprovedMemories,
  saveMemory,
  deleteMemory,
  cancelDeferredSendsForThread,
  emitHintInTx,
} = vi.hoisted(() => ({
  trashThread: vi.fn(),
  listArchivedThreads: vi.fn(),
  searchApprovedMemories: vi.fn(),
  saveMemory: vi.fn(),
  deleteMemory: vi.fn(),
  cancelDeferredSendsForThread: vi.fn(),
  emitHintInTx: vi.fn(),
}));

vi.mock('./threads.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./threads.ts')>()),
  trashThread,
  listArchivedThreads,
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
import { MemoryError } from './memories.ts';
import { createChatRoutes } from './routes.ts';

function makeApp(sql: unknown = {}) {
  return createChatRoutes({ sql: sql as never, auth: {} as never });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(() => {
  vi.clearAllMocks();
  emitHintInTx.mockResolvedValue(undefined);
  cancelDeferredSendsForThread.mockResolvedValue(0);
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
