import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import {
  notifyTaskAssigned,
  notifyTaskStatusChanged,
} from '../collab/service.ts';
import { emitEvent } from '../events/emit.ts';
import { loadProjectOrThrow, type ProjectRow } from '../projects/service.ts';
import { cancelAgentRunInTx, kickAgentRun } from './agent-runs.ts';
import { requestTaskReview } from './reviews.ts';
import {
  agentUpdateTaskStatusTrusted,
  createTask,
  handTaskToInProgressForKick,
  moveTask,
  type TaskRow,
  updateTaskStatus,
} from './service.ts';

vi.mock('../collab/service.ts', () => ({
  autoSubscribe: vi.fn(),
  notifyTaskAssigned: vi.fn(),
  notifyTaskStatusChanged: vi.fn(),
}));
vi.mock('../events/emit.ts', () => ({ emitEvent: vi.fn() }));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));
vi.mock('./reviews.ts', () => ({
  closePendingTaskReviewOnStatusLeave: vi.fn(),
  collectPendingReviewsForProjects: vi.fn(() => Promise.resolve([])),
  requestTaskReview: vi.fn(),
}));
vi.mock('./agent-runs.ts', () => ({
  cancelAgentRunInTx: vi.fn(),
  kickAgentRun: vi.fn(),
}));
vi.mock('../projects/service.ts', () => ({
  listProjects: vi.fn(),
  loadProjectOrThrow: vi.fn(),
}));

/**
 * A postgres.js transaction stand-in: answers the task load with the fixture
 * row, everything else with no rows (rank probes append, count transitions
 * and activity inserts have no result). The collaborators that carry the
 * side effects under test are module mocks.
 */
function fakeTx(
  fixture: TaskRow,
  extra: (text: string) => unknown[] | undefined = () => undefined,
): {
  tx: TransactionSql;
  statements: string[];
} {
  const statements: string[] = [];
  const answer = (text: string): unknown[] => {
    const scripted = extra(text);
    if (scripted !== undefined) return scripted;
    if (text.startsWith('SELECT ? FROM app.tasks WHERE id = ?')) {
      return [fixture];
    }
    if (text.startsWith('SELECT "role" FROM "member"')) {
      return [{ role: 'member' }];
    }
    return [];
  };
  const tag = (
    strings: TemplateStringsArray,
    ..._values: unknown[]
  ): Promise<unknown[]> => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    statements.push(text);
    return Promise.resolve(answer(text));
  };
  const tx = Object.assign(tag, {
    json: (value: unknown) => value,
    unsafe: (text: string, params?: unknown[]): unknown => {
      if (params === undefined) return text; // a fragment inside a template
      statements.push(text);
      return Promise.resolve([]);
    },
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a three-member stand-in for the postgres.js transaction function
  return { tx: tx as unknown as TransactionSql, statements };
}

const auth = {
  organizationId: 'org-1',
  userId: 'u-owner',
  email: 'owner@example.com',
  role: 'owner',
  teamIds: [] as string[],
};

const project: ProjectRow = {
  id: 'p-1',
  organizationId: 'org-1',
  name: 'Board',
  description: null,
  icon: null,
  color: null,
  key: 'BRD',
  externalItemId: null,
  taskCounter: 1,
  openTaskCount: 1,
  doneTaskCount: 0,
  projectAgentCount: 0,
  teamId: null,
  sharedWithTeamIds: [],
  instructions: null,
  knowledgeMode: null,
  agentMode: null,
  recommendedAgentSlugs: [],
  allowedAgentSlugs: [],
  modelMode: null,
  recommendedModels: [],
  allowedModels: [],
  connectorsMode: null,
  allowedConnectorSlugs: [],
  createdBy: 'u-owner',
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  pinnedAt: null,
};

function taskRow(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 't-1',
    organizationId: 'org-1',
    projectId: 'p-1',
    title: 'Drag me',
    description: null,
    attachments: null,
    outputs: null,
    number: 1,
    status: 'todo',
    priority: null,
    labelIds: [],
    assigneeType: null,
    assigneeId: null,
    reviewerUserId: null,
    parentTaskId: null,
    commentCount: 0,
    rank: 'a0',
    externalSystem: null,
    externalId: null,
    externalUrl: null,
    threadId: null,
    discussionThreadId: null,
    sourceDiscussionThreadId: null,
    startDate: null,
    startNotifiedAt: null,
    dueDate: null,
    slaLevel: null,
    slaLevelAt: null,
    statusChangedAt: null,
    totalCostCents: null,
    agentRunCount: 0,
    lastAgentRunAt: null,
    claimedAt: null,
    completedAt: null,
    createdBy: 'u-owner',
    createdByType: 'user',
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
    ...overrides,
  };
}

/** The observable side effects of one status door, minus the tx handle. */
function sideEffects() {
  return {
    bells: vi.mocked(notifyTaskStatusChanged).mock.calls.map(([, a]) => a),
    events: vi.mocked(emitEvent).mock.calls.map(([, a]) => a),
    audits: vi.mocked(createAuditLog).mock.calls.length,
    hints: vi
      .mocked(emitHintInTx)
      .mock.calls.map(([, hint]) => `${hint.entity}:${hint.entityId}`),
  };
}

beforeEach(() => {
  vi.mocked(notifyTaskStatusChanged).mockReset();
  vi.mocked(notifyTaskAssigned).mockReset();
  vi.mocked(emitEvent).mockReset();
  vi.mocked(createAuditLog).mockReset();
  vi.mocked(emitHintInTx).mockReset();
  vi.mocked(cancelAgentRunInTx).mockReset();
  vi.mocked(kickAgentRun).mockReset();
  vi.mocked(requestTaskReview).mockReset();
  vi.mocked(loadProjectOrThrow).mockResolvedValue(project);
});

describe('every status door lands on the same settle seam', () => {
  it('the board drag (/move) fires the bell and the platform event exactly like the picker', async () => {
    const task = taskRow();
    await updateTaskStatus(fakeTx(task).tx, auth, task.id, 'in_progress');
    const picker = sideEffects();
    expect(picker.bells).toHaveLength(1);
    expect(picker.events).toEqual([
      {
        organizationId: 'org-1',
        eventType: 'task.status_changed',
        eventData: {
          taskId: 't-1',
          projectId: 'p-1',
          fromStatus: 'todo',
          toStatus: 'in_progress',
          actorType: 'user',
          actorId: 'u-owner',
        },
      },
    ]);
    expect(picker.audits).toBe(1);
    expect(picker.hints).toEqual(['task:t-1']);

    vi.mocked(notifyTaskStatusChanged).mockReset();
    vi.mocked(emitEvent).mockReset();
    vi.mocked(createAuditLog).mockReset();
    vi.mocked(emitHintInTx).mockReset();

    await moveTask(fakeTx(task).tx, auth, {
      taskId: task.id,
      status: 'in_progress',
    });
    expect(sideEffects()).toEqual(picker);
  });

  it('a drop inside the same column (no status change) neither bells nor fires', async () => {
    const task = taskRow({ status: 'in_progress' });
    await moveTask(fakeTx(task).tx, auth, {
      taskId: task.id,
      status: 'in_progress',
    });
    expect(sideEffects()).toEqual({
      bells: [],
      events: [],
      audits: 0,
      hints: [],
    });
  });

  it('the mention-kick hand-off bells and fires the event as the person’s gesture (no audit: no auth context)', async () => {
    const task = taskRow({ status: 'in_review' });
    await expect(
      handTaskToInProgressForKick(fakeTx(task).tx, {
        organizationId: 'org-1',
        taskId: task.id,
        userId: 'u-owner',
      }),
    ).resolves.toBe(true);
    const effects = sideEffects();
    expect(effects.bells).toEqual([
      {
        task,
        fromStatus: 'in_review',
        toStatus: 'in_progress',
        actorType: 'user',
        actorId: 'u-owner',
      },
    ]);
    expect(effects.events.map((e) => e.eventType)).toEqual([
      'task.status_changed',
    ]);
    expect(effects.audits).toBe(0);
  });

  it('the agent door bells the subscribers but raises no platform event (self-trigger loop safety)', async () => {
    const task = taskRow({ status: 'in_progress' });
    await expect(
      agentUpdateTaskStatusTrusted(fakeTx(task).tx, {
        organizationId: 'org-1',
        actorId: 'agent-1',
        taskId: task.id,
        status: 'in_review',
      }),
    ).resolves.toEqual({ ok: true });
    const effects = sideEffects();
    expect(effects.bells).toEqual([
      {
        task,
        fromStatus: 'in_progress',
        toStatus: 'in_review',
        actorType: 'agent',
        actorId: 'agent-1',
      },
    ]);
    expect(effects.events).toEqual([]);
    expect(effects.audits).toBe(0);
    expect(effects.hints).toEqual(['task:t-1']);
  });
});

/** The run the settle names is live on the fixture task. */
const liveRunAnswer = (text: string): unknown[] | undefined =>
  text.startsWith('SELECT id FROM app.project_agent_runs WHERE id = ?')
    ? [{ id: 'run-1' }]
    : undefined;

describe('the settle’s park only moves a card still In progress for its run', () => {
  it('parks and mints when the card is In progress and the run is live', async () => {
    const task = taskRow({ status: 'in_progress' });
    await expect(
      agentUpdateTaskStatusTrusted(fakeTx(task, liveRunAnswer).tx, {
        organizationId: 'org-1',
        actorId: 'agent-1',
        taskId: task.id,
        status: 'in_review',
        review: { runId: 'run-1' },
      }),
    ).resolves.toEqual({ ok: true });
    expect(sideEffects().bells).toHaveLength(1);
  });

  it('refuses TASK_MOVED when a person already closed the card — done stays done', async () => {
    const task = taskRow({ status: 'done', completedAt: 1234 });
    const { tx, statements } = fakeTx(task, liveRunAnswer);
    await expect(
      agentUpdateTaskStatusTrusted(tx, {
        organizationId: 'org-1',
        actorId: 'agent-1',
        taskId: task.id,
        status: 'in_review',
        review: { runId: 'run-1' },
      }),
    ).resolves.toEqual({ ok: false, reason: 'TASK_MOVED' });
    // No write, no bell, no review mint: the transition never happened.
    expect(
      statements.some((text) => text.startsWith('UPDATE app.tasks SET')),
    ).toBe(false);
    expect(sideEffects()).toEqual({
      bells: [],
      events: [],
      audits: 0,
      hints: [],
    });
    expect(requestTaskReview).not.toHaveBeenCalled();
  });

  it('refuses TASK_MOVED when the card was sent back to To do meanwhile', async () => {
    const task = taskRow({ status: 'todo' });
    await expect(
      agentUpdateTaskStatusTrusted(fakeTx(task, liveRunAnswer).tx, {
        organizationId: 'org-1',
        actorId: 'agent-1',
        taskId: task.id,
        status: 'in_review',
        review: { runId: 'run-1' },
      }),
    ).resolves.toEqual({ ok: false, reason: 'TASK_MOVED' });
    expect(sideEffects().bells).toEqual([]);
  });

  it('refuses RUN_NOT_LIVE when the named run was cancelled during its last window', async () => {
    const task = taskRow({ status: 'in_progress' });
    await expect(
      agentUpdateTaskStatusTrusted(fakeTx(task).tx, {
        organizationId: 'org-1',
        actorId: 'agent-1',
        taskId: task.id,
        status: 'in_review',
        review: { runId: 'run-1' },
      }),
    ).resolves.toEqual({ ok: false, reason: 'RUN_NOT_LIVE' });
    expect(sideEffects().bells).toEqual([]);
  });

  it('a replayed settle on an already-parked card stays idempotent', async () => {
    const task = taskRow({ status: 'in_review' });
    await expect(
      agentUpdateTaskStatusTrusted(fakeTx(task).tx, {
        organizationId: 'org-1',
        actorId: 'agent-1',
        taskId: task.id,
        status: 'in_review',
        review: { runId: 'run-1' },
      }),
    ).resolves.toEqual({ ok: true });
    expect(requestTaskReview).toHaveBeenCalledTimes(1);
  });
});

/** The task's live run, as the human doors look it up on a leave. */
const taskLiveRunAnswer = (text: string): unknown[] | undefined =>
  text.startsWith('SELECT id FROM app.project_agent_runs WHERE task_id = ?')
    ? [{ id: 'run-live' }]
    : undefined;

describe('leaving In progress through a human door cancels the live run', () => {
  it('the picker cancels the task’s live run on the way out', async () => {
    const task = taskRow({
      status: 'in_progress',
      assigneeType: 'agent',
      assigneeId: 'agent-1',
    });
    await updateTaskStatus(
      fakeTx(task, taskLiveRunAnswer).tx,
      auth,
      task.id,
      'done',
    );
    expect(cancelAgentRunInTx).toHaveBeenCalledTimes(1);
    expect(vi.mocked(cancelAgentRunInTx).mock.calls[0]?.[1]).toEqual({
      organizationId: 'org-1',
      runId: 'run-live',
      taskId: 't-1',
    });
  });

  it('the drag cancels it too, and a move INTO In progress cancels nothing', async () => {
    const task = taskRow({ status: 'in_progress' });
    await moveTask(fakeTx(task, taskLiveRunAnswer).tx, auth, {
      taskId: task.id,
      status: 'cancelled',
    });
    expect(cancelAgentRunInTx).toHaveBeenCalledTimes(1);

    vi.mocked(cancelAgentRunInTx).mockReset();
    const idle = taskRow({ status: 'todo' });
    await updateTaskStatus(
      fakeTx(idle, taskLiveRunAnswer).tx,
      auth,
      idle.id,
      'in_progress',
    );
    expect(cancelAgentRunInTx).not.toHaveBeenCalled();
  });

  it('a leave with no live run cancels nothing', async () => {
    const task = taskRow({ status: 'in_progress' });
    await updateTaskStatus(fakeTx(task).tx, auth, task.id, 'todo');
    expect(cancelAgentRunInTx).not.toHaveBeenCalled();
  });
});

/** What createTask's collaborators answer: the project counter, the insert,
 * the assignee's agent row, and the agent the kick resolves. */
const createAnswers = (text: string): unknown[] | undefined => {
  if (text.startsWith('UPDATE app.projects SET task_counter')) {
    return [{ taskCounter: 7 }];
  }
  if (text.startsWith('INSERT INTO app.tasks')) return [{ id: 't-1' }];
  if (text.startsWith('SELECT id FROM app.project_agents WHERE id = ?')) {
    return [{ id: 'agent-1' }];
  }
  if (text.startsWith('SELECT id, harness, model, model_provider')) {
    return [
      {
        id: 'agent-1',
        harness: 'claude-code',
        model: 'm',
        modelProvider: null,
      },
    ];
  }
  return undefined;
};

describe('a card born in a column gets the column’s choreography', () => {
  it('created at In progress for an agent → the run is kicked in the same transaction', async () => {
    const { tx } = fakeTx(taskRow(), createAnswers);
    await expect(
      createTask(tx, auth, {
        projectId: 'p-1',
        title: 'Born busy',
        status: 'in_progress',
        assigneeType: 'agent',
        assigneeId: 'agent-1',
      }),
    ).resolves.toBe('t-1');
    expect(kickAgentRun).toHaveBeenCalledTimes(1);
    expect(vi.mocked(kickAgentRun).mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        organizationId: 'org-1',
        projectId: 'p-1',
        taskId: 't-1',
        agentId: 'agent-1',
        startedBy: 'u-owner',
        trigger: 'manual',
      }),
    );
  });

  it('created at In review → the review gate opens on the new card', async () => {
    const created = taskRow({ status: 'in_review' });
    const { tx } = fakeTx(created, createAnswers);
    await createTask(tx, auth, {
      projectId: 'p-1',
      title: 'Born for review',
      status: 'in_review',
    });
    expect(requestTaskReview).toHaveBeenCalledTimes(1);
    expect(vi.mocked(requestTaskReview).mock.calls[0]?.[1]).toEqual({
      task: created,
      trigger: { kind: 'human', actorId: 'u-owner' },
    });
    expect(kickAgentRun).not.toHaveBeenCalled();
  });

  it('created at To do (or In progress for a person) kicks nothing and mints nothing', async () => {
    await createTask(fakeTx(taskRow(), createAnswers).tx, auth, {
      projectId: 'p-1',
      title: 'Plain',
    });
    await createTask(fakeTx(taskRow(), createAnswers).tx, auth, {
      projectId: 'p-1',
      title: 'Mine',
      status: 'in_progress',
      assigneeType: 'user',
      assigneeId: 'u-owner',
    });
    expect(kickAgentRun).not.toHaveBeenCalled();
    expect(requestTaskReview).not.toHaveBeenCalled();
  });
});
