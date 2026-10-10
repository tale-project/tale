/**
 * A project agent's run that a member started — someone who may work their
 * own tasks but not edit the project — is confined to its own task: the
 * tool door hands its dispatch a `confinedToTaskId`, and the task family,
 * `document_create` and `knowledge_entry_write` hold every write to it. The run still reads the
 * project's board; it changes only its task and the subtasks under it,
 * creates subtasks only there and with labels the catalog already has, and
 * neither syncs external items, saves project documents nor writes
 * knowledge entries. A run an editor started keeps the agent's reach.
 */

import { describe, expect, it, vi } from 'vitest';

import { functionRefName } from '../../../../lib/shared/handlers/function-refs';
import { dispatchWorkspaceToolImpl } from './workspace_tools_bridge';

vi.mock('../../lib/helpers/org_slug', () => ({
  orgSlugFromId: () => Promise.resolve('acme'),
}));

/** The board: the run's own task with a subtask, and someone else's. */
const TASKS: Record<string, { parentTaskId?: string }> = {
  'task-own': {},
  'task-own-sub': { parentTaskId: 'task-own' },
  'task-other': {},
  'task-other-sub': { parentTaskId: 'task-other' },
};

function taskDoc(id: string) {
  const task = TASKS[id];
  if (task === undefined) return null;
  return {
    _id: id,
    _creationTime: 1,
    organizationId: 'org-1',
    projectId: 'p-1',
    title: id,
    status: 'todo',
    number: 1,
    rank: 'a0',
    createdBy: 'u-1',
    createdByType: 'user',
    createdAt: 1,
    updatedAt: 1,
    ...task,
  };
}

function createCtx(confinedToTaskId?: string) {
  const runMutation = vi.fn(
    (ref: unknown, _args: Record<string, unknown>): Promise<unknown> => {
      const name = functionRefName(ref);
      if (name === 'tasks/internal_mutations:agentCreateTask') {
        return Promise.resolve({ taskId: 'task-new' });
      }
      if (name === 'tasks/internal_mutations:agentAddComment') {
        return Promise.resolve({ messageId: 'message-1' });
      }
      if (name === 'tasks/internal_mutations:agentUpdateTaskStatus') {
        return Promise.resolve({ ok: true });
      }
      if (name === 'tasks/internal_mutations:agentUpsertTaskByExternalRef') {
        return Promise.resolve({ taskId: 'task-synced', created: true });
      }
      return Promise.resolve(null);
    },
  );
  const runQuery = vi.fn(
    (ref: unknown, args: Record<string, unknown>): Promise<unknown> => {
      const name = functionRefName(ref);
      if (name === 'sandbox/workspace_access:resolveSessionActionContext') {
        return Promise.resolve({
          allowed: true,
          actorId: 'agent-1',
          scope: { kind: 'project', projectId: 'p-1' },
          ...(confinedToTaskId !== undefined ? { confinedToTaskId } : {}),
        });
      }
      if (name === 'tasks/internal_queries:getTaskByIdInternal') {
        return Promise.resolve(taskDoc(String(args.taskId)));
      }
      return Promise.resolve(null);
    },
  );
  const writes = () =>
    runMutation.mock.calls
      .map(([ref]) => functionRefName(ref))
      .filter((name) => name !== 'sandbox/session_mutations:recordToolCall');
  return {
    ctx: { runQuery, runMutation, runAction: vi.fn() },
    runMutation,
    writes,
  };
}

async function call(
  ctx: ReturnType<typeof createCtx>['ctx'],
  tool: string,
  callArgs: Record<string, unknown>,
) {
  return dispatchWorkspaceToolImpl(ctx as never, {
    organizationId: 'org-1',
    sessionId: 'pa-agent-1-m0123456789abcdef',
    taskRunExecId: 'exec-1',
    tool,
    callArgs,
  });
}

const refusedAsMemberRun = {
  status: 'unavailable',
  blockers: [expect.objectContaining({ code: 'member_run' })],
};

describe('a run a member started, confined to its own task [SBX-R7]', () => {
  it('changes its own task and the subtasks under it', async () => {
    const { ctx, writes } = createCtx('task-own');
    for (const taskId of ['task-own', 'task-own-sub']) {
      expect(
        await call(ctx, 'task_update_status', {
          taskId,
          status: 'in_review',
        }),
      ).toMatchObject({ status: 'ok' });
      expect(
        await call(ctx, 'task_comment', { taskId, body: 'Draft is ready.' }),
      ).toMatchObject({ status: 'ok' });
    }
    expect(writes()).toEqual([
      'tasks/internal_mutations:agentUpdateTaskStatus',
      'tasks/internal_mutations:agentAddComment',
      'tasks/internal_mutations:agentUpdateTaskStatus',
      'tasks/internal_mutations:agentAddComment',
    ]);
  });

  it("refuses to change someone else's task, writing nothing", async () => {
    const { ctx, writes } = createCtx('task-own');
    for (const taskId of ['task-other', 'task-other-sub']) {
      expect(
        await call(ctx, 'task_update_status', {
          taskId,
          status: 'cancelled',
        }),
      ).toEqual(refusedAsMemberRun);
      expect(
        await call(ctx, 'task_comment', { taskId, body: 'Closing this.' }),
      ).toEqual(refusedAsMemberRun);
    }
    expect(writes()).toEqual([]);
  });

  it('creates tasks only as subtasks of its own task, minting no labels', async () => {
    const { ctx, runMutation, writes } = createCtx('task-own');
    expect(
      await call(ctx, 'task_create', {
        title: 'Collect the signed copies',
        parentTaskId: 'task-own',
        labels: ['Contracts'],
      }),
    ).toMatchObject({ status: 'ok' });
    const created = runMutation.mock.calls.find(
      ([ref]) =>
        functionRefName(ref) === 'tasks/internal_mutations:agentCreateTask',
    );
    expect(created?.[1]).toMatchObject({
      parentTaskId: 'task-own',
      labels: ['Contracts'],
      mintLabels: false,
    });
    // A top-level task, or a subtask under someone else's, is refused.
    expect(
      await call(ctx, 'task_create', { title: 'Plan next quarter' }),
    ).toEqual(refusedAsMemberRun);
    expect(
      await call(ctx, 'task_create', {
        title: 'Split the invoice run',
        parentTaskId: 'task-other',
      }),
    ).toEqual(refusedAsMemberRun);
    expect(writes()).toEqual(['tasks/internal_mutations:agentCreateTask']);
  });

  it('neither syncs external items nor saves project documents', async () => {
    const { ctx, writes } = createCtx('task-own');
    expect(
      await call(ctx, 'task_upsert_by_external_ref', {
        externalSystem: 'github',
        externalId: 'example/web#1',
        title: 'Retitled',
      }),
    ).toEqual(refusedAsMemberRun);
    expect(
      await call(ctx, 'document_create', {
        name: 'report.md',
        content: '# Report',
      }),
    ).toEqual(refusedAsMemberRun);
    expect(writes()).toEqual([]);
    expect(ctx.runAction).not.toHaveBeenCalled();
  });

  it('writes no knowledge entries, which the whole organization reads [KENTRY-R11]', async () => {
    const { ctx, writes } = createCtx('task-own');
    expect(
      await call(ctx, 'knowledge_entry_write', {
        topic: 'Support hours',
        content: 'Mon–Fri 8–18',
      }),
    ).toEqual(refusedAsMemberRun);
    expect(writes()).toEqual([]);
  });

  it('still reads the board', async () => {
    const { ctx } = createCtx('task-own');
    expect(await call(ctx, 'task_get', { taskId: 'task-other' })).not.toEqual(
      refusedAsMemberRun,
    );
  });

  it('names its run to the door for every tool that asks it, reads included', async () => {
    const { ctx } = createCtx('task-own');
    await call(ctx, 'contact_find', {});
    await call(ctx, 'task_find', {});
    const asked = ctx.runQuery.mock.calls.filter(
      ([ref]) =>
        functionRefName(ref) ===
        'sandbox/workspace_access:resolveSessionActionContext',
    );
    expect(asked).toHaveLength(2);
    for (const [, args] of asked) {
      expect(args).toMatchObject({ taskRunExecId: 'exec-1' });
    }
  });
});

describe('a run an editor started keeps the agent’s reach [SBX-R7]', () => {
  it('changes any task on the board and mints the labels it names', async () => {
    const { ctx, runMutation } = createCtx();
    expect(
      await call(ctx, 'task_update_status', {
        taskId: 'task-other',
        status: 'cancelled',
      }),
    ).toMatchObject({ status: 'ok' });
    expect(
      await call(ctx, 'task_create', {
        title: 'Plan next quarter',
        labels: ['Planning'],
      }),
    ).toMatchObject({ status: 'ok' });
    const created = runMutation.mock.calls.find(
      ([ref]) =>
        functionRefName(ref) === 'tasks/internal_mutations:agentCreateTask',
    );
    expect(created?.[1]).not.toHaveProperty('mintLabels');
  });
});
