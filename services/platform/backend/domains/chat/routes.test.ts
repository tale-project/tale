// @vitest-environment node

/**
 * The chat routes' boundary behaviours, on a fake `sql` and stubbed session
 * + membership: what a door validates before the domain sees the call, and
 * which domain cascades a door triggers.
 */

import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const { trashThread, cancelDeferredSendsForThread, emitHintInTx } = vi.hoisted(
  () => ({
    trashThread: vi.fn(),
    cancelDeferredSendsForThread: vi.fn(),
    emitHintInTx: vi.fn(),
  }),
);

vi.mock('./threads.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./threads.ts')>()),
  trashThread,
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

import { createChatRoutes } from './routes.ts';

function makeApp() {
  return createChatRoutes({ sql: {} as never, auth: {} as never });
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
