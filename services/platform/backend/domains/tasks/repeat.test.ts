import type { TransactionSql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaskRepeat } from '../../../lib/shared/task-repeat.ts';
import { findOrganizationMember } from '../../auth/membership.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { autoSubscribe } from '../collab/service.ts';
import { emitEvent } from '../events/emit.ts';
import { loadProjectOrThrow, type ProjectRow } from '../projects/service.ts';
import {
  createDueRepeatCopy,
  createNextRepeatCopy,
  REPEAT_OPEN_COPIES_MAX,
  repeatCopyDueAt,
} from './repeat.ts';
import { agentReviewerEligibility, reviewerEligibility } from './reviews.ts';
import {
  agentUpdateTaskStatusTrusted,
  assignTask,
  createTask,
  moveTask,
  type TaskRow,
  updateTask,
  updateTaskStatus,
} from './service.ts';

vi.mock('../collab/service.ts', () => ({
  autoSubscribe: vi.fn(),
  notifyTaskAssigned: vi.fn(),
  notifyTaskMentions: vi.fn(),
  notifyTaskReviewerAssigned: vi.fn(),
  notifyTaskStatusChanged: vi.fn(),
}));
vi.mock('../events/emit.ts', () => ({ emitEvent: vi.fn() }));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));
vi.mock('../../auth/membership.ts', () => ({
  findOrganizationMember: vi.fn(),
}));
vi.mock('./reviews.ts', () => ({
  agentReviewerEligibility: vi.fn(),
  reviewerEligibility: vi.fn(),
  closePendingTaskReviewOnStatusLeave: vi.fn(),
  collectPendingReviewsForProjects: vi.fn(() => Promise.resolve([])),
  requestTaskReview: vi.fn(),
  retargetPendingTaskReview: vi.fn(),
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
 * A repeating task continues on a copy when it closes: exactly one, through
 * every status door, dated to the rule's next occurrence, carrying the work
 * and the people who still hold, and never at the cost of the close itself.
 * The transaction is the recording stand-in the settle suite uses; the
 * collaborators with side effects outside the task rows are module mocks.
 */

const ZURICH = 'Europe/Zurich';
/** Monday 2026-09-28, 12:00 in Zurich. */
const NOW = Date.UTC(2026, 8, 28, 10);
/** Midnight in Zurich on Monday 21 and Friday 18 September 2026. */
const MONDAY_21 = Date.UTC(2026, 8, 20, 22);
const FRIDAY_18 = Date.UTC(2026, 8, 17, 22);
/** The copy's dates: Monday 28 September, three days' lead kept. */
const MONDAY_28 = Date.UTC(2026, 8, 27, 22);
const FRIDAY_25 = Date.UTC(2026, 8, 24, 22);

const weeklyOnMonday: TaskRepeat = {
  frequency: 'weekly',
  interval: 1,
  weekdays: [1],
  timezone: ZURICH,
};

const auth = {
  organizationId: 'org-1',
  userId: 'u-closer',
  email: 'closer@example.com',
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
  taskCounter: 7,
  openTaskCount: 1,
  doneTaskCount: 0,
  projectAgentCount: 0,
  defaultTaskReviewerAgentId: null,
  teamId: null,
  sharedWithTeamIds: [],
  teamIds: [],
  instructions: null,
  createdBy: 'u-author',
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
    title: 'Send the weekly report',
    description: 'Numbers from the dashboard',
    attachments: [
      {
        fileId: 's3:ref-1',
        fileName: 'template.xlsx',
        fileType: '',
        fileSize: 9,
      },
    ],
    outputs: [{ fileId: 's3:out-1', fileName: 'report.pdf' }],
    number: 7,
    status: 'in_progress',
    priority: 'p1',
    labelIds: ['lbl-ops'],
    assigneeType: null,
    assigneeId: null,
    reviewerUserId: null,
    reviewerAgentId: null,
    parentTaskId: null,
    commentCount: 3,
    rank: 'a0',
    externalSystem: null,
    externalId: null,
    externalUrl: null,
    threadId: null,
    discussionThreadId: 'thread-1',
    sourceDiscussionThreadId: null,
    startDate: FRIDAY_18,
    startNotifiedAt: 5,
    dueDate: MONDAY_21,
    slaLevel: 2,
    slaLevelAt: 6,
    statusChangedAt: 4,
    totalCostCents: 120,
    agentRunCount: 2,
    lastAgentRunAt: 3,
    claimedAt: 2,
    completedAt: null,
    externalClosedAt: null,
    repeat: weeklyOnMonday,
    repeatNextTaskId: null,
    repeatContinued: false,
    createdBy: 'u-author',
    createdByType: 'user',
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
    ...overrides,
  };
}

interface Statement {
  text: string;
  values: unknown[];
}

/** The task's series state and dates as the row lock reads them back — a
 * fixture that has not continued its series yet. */
function lockedState(task: TaskRow) {
  return {
    repeat: task.repeat,
    repeatContinuedAt: null,
    seriesId: null,
    seriesPosition: null,
    archivedAt: task.archivedAt,
    parentTaskId: task.parentTaskId,
    assigneeType: task.assigneeType,
    assigneeId: task.assigneeId,
    createdByType: task.createdByType,
    status: task.status,
    startDate: task.startDate,
    dueDate: task.dueDate,
  };
}

const LOCK_SELECT = 'SELECT repeat_rule AS "repeat"';

/**
 * The recording transaction: answers the task load with the fixture, the
 * row lock with the fixture's series state, a member lookup with the role
 * `members` gives that user (the series author is a plain member), the
 * project counter with 8, the copy's insert with `t-2`, and the rest with
 * no rows unless `extra` scripts it. A savepoint runs its callback on the
 * same recorder and marks where it opened and rolled back.
 */
function fakeTx(
  fixture: TaskRow,
  extra: (text: string) => unknown[] | undefined = () => undefined,
  members: Record<string, string> = { 'u-author': 'member' },
): { tx: TransactionSql; statements: Statement[] } {
  const statements: Statement[] = [];
  const answer = (text: string, values: unknown[]): unknown[] => {
    const scripted = extra(text);
    if (scripted !== undefined) return scripted;
    if (text.startsWith('SELECT ? FROM app.tasks WHERE id = ?')) {
      return [fixture];
    }
    if (text.startsWith(LOCK_SELECT)) return [lockedState(fixture)];
    if (text.startsWith('SELECT "role" FROM "member"')) {
      const role = members[String(values[1])];
      return role === undefined ? [] : [{ role }];
    }
    if (text.startsWith('UPDATE app.projects SET task_counter')) {
      return [{ taskCounter: 8 }];
    }
    if (text.startsWith('INSERT INTO app.tasks')) return [{ id: 't-2' }];
    return [];
  };
  const tag = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    statements.push({ text, values });
    try {
      return Promise.resolve(answer(text, values));
    } catch (error) {
      return Promise.reject(error);
    }
  };
  const tx = Object.assign(tag, {
    json: (value: unknown) => ({ json: value }),
    unsafe: (text: string): unknown => text,
    savepoint: async (
      callback: (sp: TransactionSql) => Promise<unknown>,
    ): Promise<unknown> => {
      statements.push({ text: 'SAVEPOINT', values: [] });
      try {
        return await callback(transaction);
      } catch (error) {
        statements.push({ text: 'ROLLBACK TO SAVEPOINT', values: [] });
        throw error;
      }
    },
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a four-member stand-in for the postgres.js transaction function
  const transaction = tx as unknown as TransactionSql;
  return { tx: transaction, statements };
}

/** A copy's INSERT, its values named by column. */
function namedInsert(insert: Statement): Record<string, unknown> {
  const v = insert.values;
  return {
    organizationId: v[0],
    projectId: v[1],
    title: v[2],
    description: v[3],
    attachments: v[4],
    priority: v[5],
    labelIds: v[6],
    assigneeType: v[7],
    assigneeId: v[8],
    reviewerUserId: v[9],
    reviewerAgentId: v[23],
    parentTaskId: v[10],
    startDate: v[11],
    dueDate: v[12],
    repeat: v[13],
    number: v[15],
    createdBy: v[16],
    createdByType: v[17],
    createdAt: v[18],
    updatedAt: v[19],
  };
}

/** Every copy INSERT, in the order they were written. */
function copyInserts(statements: Statement[]): Record<string, unknown>[] {
  return statements
    .filter((statement) => statement.text.startsWith('INSERT INTO app.tasks'))
    .map(namedInsert);
}

/** The series copy's INSERT — the first one a write makes. */
function copyInsert(statements: Statement[]): Record<string, unknown> | null {
  return copyInserts(statements)[0] ?? null;
}

/** The series ends: its rule column cleared. */
function ruleClears(statements: Statement[]): unknown[][] {
  return statements
    .filter((statement) =>
      statement.text.startsWith('UPDATE app.tasks SET repeat_rule = NULL'),
    )
    .map((statement) => statement.values);
}

function activityRows(statements: Statement[]) {
  return statements
    .filter((statement) =>
      statement.text.startsWith('INSERT INTO app.task_activity'),
    )
    .map((statement) => ({
      taskId: statement.values[1],
      actorType: statement.values[3],
      actorId: statement.values[4],
      action: statement.values[5],
      fromValue: statement.values[6],
      toValue: statement.values[7],
    }));
}

/** The writes that record the copy: the pointer that names it and the
 * stamp that says the task continued, in the one UPDATE. */
function pointerWrites(statements: Statement[]): unknown[][] {
  return statements
    .filter((statement) =>
      statement.text.startsWith(
        'UPDATE app.tasks SET repeat_next_task_id = ?, repeat_continued_at_ms = ?',
      ),
    )
    .map((statement) => statement.values);
}

const activeMember = {
  id: 'm-1',
  organizationId: 'org-1',
  userId: 'u-any',
  role: 'member',
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  vi.mocked(loadProjectOrThrow).mockResolvedValue(project);
  vi.mocked(findOrganizationMember).mockResolvedValue(activeMember);
  vi.mocked(reviewerEligibility).mockResolvedValue('eligible');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('closing a repeating task creates its next copy', () => {
  it('open → done: one copy in To do, dated to the next Monday with the start’s lead kept', async () => {
    const { tx, statements } = fakeTx(taskRow());
    await expect(updateTaskStatus(tx, auth, 't-1', 'done')).resolves.toEqual({
      id: 't-2',
      number: 8,
      dueDate: MONDAY_28,
    });

    expect(copyInsert(statements)).toEqual({
      organizationId: 'org-1',
      projectId: 'p-1',
      title: 'Send the weekly report',
      description: 'Numbers from the dashboard',
      attachments: {
        json: [
          {
            fileId: 's3:ref-1',
            fileName: 'template.xlsx',
            fileType: '',
            fileSize: 9,
          },
        ],
      },
      priority: 'p1',
      labelIds: ['lbl-ops'],
      assigneeType: null,
      assigneeId: null,
      reviewerUserId: null,
      reviewerAgentId: null,
      startDate: FRIDAY_25,
      dueDate: MONDAY_28,
      repeat: { json: weeklyOnMonday },
      number: 8,
      // The series author stays the author; the closer is on the timeline.
      createdBy: 'u-author',
      createdByType: 'user',
      // A copy never hangs under a parent.
      parentTaskId: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const insert = statements.find((s) =>
      s.text.startsWith('INSERT INTO app.tasks'),
    );
    expect(insert?.text).toContain("'todo'");
    // Nothing of the closed card's history rides along.
    expect(insert?.text).not.toMatch(
      /outputs|external_|thread_id|sla_level|completed_at|claimed_at|agent_run/,
    );

    expect(pointerWrites(statements)).toEqual([['t-2', NOW, 't-1', 0, 't-1']]);
    expect(
      activityRows(statements).filter((row) => row.action !== 'status.changed'),
    ).toEqual([
      {
        taskId: 't-2',
        actorType: 'user',
        actorId: 'u-closer',
        action: 'created',
        fromValue: null,
        toValue: 'todo',
      },
      {
        taskId: 't-1',
        actorType: 'user',
        actorId: 'u-closer',
        action: 'repeat.next',
        fromValue: null,
        toValue: 'BRD-8',
      },
    ]);
    // The copy counts as a new open card.
    expect(
      statements.some(
        (s) =>
          s.text.startsWith('UPDATE app.projects SET open_task_count') &&
          s.values[0] === 1,
      ),
    ).toBe(true);
    expect(
      vi.mocked(emitEvent).mock.calls.map(([, event]) => event),
    ).toContainEqual({
      organizationId: 'org-1',
      eventType: 'task.created',
      eventData: {
        taskId: 't-2',
        projectId: 'p-1',
        actorType: 'user',
        actorId: 'u-closer',
      },
    });
    // Nobody watched the task, so nobody follows the copy — the series
    // author included: they follow a copy only through their own watch.
    expect(autoSubscribe).not.toHaveBeenCalled();
    // The status change's audit row and the copy's created row.
    expect(
      vi.mocked(createAuditLog).mock.calls.map(([, row]) => row.action),
    ).toEqual(['task.status_changed', 'task.created']);
  });

  it('open → cancelled through the board drag creates it too, and the door answers it', async () => {
    const { tx, statements } = fakeTx(taskRow({ status: 'todo' }));
    await expect(
      moveTask(tx, auth, { taskId: 't-1', status: 'cancelled' }),
    ).resolves.toEqual({ id: 't-2', number: 8, dueDate: MONDAY_28 });
    expect(pointerWrites(statements)).toHaveLength(1);
  });

  it('the agent lane’s cancel creates it as the agent’s act: audited as the api actor, with no task.created event', async () => {
    const { tx, statements } = fakeTx(taskRow());
    await expect(
      agentUpdateTaskStatusTrusted(tx, {
        organizationId: 'org-1',
        actorId: 'agent-1',
        taskId: 't-1',
        status: 'cancelled',
      }),
    ).resolves.toEqual({ ok: true });
    expect(copyInsert(statements)?.createdBy).toBe('u-author');
    expect(
      activityRows(statements)
        .filter((row) => row.action !== 'status.changed')
        .map((row) => [row.taskId, row.actorType, row.actorId, row.action]),
    ).toEqual([
      ['t-2', 'agent', 'agent-1', 'created'],
      ['t-1', 'agent', 'agent-1', 'repeat.next'],
    ]);
    // The copy's creation is on the audit chain as the agent's own task
    // creation is; the lane's status change stays unaudited.
    expect(vi.mocked(createAuditLog).mock.calls.map(([, row]) => row)).toEqual([
      {
        organizationId: 'org-1',
        actorId: 'agent-1',
        actorType: 'api',
        action: 'task.created',
        category: 'data',
        resourceType: 'task',
        resourceId: 't-2',
        resourceName: 'Send the weekly report',
        metadata: {
          viaAgent: true,
          projectId: 'p-1',
          parentTaskId: null,
          repeatOf: 't-1',
        },
        status: 'success',
      },
    ]);
    // An automation that cancels new tasks would otherwise cancel every
    // copy its own cancel created, without end.
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it('a task with no dates is due on the rule’s next day after today', async () => {
    const { tx, statements } = fakeTx(
      taskRow({ startDate: null, dueDate: null }),
    );
    await updateTaskStatus(tx, auth, 't-1', 'done');
    const copy = copyInsert(statements);
    expect(copy?.startDate).toBeNull();
    expect(copy?.dueDate).toBe(Date.UTC(2026, 9, 4, 22));
  });

  it('a copy closed weeks late comes back due this week, not already overdue', async () => {
    const { tx, statements } = fakeTx(
      taskRow({ startDate: null, dueDate: Date.UTC(2026, 7, 30, 22) }),
    );
    await updateTaskStatus(tx, auth, 't-1', 'done');
    expect(copyInsert(statements)?.dueDate).toBe(MONDAY_28);
  });
});

describe('a close continues the series once, and only from an open card', () => {
  it.each([
    ['done → cancelled', taskRow({ status: 'done' }), 'cancelled'],
    ['open → open', taskRow({ status: 'todo' }), 'in_progress'],
    ['an archived task', taskRow({ archivedAt: 9 }), 'done'],
    ['a task with no rule', taskRow({ repeat: null }), 'done'],
    [
      'a task whose copy exists',
      taskRow({ repeatNextTaskId: 't-0', repeatContinued: true }),
      'done',
    ],
    [
      'a task whose copy was deleted since',
      taskRow({ repeatNextTaskId: null, repeatContinued: true }),
      'done',
    ],
    ['a subtask', taskRow({ parentTaskId: 't-parent' }), 'done'],
    [
      'a task assigned to an automation',
      taskRow({ assigneeType: 'app', assigneeId: 'vat-desk' }),
      'done',
    ],
    [
      'an unassigned task an automation filed',
      taskRow({ createdBy: 'vat-desk', createdByType: 'app' }),
      'cancelled',
    ],
    [
      'a stored rule that no longer validates',
      taskRow({ repeat: { ...weeklyOnMonday, timezone: 'Mars/Olympus_Mons' } }),
      'done',
    ],
  ] as const)('%s creates nothing', async (_name, task, toStatus) => {
    const { tx, statements } = fakeTx(task);
    await expect(
      createNextRepeatCopy(tx, {
        task,
        toStatus,
        actorType: 'user',
        actorId: 'u-closer',
      }),
    ).resolves.toBeNull();
    expect(statements).toEqual([]);
  });

  it('a copy written since the task was read wins — nothing is inserted', async () => {
    const task = taskRow();
    const { tx, statements } = fakeTx(task, (text) =>
      text.startsWith(LOCK_SELECT)
        ? [{ ...lockedState(task), repeatContinuedAt: NOW - 1 }]
        : undefined,
    );
    await expect(
      createNextRepeatCopy(tx, {
        task,
        toStatus: 'done',
        actorType: 'user',
        actorId: 'u-closer',
      }),
    ).resolves.toBeNull();
    expect(statements[1]?.text).toContain('FOR UPDATE');
    expect(copyInsert(statements)).toBeNull();
  });

  it.each([
    ['its rule was removed', { repeat: null }],
    ['it was archived', { archivedAt: 9 }],
    [
      'it was handed to an automation',
      { assigneeType: 'app', assigneeId: 'x' },
    ],
    ['it holds a rule that no longer validates', { repeat: { every: 'week' } }],
  ] as const)(
    'the row under its lock decides: nothing is inserted when %s since it was read',
    async (_name, since) => {
      const task = taskRow();
      const { tx, statements } = fakeTx(task, (text) =>
        text.startsWith(LOCK_SELECT)
          ? [{ ...lockedState(task), ...since }]
          : undefined,
      );
      await expect(
        createNextRepeatCopy(tx, {
          task,
          toStatus: 'cancelled',
          actorType: 'agent',
          actorId: 'workflow',
        }),
      ).resolves.toBeNull();
      expect(statements[1]?.text).toContain('FOR UPDATE');
      expect(copyInsert(statements)).toBeNull();
      expect(pointerWrites(statements)).toEqual([]);
    },
  );

  it('a task whose copy was deleted never continues again: its pointer is clear, but the lock reads that it continued', async () => {
    // Reopened after its copy was deleted, and closed again.
    const task = taskRow({ status: 'todo', repeatNextTaskId: null });
    const { tx, statements } = fakeTx(task, (text) =>
      text.startsWith(LOCK_SELECT)
        ? [{ ...lockedState(task), repeatContinuedAt: NOW - 1 }]
        : undefined,
    );
    await expect(updateTaskStatus(tx, auth, 't-1', 'done')).resolves.toBeNull();
    const lock = statements.find((s) => s.text.startsWith(LOCK_SELECT));
    expect(lock?.text).toContain(
      'repeat_continued_at_ms::float8 AS "repeatContinuedAt"',
    );
    expect(copyInsert(statements)).toBeNull();
    expect(pointerWrites(statements)).toEqual([]);
  });

  it('the copy carries the rule the lock read, not the one the task was loaded with', async () => {
    const task = taskRow();
    const daily: TaskRepeat = {
      frequency: 'daily',
      interval: 1,
      timezone: ZURICH,
    };
    const { tx, statements } = fakeTx(task, (text) =>
      text.startsWith(LOCK_SELECT)
        ? [{ ...lockedState(task), repeat: daily }]
        : undefined,
    );
    await createNextRepeatCopy(tx, {
      task,
      toStatus: 'done',
      actorType: 'user',
      actorId: 'u-closer',
    });
    expect(copyInsert(statements)?.repeat).toEqual({ json: daily });
  });

  it('an archived project keeps the rule and creates nothing', async () => {
    vi.mocked(loadProjectOrThrow).mockResolvedValue({
      ...project,
      archivedAt: 5,
    });
    const task = taskRow();
    const { tx, statements } = fakeTx(task);
    await expect(
      createNextRepeatCopy(tx, {
        task,
        toStatus: 'cancelled',
        actorType: 'agent',
        actorId: 'agent-1',
      }),
    ).resolves.toBeNull();
    expect(copyInsert(statements)).toBeNull();
  });
});

describe('the people and the parent carry over while they still hold', () => {
  it('an agent no longer in the project is dropped: the copy starts unassigned', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { tx, statements } = fakeTx(
      taskRow({ assigneeType: 'agent', assigneeId: 'agent-gone' }),
    );
    await updateTaskStatus(tx, auth, 't-1', 'done');
    const copy = copyInsert(statements);
    expect(copy?.assigneeType).toBeNull();
    expect(copy?.assigneeId).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('AGENT_NOT_ALLOWED_IN_PROJECT'),
    );
  });

  it('an automation’s task a person held ends its series when that person cannot carry over', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { tx, statements } = fakeTx(
      taskRow({
        assigneeType: 'agent',
        assigneeId: 'agent-gone',
        createdByType: 'app',
      }),
    );
    await expect(updateTaskStatus(tx, auth, 't-1', 'done')).resolves.toBeNull();
    expect(copyInsert(statements)).toBeNull();
    expect(pointerWrites(statements)).toEqual([]);
    // The series ends on the row and the timeline, credited to the closer,
    // inside the close's savepoint — so no later close meets the rule.
    expect(ruleClears(statements)).toEqual([['t-1']]);
    expect(statements.map((s) => s.text)).not.toContain(
      'ROLLBACK TO SAVEPOINT',
    );
    expect(
      activityRows(statements).filter((row) => row.action === 'repeat.changed'),
    ).toEqual([
      {
        taskId: 't-1',
        actorType: 'user',
        actorId: 'u-closer',
        action: 'repeat.changed',
        fromValue: JSON.stringify(weeklyOnMonday),
        toValue: null,
      },
    ]);
    // One line says why, and none claims a copy went out unassigned.
    expect(warn.mock.calls).toEqual([
      [
        expect.stringMatching(
          /t-1: its series ends .*AGENT_NOT_ALLOWED_IN_PROJECT.*an automation filed it/,
        ),
      ],
    ]);
  });

  it('an agent still in the project keeps the copy', async () => {
    const { tx, statements } = fakeTx(
      taskRow({ assigneeType: 'agent', assigneeId: 'agent-1' }),
      (text) =>
        text.startsWith('SELECT id FROM app.project_agents')
          ? [{ id: 'agent-1' }]
          : undefined,
    );
    await updateTaskStatus(tx, auth, 't-1', 'done');
    expect(copyInsert(statements)).toMatchObject({
      assigneeType: 'agent',
      assigneeId: 'agent-1',
    });
  });

  it('a person checks against their own access, even when they are the closer', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { tx, statements } = fakeTx(
      taskRow({ assigneeType: 'user', assigneeId: 'u-closer' }),
    );
    await updateTaskStatus(tx, auth, 't-1', 'done');
    // No member row answered: the assignee lost their access.
    expect(copyInsert(statements)?.assigneeId).toBeNull();

    const kept = fakeTx(
      taskRow({ assigneeType: 'user', assigneeId: 'u-closer' }),
      (text) =>
        text.startsWith('SELECT "role" FROM "member"')
          ? [{ role: 'member' }]
          : undefined,
    );
    await updateTaskStatus(kept.tx, auth, 't-1', 'done');
    expect(copyInsert(kept.statements)).toMatchObject({
      assigneeType: 'user',
      assigneeId: 'u-closer',
    });
  });

  it('a reviewer who can no longer review in the project is dropped', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(reviewerEligibility).mockResolvedValue('cannot_edit');
    const { tx, statements } = fakeTx(taskRow({ reviewerUserId: 'u-rev' }));
    await updateTaskStatus(tx, auth, 't-1', 'done');
    expect(copyInsert(statements)?.reviewerUserId).toBeNull();
    // The review gate's own bar, asked of this project.
    expect(reviewerEligibility).toHaveBeenCalledWith(tx, {
      organizationId: 'org-1',
      projectTeamIds: project.teamIds,
      userId: 'u-rev',
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('reviewer'));
  });

  it('a reviewer who still can carries over', async () => {
    const { tx, statements } = fakeTx(taskRow({ reviewerUserId: 'u-rev' }));
    await updateTaskStatus(tx, auth, 't-1', 'done');
    expect(copyInsert(statements)?.reviewerUserId).toBe('u-rev');
  });

  it.each(['reviewer_unavailable', 'permission_missing'] as const)(
    'retains explicit agent review intent for repair after %s',
    async (eligibility) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.mocked(agentReviewerEligibility).mockResolvedValue(eligibility);
      const { tx, statements } = fakeTx(
        taskRow({ reviewerAgentId: 'reviewer-lost' }),
      );
      await updateTaskStatus(tx, auth, 't-1', 'done');
      expect(copyInsert(statements)).toMatchObject({
        reviewerUserId: null,
        reviewerAgentId: 'reviewer-lost',
      });
      expect(agentReviewerEligibility).toHaveBeenCalledWith(tx, {
        organizationId: 'org-1',
        projectId: 'p-1',
        agentId: 'reviewer-lost',
      });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(eligibility));
    },
  );

  /** The series author's own watch on the task, as the watcher read
   * answers it. */
  const authorWatches = (text: string) =>
    text.startsWith('SELECT task_id AS "taskId", subscriber_type')
      ? [
          {
            taskId: 't-1',
            subscriberType: 'user',
            subscriberId: 'u-author',
            muted: null,
          },
        ]
      : undefined;
  const authorOnCopy = {
    organizationId: 'org-1',
    taskId: 't-2',
    subscriberType: 'user',
    subscriberId: 'u-author',
    reason: 'repeat',
  };

  it('the series author who unwatched the task does not follow the copy', async () => {
    // No watch row answers: the author unsubscribed from the task.
    const { tx, statements } = fakeTx(taskRow());
    await updateTaskStatus(tx, auth, 't-1', 'done');
    expect(copyInsert(statements)).not.toBeNull();
    expect(autoSubscribe).not.toHaveBeenCalled();
  });

  it('the series author who still watches follows the copy as a carried watcher', async () => {
    const { tx } = fakeTx(taskRow(), authorWatches);
    await updateTaskStatus(tx, auth, 't-1', 'done');
    expect(vi.mocked(autoSubscribe).mock.calls.map(([, sub]) => sub)).toEqual([
      authorOnCopy,
    ]);
  });

  it('the series author is not carried once they are disabled', async () => {
    const { tx, statements } = fakeTx(taskRow(), authorWatches, {
      'u-author': 'disabled',
    });
    await updateTaskStatus(tx, auth, 't-1', 'done');
    expect(copyInsert(statements)).not.toBeNull();
    expect(autoSubscribe).not.toHaveBeenCalled();
  });

  it('the series author is not carried once they can no longer read the project', async () => {
    // A team project the author, a plain member in no team, cannot read.
    vi.mocked(loadProjectOrThrow).mockResolvedValue({
      ...project,
      teamIds: ['team-ops'],
      teamId: 'team-ops',
    });
    const { tx, statements } = fakeTx(taskRow(), authorWatches);
    await updateTaskStatus(tx, auth, 't-1', 'done');
    expect(copyInsert(statements)).not.toBeNull();
    expect(autoSubscribe).not.toHaveBeenCalled();

    vi.clearAllMocks();
    const inTeam = fakeTx(taskRow(), (text) =>
      text.startsWith('SELECT "teamId" FROM "teamMember"')
        ? [{ teamId: 'team-ops' }]
        : authorWatches(text),
    );
    await updateTaskStatus(inTeam.tx, auth, 't-1', 'done');
    expect(vi.mocked(autoSubscribe).mock.calls.map(([, sub]) => sub)).toEqual([
      authorOnCopy,
    ]);
  });
});

describe('the close never fails because of its repeat', () => {
  it('a failed copy rolls back its savepoint, is logged, and the close still answers', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { tx, statements } = fakeTx(taskRow(), (text) => {
      if (text.startsWith('INSERT INTO app.tasks')) {
        throw new Error('insert refused');
      }
      return undefined;
    });
    await expect(updateTaskStatus(tx, auth, 't-1', 'done')).resolves.toBeNull();
    expect(statements.map((s) => s.text)).toContain('ROLLBACK TO SAVEPOINT');
    expect(pointerWrites(statements)).toEqual([]);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('t-1'),
      expect.objectContaining({ message: 'insert refused' }),
    );
  });

  it('a serialization failure reruns the whole transaction instead', async () => {
    const { tx } = fakeTx(taskRow(), (text) => {
      if (text.startsWith('INSERT INTO app.tasks')) {
        throw Object.assign(new Error('could not serialize access'), {
          code: '40001',
        });
      }
      return undefined;
    });
    await expect(updateTaskStatus(tx, auth, 't-1', 'done')).rejects.toThrow(
      'could not serialize access',
    );
  });
});

describe('the rule on the create and edit doors', () => {
  it('createTask stores the rule normalized (weekdays in order)', async () => {
    const { tx, statements } = fakeTx(taskRow());
    await createTask(tx, auth, {
      projectId: 'p-1',
      title: 'Standup notes',
      repeat: { ...weeklyOnMonday, weekdays: [5, 1] },
    });
    const insert = statements.find((s) =>
      s.text.startsWith('INSERT INTO app.tasks'),
    );
    expect(insert?.text).toContain('repeat_rule');
    expect(insert?.values).toContainEqual({
      json: { ...weeklyOnMonday, weekdays: [1, 5] },
    });
  });

  it('createTask refuses a rule that does not validate with TASK_REPEAT_INVALID', async () => {
    const { tx } = fakeTx(taskRow());
    await expect(
      createTask(tx, auth, {
        projectId: 'p-1',
        title: 'Never',
        repeat: { ...weeklyOnMonday, interval: 0 },
      }),
    ).rejects.toMatchObject({ code: 'TASK_REPEAT_INVALID' });
  });

  it('updateTask records repeat.changed with both rules as JSON and writes the column', async () => {
    const monthly: TaskRepeat = {
      frequency: 'monthly',
      interval: 1,
      monthDay: 21,
      timezone: ZURICH,
    };
    const { tx, statements } = fakeTx(taskRow({ status: 'todo' }));
    await updateTask(tx, auth, { taskId: 't-1', repeat: monthly });
    expect(activityRows(statements)).toEqual([
      {
        taskId: 't-1',
        actorType: 'user',
        actorId: 'u-closer',
        action: 'repeat.changed',
        fromValue: JSON.stringify(weeklyOnMonday),
        toValue: JSON.stringify(monthly),
      },
    ]);
    const update = statements.find((s) =>
      s.text.startsWith('UPDATE app.tasks SET title'),
    );
    expect(update?.text).toContain('repeat_rule = CASE WHEN');
    expect(update?.values).toContainEqual({ json: monthly });
    const audit = vi.mocked(createAuditLog).mock.calls[0]?.[1];
    expect(audit?.previousState).toEqual({ repeat: weeklyOnMonday });
    expect(audit?.newState).toEqual({ repeat: monthly });
  });

  it('"does not repeat" clears the rule: the toValue is no value at all', async () => {
    const { tx, statements } = fakeTx(taskRow({ status: 'todo' }));
    await updateTask(tx, auth, { taskId: 't-1', repeat: null });
    expect(activityRows(statements)).toEqual([
      expect.objectContaining({
        action: 'repeat.changed',
        fromValue: JSON.stringify(weeklyOnMonday),
        toValue: null,
      }),
    ]);
  });

  it('the same rule re-sent from another zone is no change', async () => {
    const { tx, statements } = fakeTx(taskRow({ status: 'todo' }));
    await updateTask(tx, auth, {
      taskId: 't-1',
      repeat: { ...weeklyOnMonday, timezone: 'America/New_York' },
    });
    expect(
      statements.some((s) => s.text.startsWith('UPDATE app.tasks SET title')),
    ).toBe(false);
    expect(activityRows(statements)).toEqual([]);
  });

  it('updateTask refuses a rule that does not validate', async () => {
    const { tx } = fakeTx(taskRow({ status: 'todo' }));
    await expect(
      updateTask(tx, auth, {
        taskId: 't-1',
        repeat: { ...weeklyOnMonday, weekdays: [] },
      }),
    ).rejects.toMatchObject({ code: 'TASK_REPEAT_INVALID' });
  });
});

describe('only an open top-level task no automation owns can carry a rule', () => {
  it.each([
    ['a subtask', { parentTaskId: 't-parent' }, 'Subtasks do not repeat'],
    [
      'a task assigned to an automation',
      { assigneeType: 'app', assigneeId: 'vat-desk' },
      'Tasks an automation owns do not repeat',
    ],
    ['a task created done', { status: 'done' }, 'Only an open task can repeat'],
    [
      'a task created cancelled',
      { status: 'cancelled' },
      'Only an open task can repeat',
    ],
  ] as const)(
    'createTask refuses a rule on %s',
    async (_name, fields, message) => {
      const { tx, statements } = fakeTx(taskRow());
      await expect(
        createTask(tx, auth, {
          projectId: 'p-1',
          title: 'Weekly report',
          repeat: weeklyOnMonday,
          ...fields,
        }),
      ).rejects.toMatchObject({
        code: 'TASK_REPEAT_INVALID',
        status: 400,
        message,
      });
      expect(
        statements.some((s) => s.text.startsWith('INSERT INTO app.tasks')),
      ).toBe(false);
    },
  );

  it.each([
    ['a subtask', { parentTaskId: 't-parent' }, 'Subtasks do not repeat'],
    [
      'a task assigned to an automation',
      { assigneeType: 'app', assigneeId: 'vat-desk' },
      'Tasks an automation owns do not repeat',
    ],
    [
      'an unassigned task an automation filed',
      { createdBy: 'vat-desk', createdByType: 'app' },
      'Tasks an automation owns do not repeat',
    ],
    ['a done task', { status: 'done' }, 'Only an open task can repeat'],
    [
      'a cancelled task',
      { status: 'cancelled' },
      'Only an open task can repeat',
    ],
    [
      'an open task whose next task the due date already created',
      { repeatNextTaskId: 't-2', repeatContinued: true },
      'This task already created its next task',
    ],
    [
      'an open task whose next task was deleted since',
      { repeatNextTaskId: null, repeatContinued: true },
      'This task already created its next task',
    ],
  ] as const)(
    'updateTask refuses a rule on %s, and still lets "does not repeat" clear one',
    async (_name, fields, message) => {
      const refused = fakeTx(taskRow({ repeat: null, ...fields }));
      await expect(
        updateTask(refused.tx, auth, { taskId: 't-1', repeat: weeklyOnMonday }),
      ).rejects.toMatchObject({
        code: 'TASK_REPEAT_INVALID',
        status: 400,
        message,
      });
      expect(
        refused.statements.some((s) => s.text.startsWith('UPDATE app.tasks')),
      ).toBe(false);

      const cleared = fakeTx(taskRow(fields));
      await updateTask(cleared.tx, auth, { taskId: 't-1', repeat: null });
      expect(activityRows(cleared.statements)).toEqual([
        expect.objectContaining({ action: 'repeat.changed', toValue: null }),
      ]);
    },
  );

  it('a task that continued its series refuses even the rule it carries, while the rest of an edit still saves', async () => {
    const task = taskRow({ status: 'todo', repeatContinued: true });
    const refused = fakeTx(task);
    await expect(
      updateTask(refused.tx, auth, { taskId: 't-1', repeat: weeklyOnMonday }),
    ).rejects.toMatchObject({
      code: 'TASK_REPEAT_INVALID',
      status: 400,
      message: 'This task already created its next task',
    });
    expect(
      refused.statements.some((s) => s.text.startsWith('UPDATE app.tasks')),
    ).toBe(false);

    const edited = fakeTx(task);
    await updateTask(edited.tx, auth, {
      taskId: 't-1',
      title: 'Send the monthly report',
    });
    expect(activityRows(edited.statements)).toEqual([
      expect.objectContaining({ action: 'title.changed' }),
    ]);
  });

  it('a person may still create a repeating task for someone, or a subtask without one', async () => {
    const { tx, statements } = fakeTx(taskRow(), (text) =>
      text.startsWith('SELECT ? FROM app.tasks WHERE id = ?')
        ? [taskRow({ id: 't-parent', repeat: null })]
        : undefined,
    );
    await createTask(tx, auth, {
      projectId: 'p-1',
      title: 'Weekly report',
      status: 'in_review',
      assigneeType: 'user',
      assigneeId: 'u-closer',
      repeat: weeklyOnMonday,
    });
    await createTask(tx, auth, {
      projectId: 'p-1',
      title: 'Collect the numbers',
      parentTaskId: 't-parent',
    });
    expect(
      statements.filter((s) => s.text.startsWith('INSERT INTO app.tasks')),
    ).toHaveLength(2);
  });
});

describe('handing a task to an automation ends its series', () => {
  it('assigning a repeating task to an automation clears the rule and says so', async () => {
    const { tx, statements } = fakeTx(taskRow({ status: 'todo' }));
    await assignTask(tx, auth, {
      taskId: 't-1',
      assigneeType: 'app',
      assigneeId: 'vat-desk',
    });
    expect(ruleClears(statements)).toEqual([['t-1']]);
    expect(
      activityRows(statements).filter((row) => row.action === 'repeat.changed'),
    ).toEqual([
      {
        taskId: 't-1',
        actorType: 'user',
        actorId: 'u-closer',
        action: 'repeat.changed',
        fromValue: JSON.stringify(weeklyOnMonday),
        toValue: null,
      },
    ]);
  });

  it('unassigning a task an automation filed hands it back to that automation: the rule goes too', async () => {
    const { tx, statements } = fakeTx(
      taskRow({
        status: 'todo',
        assigneeType: 'user',
        assigneeId: 'u-closer',
        createdBy: 'vat-desk',
        createdByType: 'app',
      }),
    );
    await assignTask(tx, auth, { taskId: 't-1' });
    expect(ruleClears(statements)).toEqual([['t-1']]);
  });

  it.each([
    ['assigned to a person', taskRow({ status: 'todo' }), 'user', 'u-closer'],
    [
      'with no rule, assigned to an automation',
      taskRow({ status: 'todo', repeat: null }),
      'app',
      'vat-desk',
    ],
  ] as const)(
    'a task %s keeps what it has',
    async (_name, task, assigneeType, assigneeId) => {
      const { tx, statements } = fakeTx(task);
      await assignTask(tx, auth, { taskId: 't-1', assigneeType, assigneeId });
      expect(ruleClears(statements)).toEqual([]);
      expect(
        activityRows(statements).some((row) => row.action === 'repeat.changed'),
      ).toBe(false);
    },
  );
});

describe('when the next task is created: createOn on the create and edit doors', () => {
  const onDue: TaskRepeat = { ...weeklyOnMonday, createOn: 'dueDate' };

  it('createTask stores createOn when it is "dueDate", and drops the default "close"', async () => {
    const { tx, statements } = fakeTx(taskRow());
    await createTask(tx, auth, {
      projectId: 'p-1',
      title: 'Compliance review',
      repeat: onDue,
    });
    await createTask(tx, auth, {
      projectId: 'p-1',
      title: 'Weekly report',
      repeat: { ...weeklyOnMonday, createOn: 'close' },
    });
    const inserts = statements.filter((s) =>
      s.text.startsWith('INSERT INTO app.tasks'),
    );
    expect(inserts[0]?.values).toContainEqual({ json: onDue });
    expect(inserts[1]?.values).toContainEqual({ json: weeklyOnMonday });
  });

  it('switching createOn alone is a change: one repeat.changed line carrying it', async () => {
    const { tx, statements } = fakeTx(taskRow({ status: 'todo' }));
    await updateTask(tx, auth, { taskId: 't-1', repeat: onDue });
    expect(activityRows(statements)).toEqual([
      expect.objectContaining({
        action: 'repeat.changed',
        fromValue: JSON.stringify(weeklyOnMonday),
        toValue: JSON.stringify(onDue),
      }),
    ]);
    const update = statements.find((s) =>
      s.text.startsWith('UPDATE app.tasks SET title'),
    );
    expect(update?.values).toContainEqual({ json: onDue });
  });

  it('sending "close" to a rule that has no createOn changes nothing', async () => {
    const { tx, statements } = fakeTx(taskRow({ status: 'todo' }));
    await updateTask(tx, auth, {
      taskId: 't-1',
      repeat: { ...weeklyOnMonday, createOn: 'close' },
    });
    expect(activityRows(statements)).toEqual([]);
  });

  it('a copy carries the createOn of the rule it continues', async () => {
    const { tx, statements } = fakeTx(taskRow({ repeat: onDue }));
    await updateTaskStatus(tx, auth, 't-1', 'done');
    expect(copyInsert(statements)?.repeat).toEqual({ json: onDue });
  });
});

describe('the due-date lane continues an open task through the same writer', () => {
  const onDue: TaskRepeat = { ...weeklyOnMonday, createOn: 'dueDate' };
  /** Due today, Monday 28 September, still in To do. */
  const dueToday = () =>
    taskRow({
      status: 'todo',
      startDate: null,
      dueDate: MONDAY_28,
      repeat: onDue,
    });
  const OCTOBER_5 = Date.UTC(2026, 9, 4, 22);

  it('creates the next task as the system, and the task stays open', async () => {
    const { tx, statements } = fakeTx(dueToday());
    await expect(
      createDueRepeatCopy(tx, {
        organizationId: 'org-1',
        taskId: 't-1',
        now: NOW,
      }),
    ).resolves.toEqual({
      kind: 'created',
      copy: { id: 't-2', number: 8, dueDate: OCTOBER_5 },
    });
    // The same writer as a close: the row lock first, then one insert.
    expect(statements[1]?.text).toMatch(/^SELECT repeat_rule AS "repeat"/);
    expect(statements[1]?.text).toContain('FOR UPDATE');
    expect(copyInsert(statements)).toMatchObject({
      dueDate: OCTOBER_5,
      repeat: { json: onDue },
      createdBy: 'u-author',
    });
    // The original is never closed or edited — only its pointer is set.
    expect(
      statements.some((s) => s.text.startsWith('UPDATE app.tasks SET status')),
    ).toBe(false);
    expect(pointerWrites(statements)).toEqual([['t-2', NOW, 't-1', 0, 't-1']]);
    expect(
      activityRows(statements).map((row) => [
        row.taskId,
        row.actorType,
        row.actorId,
        row.action,
      ]),
    ).toEqual([
      ['t-2', 'agent', 'system', 'created'],
      ['t-1', 'agent', 'system', 'repeat.next'],
    ]);
    expect(vi.mocked(createAuditLog).mock.calls.map(([, row]) => row)).toEqual([
      expect.objectContaining({
        actorType: 'system',
        actorId: 'system',
        action: 'task.created',
        resourceId: 't-2',
        metadata: {
          projectId: 'p-1',
          parentTaskId: null,
          repeatOf: 't-1',
          createOn: 'dueDate',
        },
      }),
    ]);
    // Time-driven, so it cannot feed an automation's loop: it announces.
    expect(vi.mocked(emitEvent).mock.calls.map(([, event]) => event)).toEqual([
      {
        organizationId: 'org-1',
        eventType: 'task.created',
        eventData: {
          taskId: 't-2',
          projectId: 'p-1',
          actorType: 'system',
          actorId: 'system',
        },
      },
    ]);
  });

  it.each([
    ['it was closed', { status: 'done' }],
    ['its rule creates on close again', { repeat: weeklyOnMonday }],
    ['its due date moved to tomorrow', { dueDate: Date.UTC(2026, 8, 28, 22) }],
    ['its due date was cleared', { dueDate: null }],
    [
      'a close already continued it — its copy still there or deleted since',
      { repeatContinuedAt: NOW - 1 },
    ],
    ['it became a subtask', { parentTaskId: 't-parent' }],
    ['it was archived', { archivedAt: 9 }],
  ] as const)(
    'the locked row decides: nothing is created when %s',
    async (_name, since) => {
      const task = dueToday();
      const { tx, statements } = fakeTx(task, (text) =>
        text.startsWith(LOCK_SELECT)
          ? [{ ...lockedState(task), ...since }]
          : undefined,
      );
      await expect(
        createDueRepeatCopy(tx, {
          organizationId: 'org-1',
          taskId: 't-1',
          now: NOW,
        }),
      ).resolves.toEqual({ kind: 'skipped' });
      expect(copyInsert(statements)).toBeNull();
      expect(pointerWrites(statements)).toEqual([]);
    },
  );

  it('a task gone since the scan listed it is skipped', async () => {
    const { tx, statements } = fakeTx(dueToday(), (text) =>
      text.startsWith('SELECT ? FROM app.tasks WHERE id = ?') ? [] : undefined,
    );
    await expect(
      createDueRepeatCopy(tx, {
        organizationId: 'org-1',
        taskId: 't-1',
        now: NOW,
      }),
    ).resolves.toEqual({ kind: 'skipped' });
    expect(statements).toHaveLength(1);
  });

  it('an automation’s task whose person cannot carry over ends its series as the system, so the scan never meets it again', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { tx, statements } = fakeTx(
      taskRow({
        status: 'todo',
        startDate: null,
        dueDate: MONDAY_28,
        repeat: onDue,
        assigneeType: 'user',
        assigneeId: 'u-gone',
        createdByType: 'app',
      }),
    );
    await expect(
      createDueRepeatCopy(tx, {
        organizationId: 'org-1',
        taskId: 't-1',
        now: NOW,
      }),
    ).resolves.toEqual({ kind: 'skipped' });
    expect(copyInsert(statements)).toBeNull();
    expect(pointerWrites(statements)).toEqual([]);
    // The rule the scan's candidate query asks for is gone with the
    // series, so the next scan does not list the task.
    expect(ruleClears(statements)).toEqual([['t-1']]);
    expect(activityRows(statements)).toEqual([
      {
        taskId: 't-1',
        actorType: 'agent',
        actorId: 'system',
        action: 'repeat.changed',
        fromValue: JSON.stringify(onDue),
        toValue: null,
      },
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('an automation filed it'),
    );
  });

  it('the due day begins at midnight in the rule’s zone, not in UTC', async () => {
    // Due Tuesday 29 September: midnight in Zurich is 22:00 UTC on Monday.
    const tuesday = Date.UTC(2026, 8, 28, 22);
    const task = taskRow({
      status: 'todo',
      startDate: null,
      dueDate: tuesday,
      repeat: onDue,
    });
    const early = fakeTx(task);
    await expect(
      createDueRepeatCopy(early.tx, {
        organizationId: 'org-1',
        taskId: 't-1',
        now: tuesday - 1,
      }),
    ).resolves.toEqual({ kind: 'skipped' });
    const onTime = fakeTx(task);
    await expect(
      createDueRepeatCopy(onTime.tx, {
        organizationId: 'org-1',
        taskId: 't-1',
        now: tuesday,
      }),
    ).resolves.toMatchObject({ kind: 'created' });
  });

  it('reads a due date picked in another zone at its nearest midnight', () => {
    // Tuesday picked in New York is 04:00 UTC; the Zurich rule's Tuesday
    // began six hours earlier.
    const pickedInNewYork = Date.UTC(2026, 8, 29, 4);
    expect(repeatCopyDueAt(onDue, pickedInNewYork)).toBe(
      Date.UTC(2026, 8, 28, 22),
    );
    // Absent createOn is "on close": the due-date lane never continues it.
    expect(repeatCopyDueAt(weeklyOnMonday, pickedInNewYork)).toBeNull();
    expect(repeatCopyDueAt(onDue, null)).toBeNull();
  });

  it(`stops at ${REPEAT_OPEN_COPIES_MAX} open tasks in a series`, async () => {
    const series = (open: number) => (text: string) =>
      text.startsWith('SELECT count(*)::int AS open FROM app.tasks')
        ? [{ open }]
        : undefined;
    const full = fakeTx(dueToday(), series(REPEAT_OPEN_COPIES_MAX));
    await expect(
      createDueRepeatCopy(full.tx, {
        organizationId: 'org-1',
        taskId: 't-1',
        now: NOW,
      }),
    ).resolves.toEqual({
      kind: 'capped',
      openCopies: REPEAT_OPEN_COPIES_MAX,
    });
    expect(copyInsert(full.statements)).toBeNull();
    const walk = full.statements.find((s) =>
      s.text.startsWith('SELECT count(*)::int AS open FROM app.tasks'),
    );
    // Counted by durable membership, explicitly scoped to org and project.
    expect(walk?.text).toContain('repeat_series_id = ?');
    expect(walk?.values).toEqual(['org-1', 'p-1', 't-1', 't-1']);

    const room = fakeTx(dueToday(), series(REPEAT_OPEN_COPIES_MAX - 1));
    await expect(
      createDueRepeatCopy(room.tx, {
        organizationId: 'org-1',
        taskId: 't-1',
        now: NOW,
      }),
    ).resolves.toMatchObject({ kind: 'created' });
  });

  it('a close never counts the series: it takes one open task away as it adds one', async () => {
    const { tx, statements } = fakeTx(
      taskRow({ repeat: onDue }),
      () => undefined,
    );
    await updateTaskStatus(tx, auth, 't-1', 'done');
    expect(copyInsert(statements)).not.toBeNull();
    expect(
      statements.some((s) => s.text.startsWith('WITH RECURSIVE series AS')),
    ).toBe(false);
  });
});

describe('the copy brings the work back whole', () => {
  /** Subtasks of t-1 as the level-by-level subtree read answers them. */
  const subtask = (overrides: Record<string, unknown>) => ({
    organizationId: 'org-1',
    projectId: 'p-1',
    description: null,
    attachments: null,
    priority: 'p2',
    labelIds: [],
    assigneeType: null,
    assigneeId: null,
    reviewerUserId: null,
    startDate: null,
    dueDate: null,
    createdBy: 'u-sub',
    createdByType: 'user',
    ...overrides,
  });
  const subtree = [
    subtask({
      id: 's-1',
      parentTaskId: 't-1',
      title: 'Collect the numbers',
      dueDate: FRIDAY_18,
      assigneeType: 'user',
      assigneeId: 'u-sub',
    }),
    subtask({
      id: 's-2',
      parentTaskId: 't-1',
      title: 'Draft the report',
      startDate: FRIDAY_18,
      dueDate: MONDAY_21,
      assigneeType: 'agent',
      assigneeId: 'agent-gone',
      createdBy: 'agent-1',
      createdByType: 'agent',
    }),
    subtask({
      id: 's-3',
      parentTaskId: 's-1',
      title: 'Export the dashboard',
    }),
  ];

  /** Scripts the subtree read, hands each insert its own id (the series
   * copy `t-2`, then `c-1`, `c-2`, …), and answers whatever `more` adds. */
  function workTx(
    more: (text: string) => unknown[] | undefined = () => undefined,
    rows: unknown[] = subtree,
  ) {
    let inserted = 0;
    return fakeTx(
      taskRow(),
      (text) => {
        if (text.startsWith('WITH RECURSIVE tree AS')) return rows;
        if (text.startsWith('INSERT INTO app.tasks')) {
          const id = inserted === 0 ? 't-2' : `c-${inserted}`;
          inserted += 1;
          return [{ id }];
        }
        return more(text);
      },
      { 'u-author': 'member', 'u-sub': 'member', 'u-watch': 'member' },
    );
  }

  it('each subtask comes back fresh under its parent’s copy, dated by the same step, with no rule', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { tx, statements } = workTx();
    await updateTaskStatus(tx, auth, 't-1', 'done');
    const inserts = copyInserts(statements);
    expect(inserts.map((row) => row.title)).toEqual([
      'Send the weekly report',
      'Collect the numbers',
      'Draft the report',
      'Export the dashboard',
    ]);
    // The parent moved a week (due 21 → 28 September); so does each date.
    expect(inserts.slice(1)).toEqual([
      expect.objectContaining({
        parentTaskId: 't-2',
        repeat: null,
        startDate: null,
        dueDate: FRIDAY_25,
        assigneeType: 'user',
        assigneeId: 'u-sub',
        createdBy: 'u-sub',
        createdByType: 'user',
      }),
      expect.objectContaining({
        parentTaskId: 't-2',
        repeat: null,
        startDate: FRIDAY_25,
        dueDate: MONDAY_28,
        // The agent is no longer in the project: the copy starts unassigned.
        assigneeType: null,
        assigneeId: null,
        createdBy: 'agent-1',
        createdByType: 'agent',
      }),
      expect.objectContaining({
        // The grandchild hangs under its parent's copy.
        parentTaskId: 'c-1',
        repeat: null,
        startDate: null,
        dueDate: null,
      }),
    ]);
    // One write, one instant: what "Stop repeating" later checks.
    expect(new Set(inserts.map((row) => row.createdAt))).toEqual(
      new Set([NOW]),
    );
    expect(inserts.every((row) => row.updatedAt === NOW)).toBe(true);
    const insert = statements.find((s) =>
      s.text.startsWith('INSERT INTO app.tasks'),
    );
    expect(insert?.text).toContain("'todo'");
    // Every copy is a new open card with its own creation on the record.
    expect(
      statements.filter(
        (s) =>
          s.text.startsWith('UPDATE app.projects SET open_task_count') &&
          s.values[0] === 1,
      ),
    ).toHaveLength(4);
    expect(
      activityRows(statements)
        .filter((row) => row.action === 'created')
        .map((row) => [row.taskId, row.actorId]),
    ).toEqual([
      ['t-2', 'u-closer'],
      ['c-1', 'u-closer'],
      ['c-2', 'u-closer'],
      ['c-3', 'u-closer'],
    ]);
    expect(
      vi
        .mocked(createAuditLog)
        .mock.calls.map(([, row]) => [
          row.action,
          row.resourceId,
          row.metadata?.parentTaskId,
          row.metadata?.repeatOf,
        ]),
    ).toEqual([
      ['task.status_changed', 't-1', undefined, undefined],
      ['task.created', 't-2', null, 't-1'],
      ['task.created', 'c-1', 't-2', 's-1'],
      ['task.created', 'c-2', 't-2', 's-2'],
      ['task.created', 'c-3', 'c-1', 's-3'],
    ]);
    expect(
      vi
        .mocked(emitEvent)
        .mock.calls.map(([, event]) => event)
        .filter((event) => event.eventType === 'task.created')
        .map((event) => event.eventData?.taskId),
    ).toEqual(['t-2', 'c-1', 'c-2', 'c-3']);
    // The subtree read skips archived subtasks and stays in the project.
    const read = statements.find((s) =>
      s.text.startsWith('WITH RECURSIVE tree AS'),
    );
    expect(read?.text).toContain('t.archived_at_ms IS NULL');
    expect(read?.text).toContain('t.project_id = ?');
  });

  it('a parent with no dates dates its subtasks from today', async () => {
    const { tx, statements } = fakeTx(
      taskRow({ startDate: null, dueDate: null }),
      (text) =>
        text.startsWith('WITH RECURSIVE tree AS')
          ? [
              subtask({
                id: 's-1',
                parentTaskId: 't-1',
                title: 'Step',
                // Wednesday 30 September.
                dueDate: Date.UTC(2026, 8, 29, 22),
              }),
            ]
          : undefined,
    );
    await updateTaskStatus(tx, auth, 't-1', 'done');
    // Today is Monday 28 September and the copy is due Monday 5 October: a
    // week on, so the subtask is due Wednesday 7 October.
    const [copy, step] = copyInserts(statements);
    expect(copy?.dueDate).toBe(Date.UTC(2026, 9, 4, 22));
    expect(step?.dueDate).toBe(Date.UTC(2026, 9, 6, 22));
  });

  it('copies the complete subtree beyond 200 subtasks', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const many = Array.from({ length: 201 }, (_, index) =>
      subtask({
        id: `s-${index}`,
        parentTaskId: 't-1',
        title: `Step ${index}`,
      }),
    );
    const { tx, statements } = workTx(undefined, many);
    await updateTaskStatus(tx, auth, 't-1', 'done');
    expect(copyInserts(statements)).toHaveLength(202);
    expect(warn).not.toHaveBeenCalled();
  });

  it('draws the dependencies among the copied tasks again, and leaves the rest', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { tx, statements } = workTx((text) =>
      text.startsWith('SELECT blocker_task_id')
        ? [
            {
              blockerTaskId: 's-1',
              blockedTaskId: 's-2',
              createdBy: 'u-sub',
              createdByType: 'user',
            },
            {
              blockerTaskId: 's-3',
              blockedTaskId: 't-1',
              createdBy: 'agent-1',
              createdByType: 'agent',
            },
            {
              blockerTaskId: 'x-elsewhere',
              blockedTaskId: 's-2',
              createdBy: 'u-sub',
              createdByType: 'user',
            },
          ]
        : undefined,
    );
    await updateTaskStatus(tx, auth, 't-1', 'done');
    const read = statements.find((s) =>
      s.text.startsWith('SELECT blocker_task_id'),
    );
    // Both ends inside the task and its copied subtasks.
    expect(read?.text).toContain(
      'WHERE blocker_task_id = ANY(?) AND blocked_task_id = ANY(?)',
    );
    expect(read?.values[0]).toEqual(['t-1', 's-1', 's-2', 's-3']);
    expect(
      statements
        .filter((s) => s.text.startsWith('INSERT INTO app.task_dependencies'))
        .map((s) => s.values.slice(0, 6)),
    ).toEqual([
      ['org-1', 'p-1', 'c-1', 'c-2', 'u-sub', 'user'],
      ['org-1', 'p-1', 'c-3', 't-2', 'agent-1', 'agent'],
    ]);
  });

  it('the watchers who can still see the project follow the copies, mute kept', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { tx, statements } = workTx((text) => {
      if (text.startsWith('SELECT task_id AS "taskId", subscriber_type')) {
        return [
          {
            taskId: 't-1',
            subscriberType: 'user',
            subscriberId: 'u-author',
            muted: true,
          },
          {
            taskId: 't-1',
            subscriberType: 'user',
            subscriberId: 'u-watch',
            muted: null,
          },
          {
            taskId: 't-1',
            subscriberType: 'user',
            subscriberId: 'u-left',
            muted: null,
          },
          {
            taskId: 's-1',
            subscriberType: 'user',
            subscriberId: 'u-watch',
            muted: false,
          },
          {
            taskId: 's-2',
            subscriberType: 'agent',
            subscriberId: 'agent-gone',
            muted: null,
          },
        ];
      }
      return undefined;
    });
    await updateTaskStatus(tx, auth, 't-1', 'done');
    // u-left is no member any more and agent-gone is out of the project:
    // neither follows a copy.
    expect(vi.mocked(autoSubscribe).mock.calls.map(([, sub]) => sub)).toEqual([
      {
        organizationId: 'org-1',
        taskId: 't-2',
        subscriberType: 'user',
        subscriberId: 'u-author',
        reason: 'repeat',
        muted: true,
      },
      {
        organizationId: 'org-1',
        taskId: 't-2',
        subscriberType: 'user',
        subscriberId: 'u-watch',
        reason: 'repeat',
      },
      {
        organizationId: 'org-1',
        taskId: 'c-1',
        subscriberType: 'user',
        subscriberId: 'u-watch',
        reason: 'repeat',
        muted: false,
      },
    ]);
    // Each person's standing is asked once per write.
    expect(
      statements.filter(
        (s) =>
          s.text.startsWith('SELECT "role" FROM "member"') &&
          s.values[1] === 'u-watch',
      ),
    ).toHaveLength(1);
  });

  it('an agent still in the project follows the copy of what it watched', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { tx } = workTx((text) => {
      if (text.startsWith('SELECT task_id AS "taskId", subscriber_type')) {
        return [
          {
            taskId: 's-2',
            subscriberType: 'agent',
            subscriberId: 'agent-1',
            muted: null,
          },
        ];
      }
      if (text.startsWith('SELECT id FROM app.project_agents')) {
        return [{ id: 'agent-1' }];
      }
      return undefined;
    });
    await updateTaskStatus(tx, auth, 't-1', 'done');
    expect(
      vi.mocked(autoSubscribe).mock.calls.map(([, sub]) => sub),
    ).toContainEqual({
      organizationId: 'org-1',
      taskId: 'c-2',
      subscriberType: 'agent',
      subscriberId: 'agent-1',
      reason: 'repeat',
    });
  });

  it('a fault anywhere in the subtree rolls the whole copy back, and the close still commits', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let inserted = 0;
    const { tx, statements } = fakeTx(taskRow(), (text) => {
      if (text.startsWith('WITH RECURSIVE tree AS')) return subtree;
      if (text.startsWith('INSERT INTO app.tasks')) {
        inserted += 1;
        if (inserted === 3) throw new Error('subtask insert refused');
        return [{ id: `n-${inserted}` }];
      }
      return undefined;
    });
    await expect(updateTaskStatus(tx, auth, 't-1', 'done')).resolves.toBeNull();
    expect(statements.map((s) => s.text)).toContain('ROLLBACK TO SAVEPOINT');
    expect(pointerWrites(statements)).toEqual([]);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('t-1'),
      expect.objectContaining({ message: 'subtask insert refused' }),
    );
  });
});
