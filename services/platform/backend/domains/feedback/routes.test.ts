/**
 * The vote key is server-owned: the one-vote-per-(message, user) upsert is
 * arbitrated by the partial unique index `WHERE metadata IS NULL`, so any
 * `metadata` a client sends must be dropped at the door — otherwise one
 * member could stack unlimited rows for one message, or forge the
 * `arenaVerdict` rows the analytics count as arena results.
 */

import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const { submitMessageFeedback } = vi.hoisted(() => ({
  submitMessageFeedback: vi.fn(),
}));

vi.mock('./service.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./service.ts')>();
  return { ...actual, submitMessageFeedback };
});

vi.mock('@tale/shared/db/serializable', () => ({
  transactSerializable: (_sql: unknown, fn: (tx: unknown) => unknown) => fn({}),
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

function makeApp() {
  return createFeedbackRoutes({ sql: {} as never, auth: {} as never });
}

async function vote(body: Record<string, unknown>): Promise<Response> {
  return makeApp().request('/?orgId=o1', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('feedback route — the vote key is server-owned', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    submitMessageFeedback.mockResolvedValue(undefined);
  });

  it('drops client metadata before the vote reaches the service', async () => {
    const res = await vote({
      threadId: 't1',
      messageId: 'm1',
      rating: 'positive',
      metadata: { stacked: true },
    });

    expect(res.status).toBe(200);
    expect(submitMessageFeedback).toHaveBeenCalledTimes(1);
    expect(submitMessageFeedback.mock.calls[0]?.[2]).toEqual({
      threadId: 't1',
      messageId: 'm1',
      rating: 'positive',
    });
  });

  it('never lets a client-forged arena verdict through as a vote payload', async () => {
    const res = await vote({
      threadId: 't1',
      messageId: 'arena:model-a:model-b',
      rating: 'positive',
      metadata: {
        arenaVerdict: 'a_better',
        modelA: 'model-a',
        modelB: 'model-b',
      },
    });

    expect(res.status).toBe(200);
    expect(submitMessageFeedback.mock.calls[0]?.[2]).not.toHaveProperty(
      'metadata',
    );
  });
});
