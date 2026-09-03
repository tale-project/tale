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
import {
  agentUpdateTaskStatusTrusted,
  bulkUpdateTasks,
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
vi.mock('./agent-runs.ts', () => ({ kickAgentRun: vi.fn() }));
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
function fakeTx(fixture: TaskRow): {
  tx: TransactionSql;
  statements: string[];
} {
  const statements: string[] = [];
  const answer = (text: string): unknown[] => {
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

  it('the bulk bar (/bulk) with a status is every card through the picker seam', async () => {
    const task = taskRow();
    const { tx } = fakeTx(task);
    await expect(
      bulkUpdateTasks(tx, auth, { taskIds: [task.id], status: 'done' }),
    ).resolves.toEqual({ updated: 1, skipped: 0 });
    const effects = sideEffects();
    expect(effects.bells).toEqual([
      {
        task,
        fromStatus: 'todo',
        toStatus: 'done',
        actorType: 'user',
        actorId: 'u-owner',
      },
    ]);
    expect(effects.events.map((e) => e.eventType)).toEqual([
      'task.status_changed',
    ]);
    expect(effects.events[0]?.eventData).toMatchObject({
      taskId: 't-1',
      fromStatus: 'todo',
      toStatus: 'done',
      actorType: 'user',
    });
    expect(effects.audits).toBe(1);
    // The activity line carries the board hint; no second bare hint.
    expect(effects.hints).toEqual(['task:t-1']);
  });

  it('the bulk bar with a new assignee fans out like the assign verb', async () => {
    const task = taskRow();
    const { tx } = fakeTx(task);
    await expect(
      bulkUpdateTasks(tx, auth, {
        taskIds: [task.id],
        assigneeType: 'user',
        assigneeId: 'u-mate',
      }),
    ).resolves.toEqual({ updated: 1, skipped: 0 });
    expect(vi.mocked(notifyTaskAssigned)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notifyTaskAssigned).mock.calls[0]?.[1]).toEqual({
      task,
      assigneeType: 'user',
      assigneeId: 'u-mate',
      actorType: 'user',
      actorId: 'u-owner',
      previousAssigneeType: null,
      previousAssigneeId: null,
    });
    expect(vi.mocked(notifyTaskStatusChanged)).not.toHaveBeenCalled();
    expect(vi.mocked(emitEvent)).not.toHaveBeenCalled();
    expect(sideEffects().hints).toEqual(['task:t-1']);
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
