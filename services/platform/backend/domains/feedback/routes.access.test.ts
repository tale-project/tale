// @vitest-environment node

/**
 * The vote door answers a message outside the caller's reach with one opaque
 * 404 — the same status for "no such message", "another organization's" and
 * "not your thread", so a member cannot probe a foreign message id by voting
 * on it.
 */

import type { Context } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

vi.mock('@tale/shared/db/serializable', () => ({
  transactSerializable: (_sql: unknown, fn: (tx: unknown) => unknown) => {
    // A `tx` whose every statement finds nothing: the named message does not
    // exist in the caller's organization.
    const tag = (): Promise<unknown[]> => Promise.resolve([]);
    Object.assign(tag, { json: (value: unknown) => value });
    return fn(tag);
  },
}));

vi.mock('../chat/threads.ts', () => ({
  loadOwnedThread: vi.fn(async () => null),
  loadProjectSharedThread: vi.fn(async () => null),
}));

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

import { createFeedbackRoutes } from './routes.ts';

describe('POST /feedback — a message outside the caller reach', () => {
  it('answers an opaque 404 and records nothing', async () => {
    const app = createFeedbackRoutes({ sql: {} as never, auth: {} as never });
    const res = await app.request('/?orgId=o1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        threadId: 'someone-elses-thread',
        messageId: 'someone-elses-message',
        rating: 'positive',
      }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'MESSAGE_NOT_FOUND' });
  });
});
