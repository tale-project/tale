// @vitest-environment node

/**
 * The repeat rule at the app doors: the create and edit bodies take a rule
 * (edit also takes null, "does not repeat") and refuse a malformed one as
 * a refused body that names the field; the two status doors answer the
 * next copy when the move closed a repeating task, so the board can say
 * where the series went; and "Stop repeating" answers whether it took the
 * next task back.
 */

import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';
import { TaskError } from './errors.ts';

const {
  createTask,
  updateTask,
  updateTaskStatus,
  moveTask,
  stopTaskRepeat,
  getProjectAuthContext,
  checkUserRateLimit,
  transactSerializable,
} = vi.hoisted(() => ({
  createTask: vi.fn(),
  updateTask: vi.fn(),
  updateTaskStatus: vi.fn(),
  moveTask: vi.fn(),
  stopTaskRepeat: vi.fn(),
  getProjectAuthContext: vi.fn(),
  checkUserRateLimit: vi.fn(),
  transactSerializable: vi.fn(),
}));

vi.mock('./service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./service.ts')>()),
  createTask,
  updateTask,
  updateTaskStatus,
  moveTask,
}));
vi.mock('./repeat.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./repeat.ts')>()),
  stopTaskRepeat,
}));
vi.mock('../projects/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../projects/service.ts')>()),
  getProjectAuthContext,
}));
vi.mock('../../lib/rate-limit.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/rate-limit.ts')>()),
  checkUserRateLimit,
}));
vi.mock('@tale/shared/db/serializable', () => ({ transactSerializable }));

vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', {
        user: { id: 'u1', email: 'u@example.test' },
      } as never);
      await next();
    },
}));

vi.mock('../../auth/org.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auth/org.ts')>()),
  requireOrgMember:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('orgId', 'o1');
      c.set('orgMember', { role: 'member' } as never);
      await next();
    },
}));

import { createTaskRoutes } from './routes.ts';

async function post(route: string, body: unknown): Promise<Response> {
  return await createTaskRoutes({
    sql: {} as never,
    auth: {} as never,
  }).request(route, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const weekly = {
  frequency: 'weekly',
  interval: 2,
  weekdays: [1, 4],
  timezone: 'Europe/Zurich',
};

beforeEach(() => {
  vi.clearAllMocks();
  getProjectAuthContext.mockResolvedValue({ organizationId: 'o1' });
  checkUserRateLimit.mockResolvedValue(undefined);
  transactSerializable.mockImplementation(
    async (_sql: unknown, fn: (tx: unknown) => unknown) => await fn({}),
  );
  createTask.mockResolvedValue('t1');
  updateTask.mockResolvedValue(undefined);
  updateTaskStatus.mockResolvedValue(null);
  moveTask.mockResolvedValue(null);
  stopTaskRepeat.mockResolvedValue({ removedNextTask: true });
});

const REFUSED: [string, unknown][] = [
  ['no frequency', { interval: 1, timezone: 'UTC' }],
  ['an unknown frequency', { ...weekly, frequency: 'hourly' }],
  ['a zero step', { ...weekly, interval: 0 }],
  ['a step past 99', { ...weekly, interval: 100 }],
  ['a weekly rule on no day', { ...weekly, weekdays: [] }],
  ['a weekday past Saturday', { ...weekly, weekdays: [7] }],
  ['an unknown zone', { ...weekly, timezone: 'Mars/Olympus_Mons' }],
  ['a key the rule does not have', { ...weekly, hour: 9 }],
  [
    'a date no year has',
    {
      frequency: 'yearly',
      interval: 1,
      month: 2,
      monthDay: 30,
      timezone: 'UTC',
    },
  ],
  ['a string', 'weekly'],
];

describe('the create and edit doors take a repeat rule', () => {
  it('passes a rule through on create', async () => {
    const res = await post('/', {
      projectId: 'p1',
      title: 'Plan',
      repeat: weekly,
    });
    expect(res.status).toBe(200);
    expect(createTask).toHaveBeenCalledWith(
      {},
      { organizationId: 'o1' },
      expect.objectContaining({ repeat: weekly }),
    );
  });

  it('passes a rule, and null for "does not repeat", through on edit', async () => {
    expect((await post('/t1', { repeat: weekly })).status).toBe(200);
    expect(updateTask).toHaveBeenLastCalledWith(
      {},
      { organizationId: 'o1' },
      { taskId: 't1', repeat: weekly },
    );
    expect((await post('/t1', { repeat: null })).status).toBe(200);
    expect(updateTask).toHaveBeenLastCalledWith(
      {},
      { organizationId: 'o1' },
      { taskId: 't1', repeat: null },
    );
  });

  it('refuses null on create — a new task either repeats or says nothing', async () => {
    const res = await post('/', {
      projectId: 'p1',
      title: 'Plan',
      repeat: null,
    });
    expect(res.status).toBe(400);
    expect(createTask).not.toHaveBeenCalled();
  });

  it.each(REFUSED)(
    'refuses %s with a 400 naming the repeat field',
    async (_name, repeat) => {
      const created = await post('/', {
        projectId: 'p1',
        title: 'Plan',
        repeat,
      });
      expect(created.status).toBe(400);
      const createdBody = (await created.json()) as {
        error: string;
        data: { issues: { path: string }[] };
      };
      expect(createdBody.error).toBe('invalid body');
      expect(
        createdBody.data.issues.every((issue) =>
          issue.path.startsWith('repeat'),
        ),
      ).toBe(true);
      expect(createTask).not.toHaveBeenCalled();

      const updated = await post('/t1', { repeat });
      expect(updated.status).toBe(400);
      expect(await updated.json()).toMatchObject({ error: 'invalid body' });
      expect(updateTask).not.toHaveBeenCalled();
    },
  );
});

describe('a rule the task cannot carry', () => {
  it.each([
    ['Subtasks do not repeat'],
    ['Tasks an automation owns do not repeat'],
    ['Only an open task can repeat'],
  ])(
    'answers the service’s refusal as a 400 naming why: %s',
    async (message) => {
      const refusal = new TaskError('TASK_REPEAT_INVALID', message);
      createTask.mockRejectedValueOnce(refusal);
      const created = await post('/', {
        projectId: 'p1',
        title: 'Plan',
        repeat: weekly,
      });
      expect(created.status).toBe(400);
      expect(await created.json()).toEqual({
        error: 'TASK_REPEAT_INVALID',
        message,
      });

      updateTask.mockRejectedValueOnce(refusal);
      const updated = await post('/t1', { repeat: weekly });
      expect(updated.status).toBe(400);
      expect(await updated.json()).toEqual({
        error: 'TASK_REPEAT_INVALID',
        message,
      });
    },
  );
});

describe('the status doors answer the next copy', () => {
  const nextTask = { id: 't2', number: 12, dueDate: 1_790_546_400_000 };

  it('the picker answers it when the close created one', async () => {
    updateTaskStatus.mockResolvedValue(nextTask);
    const res = await post('/t1/status', { status: 'done' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, nextTask });
    expect(updateTaskStatus).toHaveBeenCalledWith(
      {},
      { organizationId: 'o1' },
      't1',
      'done',
    );
  });

  it('the drag answers it too', async () => {
    moveTask.mockResolvedValue(nextTask);
    const res = await post('/t1/move', { status: 'cancelled' });
    expect(await res.json()).toEqual({ ok: true, nextTask });
  });

  it('a move that created no copy answers a bare ok', async () => {
    expect(await (await post('/t1/status', { status: 'done' })).json()).toEqual(
      { ok: true },
    );
    expect(
      await (await post('/t1/move', { status: 'in_progress' })).json(),
    ).toEqual({ ok: true });
  });
});

describe('"Stop repeating" answers whether the next task was taken back', () => {
  it('runs the service in one serializable transaction for the task in the path', async () => {
    const res = await post('/t1/repeat/stop', {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, removedNextTask: true });
    expect(transactSerializable).toHaveBeenCalledTimes(1);
    expect(stopTaskRepeat).toHaveBeenCalledWith(
      {},
      { organizationId: 'o1' },
      't1',
    );
  });

  it('answers false when the next task stayed and only its rule was cleared', async () => {
    stopTaskRepeat.mockResolvedValue({ removedNextTask: false });
    const res = await post('/t1/repeat/stop', {});
    expect(await res.json()).toEqual({ ok: true, removedNextTask: false });
  });

  it.each([
    [new TaskError('RBAC_FORBIDDEN', 'Editor role required', 403), 403],
    [new TaskError('TASK_ARCHIVED', 'Task is archived'), 400],
    [new TaskError('TASK_NOT_FOUND', 'Task not found', 404), 404],
  ])('answers the service’s refusal: %s', async (refusal, status) => {
    stopTaskRepeat.mockRejectedValue(refusal);
    const res = await post('/t1/repeat/stop', {});
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({
      error: refusal.code,
      message: refusal.message,
    });
  });
});
