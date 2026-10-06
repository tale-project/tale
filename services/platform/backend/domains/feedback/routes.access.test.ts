// @vitest-environment node

/**
 * The vote door answers a message outside the caller's reach with one opaque
 * 404 — the same status for "no such message", "another organization's" and
 * "not your thread", so a member cannot probe a foreign message id by voting
 * on it.
 */

import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const member = vi.hoisted(() => ({ role: 'member' }));

beforeEach(() => {
  member.role = 'member';
});

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
        c.set('orgMember', { role: member.role } as never);
        await next();
      },
  };
});

import { createFeedbackRoutes } from './routes.ts';

describe('GET /recent/:feedbackId/comment', () => {
  it('marks only actually projected comments as truncated in the list', async () => {
    member.role = 'admin';
    const comments = [
      null,
      '',
      'short',
      'a'.repeat(500),
      'a'.repeat(500) + '…',
      'a'.repeat(5000),
    ];
    const sql = vi.fn(async (strings: TemplateStringsArray) =>
      strings.join('?').includes('FROM app.message_feedback')
        ? comments.map((comment, index) => ({
            id: `fb-${index}`,
            threadId: 't1',
            messageId: 'm1',
            userId: 'u1',
            rating: 'positive',
            comment,
            metadata: null,
            agentSlug: null,
            model: null,
            provider: null,
            createdAt: 1,
          }))
        : [{ id: 'u1', name: 'Ada' }],
    );
    Object.assign(sql, { unsafe: (value: string) => value });
    const app = createFeedbackRoutes({ sql: sql as never, auth: {} as never });
    const res = await app.request('/recent?limit=10');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      page: comments.map((comment) => ({
        comment: comment
          ? comment.length > 500
            ? comment.slice(0, 500) + '…'
            : comment
          : null,
        commentTruncated: (comment?.length ?? 0) > 500,
      })),
    });
  });

  it('refuses members before reading comments [FDBK-R3]', async () => {
    const sql = vi.fn();
    const app = createFeedbackRoutes({ sql: sql as never, auth: {} as never });
    const res = await app.request('/recent/fb-1/comment');
    expect(res.status).toBe(403);
    expect(sql).not.toHaveBeenCalled();
  });

  it.each(['active', 'unknown', 'trashed'])(
    'scopes the %s read by organization and lifecycle [FDBK-R4]',
    async (state) => {
      member.role = 'admin';
      const comment = 'a'.repeat(620) + ' correction ending';
      const sql = vi.fn(
        async (strings: TemplateStringsArray, ..._values: unknown[]) => {
          const excludesTrash = strings
            .join('?')
            .includes("lifecycle_status IS DISTINCT FROM 'trashed'");
          return state === 'unknown' || (state === 'trashed' && excludesTrash)
            ? []
            : [{ comment }];
        },
      );
      const app = createFeedbackRoutes({
        sql: sql as never,
        auth: {} as never,
      });
      const res = await app.request('/recent/fb-1/comment');
      expect(res.status).toBe(state === 'active' ? 200 : 404);
      expect(await res.json()).toEqual(
        state === 'active' ? { comment } : { error: 'not_found' },
      );
      const [strings, feedbackId, orgId] = sql.mock.calls[0] ?? [];
      expect(strings?.join('?')).toContain(
        "lifecycle_status IS DISTINCT FROM 'trashed'",
      );
      expect([feedbackId, orgId]).toEqual(['fb-1', 'o1']);
    },
  );
});

describe('POST /feedback — a message outside the caller reach', () => {
  it('answers an opaque 404 and records nothing [FDBK-R1]', async () => {
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
