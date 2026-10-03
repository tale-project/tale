// @vitest-environment node

/**
 * The workflow stop door, `POST /:taskId/workflow/cancel`: it stops the
 * task's live run and moves the card in ONE transaction — to Cancelled when
 * the body names nothing (the run's own Cancel), else to the column a person
 * moved it to, at the position they dropped it. The move is the board's own
 * (`moveTask`), so only a closing move meets the open-subtask guard, and a
 * refused move takes the stop down with it. Real Postgres proves the rollback
 * (`workflow-parent-moves.integration.ts`); this pins the door's choreography.
 */

import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';
import { TaskError } from './errors.ts';

const {
  moveTask,
  updateTaskStatus,
  loadTaskOrThrow,
  getProjectAuthContext,
  loadProjectOrThrow,
  findLiveAutomationRunForTask,
  cancelRunInTx,
  transactSerializable,
  calls,
} = vi.hoisted(() => {
  const order: string[] = [];
  return {
    calls: order,
    moveTask: vi.fn(async () => {
      order.push('move');
      return null;
    }),
    updateTaskStatus: vi.fn(),
    loadTaskOrThrow: vi.fn(),
    getProjectAuthContext: vi.fn(),
    loadProjectOrThrow: vi.fn(),
    findLiveAutomationRunForTask: vi.fn(),
    cancelRunInTx: vi.fn(async () => {
      order.push('cancel');
      return { cancelled: true, status: 'cancelled' };
    }),
    transactSerializable: vi.fn(),
  };
});

vi.mock('./service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./service.ts')>()),
  moveTask,
  updateTaskStatus,
  loadTaskOrThrow,
}));
vi.mock('../projects/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../projects/service.ts')>()),
  getProjectAuthContext,
  loadProjectOrThrow,
}));
vi.mock('./external-ref.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./external-ref.ts')>()),
  findLiveAutomationRunForTask,
}));
vi.mock('../automations/store.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../automations/store.ts')>()),
  cancelRunInTx,
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
      c.set('orgMember', { role: 'editor' } as never);
      await next();
    },
}));

import { createTaskRoutes } from './routes.ts';

/** The one transaction the door opens; both writes must ride it. */
const TX = { transaction: 'the stop' };
const AUTH = {
  organizationId: 'o1',
  userId: 'u1',
  role: 'editor',
  teamIds: [] as string[],
};

async function stop(body?: string): Promise<Response> {
  return await createTaskRoutes({
    sql: {} as never,
    auth: {} as never,
  }).request('/t1/workflow/cancel', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  getProjectAuthContext.mockResolvedValue(AUTH);
  loadTaskOrThrow.mockResolvedValue({
    id: 't1',
    organizationId: 'o1',
    projectId: 'p1',
    status: 'in_progress',
  });
  loadProjectOrThrow.mockResolvedValue({
    id: 'p1',
    organizationId: 'o1',
    archivedAt: null,
    teamIds: [],
    teamId: null,
    sharedWithTeamIds: [],
  });
  findLiveAutomationRunForTask.mockResolvedValue({ runId: 'run-1' });
  transactSerializable.mockImplementation(
    async (_sql: unknown, fn: (tx: unknown) => unknown) => await fn(TX),
  );
});

describe('POST /:taskId/workflow/cancel', () => {
  it('stops the run and lands the card where it was moved, in one transaction', async () => {
    const res = await stop(JSON.stringify({ status: 'todo' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      taskCancelled: false,
      executionCancelled: true,
      executionId: 'run-1',
    });
    expect(transactSerializable).toHaveBeenCalledTimes(1);
    expect(cancelRunInTx).toHaveBeenCalledWith(TX, 'o1', 'run-1', 'u1');
    expect(moveTask).toHaveBeenCalledWith(TX, AUTH, {
      taskId: 't1',
      status: 'todo',
    });
    expect(calls).toEqual(['cancel', 'move']);
    // Never through Cancelled on the way: that close is what the open
    // subtasks refused.
    expect(updateTaskStatus).not.toHaveBeenCalled();
  });

  it('keeps the drop position a board move names', async () => {
    const res = await stop(
      JSON.stringify({
        status: 'backlog',
        beforeTaskId: 'above',
        afterTaskId: 'below',
      }),
    );

    expect(res.status).toBe(200);
    expect(moveTask).toHaveBeenCalledWith(TX, AUTH, {
      taskId: 't1',
      status: 'backlog',
      beforeTaskId: 'above',
      afterTaskId: 'below',
    });
  });

  it.each([
    ['no body', undefined],
    ['an empty body', '{}'],
  ])('parks the task at Cancelled with %s', async (_label, body) => {
    const res = await stop(body);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      taskCancelled: true,
      executionCancelled: true,
      executionId: 'run-1',
    });
    expect(moveTask).toHaveBeenCalledWith(TX, AUTH, {
      taskId: 't1',
      status: 'cancelled',
    });
  });

  it('answers a refused move with its code, the stop inside the same transaction', async () => {
    moveTask.mockRejectedValueOnce(
      new TaskError('TASK_HAS_OPEN_SUBTASKS', 'Open subtasks remain'),
    );

    const res = await stop(JSON.stringify({ status: 'done' }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'TASK_HAS_OPEN_SUBTASKS' });
    // The cancel ran inside the transaction the refusal aborted.
    expect(transactSerializable).toHaveBeenCalledTimes(1);
    expect(cancelRunInTx).toHaveBeenCalledWith(TX, 'o1', 'run-1', 'u1');
  });

  it.each([
    ['In progress, the column a stop leaves', '{"status":"in_progress"}'],
    ['a status that does not exist', '{"status":"archived"}'],
    [
      'an over-long neighbour id',
      `{"status":"todo","beforeTaskId":"${'x'.repeat(129)}"}`,
    ],
  ])('refuses %s before touching the run', async (_label, body) => {
    const res = await stop(body);

    expect(res.status).toBe(400);
    expect(findLiveAutomationRunForTask).not.toHaveBeenCalled();
    expect(cancelRunInTx).not.toHaveBeenCalled();
    expect(moveTask).not.toHaveBeenCalled();
  });

  it('refuses a read-only member before touching the run', async () => {
    getProjectAuthContext.mockResolvedValue({ ...AUTH, role: 'member' });

    const res = await stop(JSON.stringify({ status: 'todo' }));

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'RBAC_FORBIDDEN' });
    expect(cancelRunInTx).not.toHaveBeenCalled();
    expect(moveTask).not.toHaveBeenCalled();
  });

  it('moves the card alone when the run already ended', async () => {
    findLiveAutomationRunForTask.mockResolvedValue(null);

    const res = await stop(JSON.stringify({ status: 'todo' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      taskCancelled: false,
      executionCancelled: false,
      executionId: null,
    });
    expect(cancelRunInTx).not.toHaveBeenCalled();
    expect(moveTask).toHaveBeenCalledWith(TX, AUTH, {
      taskId: 't1',
      status: 'todo',
    });
  });

  it('writes no move when the task already sits where the stop lands it', async () => {
    loadTaskOrThrow.mockResolvedValue({
      id: 't1',
      organizationId: 'o1',
      projectId: 'p1',
      status: 'cancelled',
    });

    const res = await stop();

    expect(res.status).toBe(200);
    expect(cancelRunInTx).toHaveBeenCalledTimes(1);
    expect(moveTask).not.toHaveBeenCalled();
  });

  it('still places the card a drop names when the task already reached that column', async () => {
    // Another session moved the task to To do while this one confirmed the
    // stop: the drop's place between two cards still applies.
    loadTaskOrThrow.mockResolvedValue({
      id: 't1',
      organizationId: 'o1',
      projectId: 'p1',
      status: 'todo',
    });

    const res = await stop(
      JSON.stringify({
        status: 'todo',
        beforeTaskId: 'above',
        afterTaskId: 'below',
      }),
    );

    expect(res.status).toBe(200);
    expect(moveTask).toHaveBeenCalledWith(TX, AUTH, {
      taskId: 't1',
      status: 'todo',
      beforeTaskId: 'above',
      afterTaskId: 'below',
    });
  });
});
