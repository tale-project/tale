// @vitest-environment node

/**
 * The app door names the limit a task field broke. It answered a domain
 * refusal as `{error: <code>}` alone, so an empty title and an over-long one
 * reached the dialog as the same bare `TASK_TITLE_INVALID`; and its schema
 * carried caps of its own (an empty title or comment, a title over 500, a
 * description over 50,000, more than 100 labels, a comment over 10,000) that
 * answered a bare `invalid body`. Every one now answers the domain's code
 * with the domain's own sentence. The domain runs for real here, on a stub
 * connection.
 */

import type { Context } from 'hono';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';
import {
  TASK_COMMENT_MAX,
  TASK_DESCRIPTION_MAX,
  TASK_LABELS_MAX,
  TASK_TITLE_MAX,
} from '../../core/tasks/helpers.ts';
import { checkUserRateLimit } from '../../lib/rate-limit.ts';

vi.mock('../../lib/rate-limit.ts', () => ({
  checkUserRateLimit: vi.fn(),
  RateLimitExceededError: class extends Error {},
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
        c.set('orgMember', { role: 'admin' } as never);
        await next();
      },
  };
});

import { createTaskRoutes } from './routes.ts';

const PROJECT = {
  id: 'p1',
  organizationId: 'o1',
  teamId: null,
  sharedWithTeamIds: [] as string[],
  archivedAt: null,
};
const TASK = {
  id: 't1',
  organizationId: 'o1',
  projectId: 'p1',
  title: 'Existing',
  archivedAt: null,
};

/** A postgres.js stand-in for the door and its serializable transaction:
 * the project and task reads answer, every other statement answers
 * nothing, and every statement is recorded. */
function stubSql(): { sql: Sql; statements: string[] } {
  const statements: string[] = [];
  const tag = (strings: TemplateStringsArray) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push(text);
    if (text.startsWith('SELECT ? FROM app.projects WHERE id = ?')) {
      return Promise.resolve([PROJECT]);
    }
    if (text.startsWith('SELECT ? FROM app.tasks WHERE id = ?')) {
      return Promise.resolve([TASK]);
    }
    return Promise.resolve([]);
  };
  const sql = Object.assign(tag, {
    json: (value: unknown) => value,
    unsafe: (text: string) => text,
    begin: (first: unknown, second?: unknown) => {
      const run = typeof first === 'function' ? first : second;
      if (typeof run !== 'function') throw new Error('begin without a body');
      return Promise.resolve(run(sql));
    },
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the members the door's reads and transaction reach
  return { sql: sql as unknown as Sql, statements };
}

async function send(
  route: string,
  body: unknown,
): Promise<{ status: number; json: unknown; statements: string[] }> {
  const { sql, statements } = stubSql();
  const response = await createTaskRoutes({
    sql,
    auth: {} as never,
  }).request(`${route}?orgId=o1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json(), statements };
}

const writes = (statements: string[]): string[] =>
  statements.filter((text) => /^(INSERT|UPDATE|DELETE)\b/.test(text));

const EMPTY = {
  error: 'TASK_TITLE_INVALID',
  message: 'The task title is empty — it takes 1 to 200 UTF-16 code units.',
};
const OVER_LONG = {
  error: 'TASK_TITLE_INVALID',
  message:
    'The task title is capped at 200 UTF-16 code units (most emoji count ' +
    'as 2); this one has 201.',
};

beforeEach(() => vi.clearAllMocks());

describe('POST /api/app/tasks names the refused title limit', () => {
  it.each(['', '   '])(
    'answers the empty title %j as empty, with the range',
    async (title) => {
      const sent = await send('/', { projectId: 'p1', title });
      expect(sent.status).toBe(400);
      expect(sent.json).toEqual(EMPTY);
      expect(writes(sent.statements)).toEqual([]);
      // Refused at the schema with the domain's sentence: no create slot of
      // the author's rate limit is spent on a call that cannot land.
      expect(checkUserRateLimit).not.toHaveBeenCalled();
    },
  );

  it('answers an over-long title as over-long, with the cap', async () => {
    const sent = await send('/', {
      projectId: 'p1',
      title: 'x'.repeat(TASK_TITLE_MAX + 1),
    });
    expect(sent.status).toBe(400);
    expect(sent.json).toEqual(OVER_LONG);
    expect(writes(sent.statements)).toEqual([]);
  });

  it('names the cap for a title past the old schema guard of 500 too', async () => {
    const sent = await send('/', { projectId: 'p1', title: 'x'.repeat(501) });
    expect(sent.status).toBe(400);
    expect(sent.json).toEqual({
      error: 'TASK_TITLE_INVALID',
      message:
        'The task title is capped at 200 UTF-16 code units (most emoji ' +
        'count as 2); this one has 501.',
    });
  });
});

describe('POST /api/app/tasks names the refused description and label limits', () => {
  it.each([TASK_DESCRIPTION_MAX + 1, 50_001])(
    'answers a description of %i code units with the cap',
    async (length) => {
      const sent = await send('/', {
        projectId: 'p1',
        title: 'Fits',
        description: 'd'.repeat(length),
      });
      expect(sent.status).toBe(400);
      expect(sent.json).toEqual({
        error: 'TASK_DESCRIPTION_INVALID',
        message:
          'The task description is capped at 20,000 UTF-16 code units (most ' +
          `emoji count as 2); this one has ${length.toLocaleString('en-US')}.`,
      });
      expect(writes(sent.statements)).toEqual([]);
    },
  );

  it.each([TASK_LABELS_MAX + 1, 101])(
    'answers %i labels with the count cap',
    async (count) => {
      const sent = await send('/', {
        projectId: 'p1',
        title: 'Fits',
        labels: Array.from({ length: count }, (_, index) => `label-${index}`),
      });
      expect(sent.status).toBe(400);
      expect(sent.json).toEqual({
        error: 'TASK_LABELS_INVALID',
        message: `A task carries at most 50 labels; ${count} were given.`,
      });
      expect(writes(sent.statements)).toEqual([]);
    },
  );

  it('answers a label name over 50 code units with its cap, from the domain', async () => {
    const sent = await send('/', {
      projectId: 'p1',
      title: 'Fits',
      labels: ['l'.repeat(51)],
    });
    expect(sent.status).toBe(400);
    expect(sent.json).toEqual({
      error: 'TASK_LABELS_INVALID',
      message:
        'A label name is capped at 50 UTF-16 code units (most emoji count ' +
        'as 2); this one has 51.',
    });
    expect(writes(sent.statements)).toEqual([]);
  });

  it('keeps the bare invalid body for a malformed field no cap covers', async () => {
    const sent = await send('/', { projectId: 'p1', title: 42 });
    expect(sent.status).toBe(400);
    expect(sent.json).toEqual({ error: 'invalid body' });
  });
});

describe('POST /api/app/tasks/:taskId names the refused title limit', () => {
  it('answers a title cleared to empty as empty', async () => {
    const sent = await send('/t1', { title: '' });
    expect(sent.status).toBe(400);
    expect(sent.json).toEqual(EMPTY);
    expect(writes(sent.statements)).toEqual([]);
  });

  it('answers an over-long title as over-long', async () => {
    const sent = await send('/t1', { title: 'x'.repeat(TASK_TITLE_MAX + 1) });
    expect(sent.status).toBe(400);
    expect(sent.json).toEqual(OVER_LONG);
    expect(writes(sent.statements)).toEqual([]);
  });
});

const COMMENT_EMPTY = {
  error: 'TASK_COMMENT_INVALID',
  message: 'The comment is empty — it takes 1 to 10,000 UTF-16 code units.',
};
const COMMENT_OVER_LONG = {
  error: 'TASK_COMMENT_INVALID',
  message:
    'The comment is capped at 10,000 UTF-16 code units (most emoji count ' +
    'as 2); this one has 10,001.',
};

describe.each([
  ['POST /api/app/tasks/:taskId/comments', '/t1/comments'],
  ['POST /api/app/tasks/comments/:messageId', '/comments/m1'],
])('%s names the refused comment limit', (_door, route) => {
  it.each(['', '   '])(
    'answers the empty body %j as empty, with the range',
    async (body) => {
      const sent = await send(route, { body });
      expect(sent.status).toBe(400);
      expect(sent.json).toEqual(COMMENT_EMPTY);
      expect(writes(sent.statements)).toEqual([]);
      expect(checkUserRateLimit).not.toHaveBeenCalled();
    },
  );

  it('answers an over-long body as over-long, with the cap', async () => {
    const sent = await send(route, { body: 'c'.repeat(TASK_COMMENT_MAX + 1) });
    expect(sent.status).toBe(400);
    expect(sent.json).toEqual(COMMENT_OVER_LONG);
    expect(writes(sent.statements)).toEqual([]);
  });
});
