// @vitest-environment node

/**
 * The app door names the limit a task field broke. It answered a domain
 * refusal as `{error: <code>}` alone, so an empty title and an over-long one
 * reached the dialog as the same bare `TASK_TITLE_INVALID`; and its schema
 * carried caps of its own (an empty title or comment, a title over 500, a
 * description over 50,000, more than 100 labels, a comment over 10,000) that
 * answered a bare `invalid body`. Every one now answers the domain's code
 * with the domain's own sentence, on the label create and rename too. The
 * external-issue intake refuses a blank title and too many labels the same
 * way, and cuts an over-long title and description as every import does.
 * The domain runs for real here, on a stub connection.
 */

import type { Context } from 'hono';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';
import {
  TASK_COMMENT_MAX,
  TASK_DESCRIPTION_MAX,
  TASK_LABEL_CHARS_MAX,
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
// The trail a created task leaves (its audit chain, its event row) is not
// what these tests judge, and it needs rows the stub does not keep.
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));
vi.mock('../events/emit.ts', () => ({ emitEvent: vi.fn() }));

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
 * the project and task reads answer, the external-ref intake's create lane
 * lands (its project probe, its number, its insert), every other statement
 * answers nothing, and every statement is recorded with its values. */
function stubSql(options: { reviewContextHeld?: boolean } = {}): {
  sql: Sql;
  statements: string[];
  values: unknown[][];
} {
  const statements: string[] = [];
  const values: unknown[][] = [];
  const tag = (strings: TemplateStringsArray, ...bound: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push(text);
    values.push(bound);
    if (text.startsWith('SELECT ? FROM app.projects WHERE id = ?')) {
      return Promise.resolve([PROJECT]);
    }
    if (text.startsWith('SELECT ? FROM app.tasks WHERE id = ?')) {
      return Promise.resolve([TASK]);
    }
    if (text.startsWith('SELECT id FROM app.projects WHERE id = ?')) {
      return Promise.resolve([{ id: PROJECT.id }]);
    }
    if (text.startsWith('UPDATE app.projects SET task_counter')) {
      return Promise.resolve([{ taskCounter: 1 }]);
    }
    if (text.startsWith('INSERT INTO app.tasks')) {
      return Promise.resolve([{ id: 't-new' }]);
    }
    if (options.reviewContextHeld) {
      if (text.startsWith('WITH RECURSIVE tree AS')) {
        return Promise.resolve([
          { id: 't1', status: 'todo', archivedAt: null },
        ]);
      }
      if (text.includes('FROM app.task_review_contexts')) {
        return Promise.resolve([{ taskId: 't1', authorUserId: 'u1' }]);
      }
      if (text.includes('FROM app.legal_holds')) {
        return Promise.resolve([{ targetType: 'org', targetId: 'o1' }]);
      }
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
  return { sql: sql as unknown as Sql, statements, values };
}

it('answers a held review context deletion with its native 409 refusal', async () => {
  const { sql, statements } = stubSql({ reviewContextHeld: true });
  const response = await createTaskRoutes({ sql, auth: {} as never }).request(
    '/t1?orgId=o1',
    { method: 'DELETE' },
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: 'LEGAL_HOLD_ACTIVE',
    message:
      'This organization is under an active legal hold. Release the hold before deleting.',
  });
  expect(statements.some((text) => text.includes('FROM app.legal_holds'))).toBe(
    true,
  );
  expect(statements.filter((text) => /^(DELETE|INSERT)\b/.test(text))).toEqual(
    [],
  );
  expect(
    statements.some((text) => text.startsWith('UPDATE app.project_agent_runs')),
  ).toBe(false);
});

async function send(
  route: string,
  body: unknown,
): Promise<{
  status: number;
  json: unknown;
  statements: string[];
  values: unknown[][];
}> {
  const { sql, statements, values } = stubSql();
  const response = await createTaskRoutes({
    sql,
    auth: {} as never,
  }).request(`${route}?orgId=o1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    json: await response.json(),
    statements,
    values,
  };
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

describe('POST /api/app/tasks names the refused title limit [TASK-R8]', () => {
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

describe('POST /api/app/tasks names the refused description and label limits [TASK-R8]', () => {
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

  it('names a malformed field no domain cap covers', async () => {
    const sent = await send('/', { projectId: 'p1', title: 42 });
    expect(sent.status).toBe(400);
    expect(sent.json).toMatchObject({
      error: 'invalid body',
      message: expect.stringContaining('title:'),
      data: { issues: [{ path: 'title', message: expect.any(String) }] },
    });
  });
});

describe('POST /api/app/tasks/:taskId names the refused title limit [TASK-R8]', () => {
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

const LABEL_EMPTY = {
  error: 'TASK_LABELS_INVALID',
  message: 'A label name is empty — it takes 1 to 50 UTF-16 code units.',
};
const labelOverLong = (length: number) => ({
  error: 'TASK_LABELS_INVALID',
  message:
    'A label name is capped at 50 UTF-16 code units (most emoji count as ' +
    `2); this one has ${length}.`,
});

describe.each([
  ['POST /api/app/tasks/labels', '/labels', { projectId: 'p1' }],
  ['POST /api/app/tasks/labels/:labelId/rename', '/labels/l1/rename', {}],
])('%s names the refused label name limit', (_door, route, rest) => {
  // An empty name and one over the schema's old cap of 100 answered a bare
  // `invalid body`; a name of 51 to 100 reached the domain's sentence.
  it.each(['', '   '])(
    'answers the empty name %j as empty, with the range',
    async (name) => {
      const sent = await send(route, { ...rest, name });
      expect(sent.status).toBe(400);
      expect(sent.json).toEqual(LABEL_EMPTY);
      expect(writes(sent.statements)).toEqual([]);
    },
  );

  it.each([TASK_LABEL_CHARS_MAX + 1, 101])(
    'answers a name of %i code units with the cap, before any read',
    async (length) => {
      const sent = await send(route, { ...rest, name: 'l'.repeat(length) });
      expect(sent.status).toBe(400);
      expect(sent.json).toEqual(labelOverLong(length));
      expect(sent.statements).toEqual([]);
    },
  );
});

describe('POST /api/app/tasks/from-external-issue names what it refuses and cuts what it imports [TASK-R9]', () => {
  const intake = { projectId: 'p1', externalSystem: 'crm', externalId: 'c-1' };
  const inserted = (sent: Awaited<ReturnType<typeof send>>): unknown[] => {
    const index = sent.statements.findIndex((text) =>
      text.startsWith('INSERT INTO app.tasks'),
    );
    return index === -1 ? [] : (sent.values[index] ?? []);
  };

  it.each(['', '   '])(
    'answers the empty title %j as empty, with the range',
    async (title) => {
      const sent = await send('/from-external-issue', { ...intake, title });
      expect(sent.status).toBe(400);
      expect(sent.json).toEqual(EMPTY);
      expect(writes(sent.statements)).toEqual([]);
    },
  );

  it.each([TASK_LABELS_MAX + 1, 101])(
    'answers %i labels with the count cap',
    async (count) => {
      const sent = await send('/from-external-issue', {
        ...intake,
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
    const sent = await send('/from-external-issue', {
      ...intake,
      title: 'Fits',
      labels: ['l'.repeat(TASK_LABEL_CHARS_MAX + 1)],
    });
    expect(sent.status).toBe(400);
    expect(sent.json).toEqual(labelOverLong(TASK_LABEL_CHARS_MAX + 1));
    expect(inserted(sent)).toEqual([]);
  });

  it.each([
    [TASK_TITLE_MAX + 1, TASK_DESCRIPTION_MAX + 1],
    // Past the door's old caps, which answered a bare `invalid body`.
    [501, 50_001],
  ])(
    'cuts a title of %i and a description of %i code units, as every import does',
    async (titleLength, descriptionLength) => {
      const sent = await send('/from-external-issue', {
        ...intake,
        title: 't'.repeat(titleLength),
        description: 'd'.repeat(descriptionLength),
      });
      expect(sent.status).toBe(200);
      expect(sent.json).toEqual({ taskId: 't-new', created: true });
      // (org, project, title, description, …): both at their caps, "…" last.
      expect(inserted(sent).slice(2, 4)).toEqual([
        `${'t'.repeat(TASK_TITLE_MAX - 1)}…`,
        `${'d'.repeat(TASK_DESCRIPTION_MAX - 1)}…`,
      ]);
    },
  );
});

describe('managed task instructions validate the complete target and preimage', () => {
  const config = { projectId: 'p1', taskId: 't1', description: '' };
  const hash = 'a'.repeat(64);
  const request = async (
    method: 'GET' | 'POST',
    query: string,
    body?: unknown,
  ) => {
    const { sql, statements } = stubSql();
    const response = await createTaskRoutes({ sql, auth: {} as never }).request(
      `/t1/configuration/instructions?orgId=o1${query}`,
      {
        method,
        ...(body === undefined
          ? {}
          : {
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            }),
      },
    );
    return { response, statements };
  };

  it('requires the project on reads and exposes only scoped description', async () => {
    expect((await request('GET', '')).response.status).toBe(400);
    const read = await request('GET', '&projectId=p1');
    expect(read.response.status).toBe(200);
    expect(await read.response.json()).toEqual({
      config,
      hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it.each([
    { config },
    { config, expectedHash: null },
    { config: { ...config, status: 'done' }, expectedHash: hash },
    { config: { ...config, taskId: 'other' }, expectedHash: hash },
    { config: { ...config, projectId: 'other' }, expectedHash: hash },
    {
      config: { ...config, description: 'x'.repeat(TASK_DESCRIPTION_MAX + 1) },
      expectedHash: hash,
    },
  ])(
    'refuses incomplete/stale-target or unowned instructions body',
    async (body) => {
      const read = await request('POST', '&projectId=p1', body);
      expect(read.response.status).toBe(400);
      expect(writes(read.statements)).toEqual([]);
    },
  );

  it('returns a typed stale conflict without changing an active task', async () => {
    const read = await request('POST', '&projectId=p1', {
      config,
      expectedHash: hash,
    });
    expect(read.response.status).toBe(409);
    expect(await read.response.json()).toMatchObject({
      error: 'CONFIG_VERSION_CONFLICT',
    });
    expect(writes(read.statements)).toEqual([]);
  });
});
