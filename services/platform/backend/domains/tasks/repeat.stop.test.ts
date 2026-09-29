import type { TransactionSql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaskRepeat } from '../../../lib/shared/task-repeat.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { loadProjectOrThrow, type ProjectRow } from '../projects/service.ts';
import { stopTaskRepeat } from './repeat.ts';
import { retireTasksInTx } from './retire.ts';
import type { TaskRow } from './service.ts';

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
vi.mock('./reviews.ts', () => ({
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
vi.mock('./retire.ts', () => ({
  retireTasksInTx: vi.fn(),
  releaseUnlistedTaskBlobRefs: vi.fn(),
}));
vi.mock('../projects/service.ts', () => ({
  listProjects: vi.fn(),
  loadProjectOrThrow: vi.fn(),
}));

/**
 * "Stop repeating" — the next-task toast's action. The series ends on the
 * task the copy continued; a copy nobody has touched is taken back (with
 * its subtasks, and any copy the series made since), anything else keeps
 * the copy and clears its rule. The transaction is a recording stand-in
 * answering each read by its text; the delete walk is the retire module's,
 * mocked here and asserted by what it is handed.
 */

const NOW = Date.UTC(2026, 8, 28, 10);
/** The instant the copy's write stamped every row it created. */
const WRITTEN = NOW - 60_000;

const rule: TaskRepeat = {
  frequency: 'weekly',
  interval: 1,
  weekdays: [1],
  timezone: 'Europe/Zurich',
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
  taskCounter: 8,
  openTaskCount: 2,
  doneTaskCount: 1,
  projectAgentCount: 0,
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

function auth(role = 'editor') {
  return {
    organizationId: 'org-1',
    userId: 'u-stopper',
    email: 'stopper@example.com',
    role,
    teamIds: [] as string[],
  };
}

/** The closed task whose toast offered "Stop repeating". */
function closedTask(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 't-1',
    organizationId: 'org-1',
    projectId: 'p-1',
    title: 'Send the weekly report',
    description: null,
    attachments: null,
    outputs: null,
    number: 7,
    status: 'done',
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
    externalClosedAt: null,
    repeat: rule,
    repeatNextTaskId: 't-2',
    repeatContinued: true,
    createdBy: 'u-author',
    createdByType: 'user',
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
    ...overrides,
  };
}

/** A copy in the chain, as the lock reads it: untouched unless overridden. */
function copy(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    organizationId: 'org-1',
    projectId: 'p-1',
    title: 'Send the weekly report',
    status: 'todo',
    repeat: rule,
    repeatNextTaskId: null,
    seriesPosition: Number(id.replace('t-', '')) - 1,
    createdAt: WRITTEN,
    updatedAt: WRITTEN,
    commentCount: 0,
    agentRunCount: 0,
    archivedAt: null,
    ...overrides,
  };
}

/** A row of a copy's subtree: untouched unless overridden. */
function treeRow(id: string, root: string, overrides = {}) {
  return {
    id,
    root,
    status: 'todo',
    createdAt: WRITTEN,
    updatedAt: WRITTEN,
    commentCount: 0,
    agentRunCount: 0,
    archivedAt: null,
    ...overrides,
  };
}

interface Statement {
  text: string;
  values: unknown[];
}

interface Script {
  task?: TaskRow;
  seriesPosition?: number;
  copies?: ReturnType<typeof copy>[];
  tree?: ReturnType<typeof treeRow>[];
  liveAgentRun?: boolean;
  liveAutomationRun?: boolean;
  editedActivity?: boolean;
  externalDependency?: boolean;
}

function fakeTx(script: Script): {
  tx: TransactionSql;
  statements: Statement[];
} {
  const task = script.task ?? closedTask();
  const statements: Statement[] = [];
  const answer = (text: string): unknown[] => {
    if (text.startsWith('SELECT ? FROM app.tasks WHERE id = ?')) return [task];
    if (text.startsWith('SELECT repeat_rule AS "repeat", repeat_series_id')) {
      return [
        {
          repeat: task.repeat,
          seriesId: 't-1',
          seriesPosition: script.seriesPosition ?? 0,
        },
      ];
    }
    if (text.startsWith('SELECT id, org_id AS "organizationId"')) {
      // Heap order, not chain order: the service puts them in order.
      return [...(script.copies ?? [])].toReversed();
    }
    if (text.startsWith('WITH RECURSIVE tree AS')) return script.tree ?? [];
    if (text.startsWith('SELECT id FROM app.task_activity')) {
      return script.editedActivity === true ? [{ id: 'activity-1' }] : [];
    }
    if (text.startsWith('SELECT id FROM app.task_dependencies')) {
      return script.externalDependency === true ? [{ id: 'edge-1' }] : [];
    }
    if (text.startsWith('SELECT id FROM app.project_agent_runs')) {
      return script.liveAgentRun === true ? [{ id: 'run-1' }] : [];
    }
    if (text.startsWith('SELECT id FROM app.automation_runs')) {
      return script.liveAutomationRun === true ? [{ id: 'run-2' }] : [];
    }
    return [];
  };
  const tag = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    statements.push({ text, values });
    return Promise.resolve(answer(text));
  };
  const tx = Object.assign(tag, {
    json: (value: unknown) => ({ json: value }),
    unsafe: (text: string): unknown => text,
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a three-member stand-in for the postgres.js transaction function
  return { tx: tx as unknown as TransactionSql, statements };
}

function ruleClears(statements: Statement[]): unknown[] {
  return statements
    .filter((s) => s.text.startsWith('UPDATE app.tasks SET repeat_rule = NULL'))
    .map((s) => s.values.at(-1));
}

function activity(statements: Statement[]) {
  return statements
    .filter((s) => s.text.startsWith('INSERT INTO app.task_activity'))
    .map((s) => ({
      taskId: s.values[1],
      actorId: s.values[4],
      action: s.values[5],
      fromValue: s.values[6],
      toValue: s.values[7],
    }));
}

const untouched: Script = {
  copies: [copy('t-2')],
  tree: [treeRow('t-2', 't-2'), treeRow('c-1', 't-2')],
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  vi.mocked(loadProjectOrThrow).mockResolvedValue(project);
  vi.mocked(retireTasksInTx).mockResolvedValue({
    cancelledRunCount: 0,
    releasedRefs: [],
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('stopping a series whose next task nobody has touched', () => {
  it('takes the copy back with its subtasks and ends the series on the task', async () => {
    const { tx, statements } = fakeTx(untouched);
    await expect(stopTaskRepeat(tx, auth(), 't-1')).resolves.toEqual({
      removedNextTask: true,
    });
    // The delete's own walk, handed the copy and everything under it.
    expect(retireTasksInTx).toHaveBeenCalledWith(tx, {
      organizationId: 'org-1',
      projectId: 'p-1',
      taskIds: ['t-2', 'c-1'],
      closedReason: 'task_deleted',
    });
    // Both were open cards; neither counts any more.
    expect(
      statements
        .filter((s) =>
          s.text.startsWith('UPDATE app.projects SET open_task_count'),
        )
        .map((s) => s.values.slice(0, 2)),
    ).toEqual([
      [-1, 0],
      [-1, 0],
    ]);
    // The copy is gone, so only the task's own rule is cleared.
    expect(ruleClears(statements)).toEqual(['t-1']);
    expect(activity(statements)).toEqual([
      {
        taskId: 't-1',
        actorId: 'u-stopper',
        action: 'repeat.changed',
        fromValue: JSON.stringify(rule),
        toValue: null,
      },
    ]);
    expect(
      vi
        .mocked(createAuditLog)
        .mock.calls.map(([, row]) => [
          row.action,
          row.resourceId,
          row.actorId,
          row.metadata,
        ]),
    ).toEqual([
      [
        'task.deleted',
        't-2',
        'u-stopper',
        {
          reason: 'repeat_stopped',
          repeatOf: 't-1',
          deletedChildCount: 1,
          releasedBlobRefCount: 0,
        },
      ],
      ['task.updated', 't-1', 'u-stopper', { reason: 'repeat_stopped' }],
    ]);
    expect(emitHintInTx).toHaveBeenCalledWith(tx, {
      orgId: 'org-1',
      entity: 'task',
      entityId: 't-2',
    });
  });

  it('takes back every copy the series has made since, in order', async () => {
    const { tx } = fakeTx({
      copies: [copy('t-2', { repeatNextTaskId: 't-3' }), copy('t-3')],
      tree: [
        treeRow('t-2', 't-2'),
        treeRow('t-3', 't-3'),
        treeRow('c-1', 't-3'),
      ],
    });
    await expect(stopTaskRepeat(tx, auth(), 't-1')).resolves.toEqual({
      removedNextTask: true,
    });
    expect(vi.mocked(retireTasksInTx).mock.calls[0]?.[1].taskIds).toEqual([
      't-2',
      't-3',
      'c-1',
    ]);
    expect(
      vi
        .mocked(createAuditLog)
        .mock.calls.filter(([, row]) => row.action === 'task.deleted')
        .map(([, row]) => [row.resourceId, row.metadata?.repeatOf]),
    ).toEqual([
      ['t-2', 't-1'],
      ['t-3', 't-2'],
    ]);
  });

  it('an editor may do it — it undoes the platform’s own write, not anyone’s work', async () => {
    const { tx } = fakeTx(untouched);
    await expect(stopTaskRepeat(tx, auth('editor'), 't-1')).resolves.toEqual({
      removedNextTask: true,
    });
  });

  it('takes back a disconnected untouched later copy without inventing its predecessor', async () => {
    const { tx } = fakeTx({
      task: closedTask({ repeatNextTaskId: null }),
      copies: [copy('t-3')],
      tree: [treeRow('t-3', 't-3')],
    });
    await expect(stopTaskRepeat(tx, auth(), 't-1')).resolves.toEqual({
      removedNextTask: true,
    });
    expect(retireTasksInTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ taskIds: ['t-3'] }),
    );
    const deletion = vi
      .mocked(createAuditLog)
      .mock.calls.find(([, row]) => row.action === 'task.deleted');
    expect(deletion?.[1].metadata).toMatchObject({ stoppedFromTaskId: 't-1' });
    expect(deletion?.[1].metadata).not.toHaveProperty('repeatOf');
  });

  it('reclaims only the copies after the selected task and leaves the earlier ones as they are', async () => {
    const { tx, statements } = fakeTx({
      task: closedTask({ id: 't-2', repeatNextTaskId: 't-3' }),
      seriesPosition: 1,
      copies: [copy('t-1', { repeatNextTaskId: 't-2' }), copy('t-3')],
      tree: [treeRow('t-3', 't-3')],
    });
    await expect(stopTaskRepeat(tx, auth(), 't-2')).resolves.toEqual({
      removedNextTask: true,
    });
    expect(retireTasksInTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ taskIds: ['t-3'] }),
    );
    // The series' history keeps what it says.
    expect(ruleClears(statements)).toEqual(['t-2']);
  });
});

describe('a member stops their own series', () => {
  const mine = { createdBy: 'u-stopper', createdByType: 'user' };

  it('takes back their untouched next task, which is theirs too', async () => {
    const { tx, statements } = fakeTx({
      ...untouched,
      task: closedTask(mine),
      copies: [copy('t-2', mine)],
    });
    await expect(stopTaskRepeat(tx, auth('member'), 't-1')).resolves.toEqual({
      removedNextTask: true,
    });
    expect(retireTasksInTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ taskIds: ['t-2', 'c-1'] }),
    );
    expect(ruleClears(statements)).toEqual(['t-1']);
  });

  it('leaves a later copy that is someone else’s now — its rule included — and takes nothing back', async () => {
    // The member works the series as its assignee; the newest copy was
    // handed to a teammate since, so it is no longer the member's to stop.
    const assigned = { assigneeType: 'user' as const, assigneeId: 'u-stopper' };
    const { tx, statements } = fakeTx({
      task: closedTask({ ...assigned, repeatNextTaskId: 't-2' }),
      copies: [
        copy('t-2', { ...assigned, repeatNextTaskId: 't-3' }),
        copy('t-3', { assigneeType: 'user', assigneeId: 'u-teammate' }),
      ],
      tree: [treeRow('t-2', 't-2'), treeRow('t-3', 't-3')],
    });
    await expect(stopTaskRepeat(tx, auth('member'), 't-1')).resolves.toEqual({
      removedNextTask: false,
    });
    expect(retireTasksInTx).not.toHaveBeenCalled();
    expect(ruleClears(statements)).toEqual(['t-2', 't-1']);
  });

  it('refuses a member on a series that is not theirs', async () => {
    const { tx, statements } = fakeTx(untouched);
    await expect(
      stopTaskRepeat(tx, auth('member'), 't-1'),
    ).rejects.toMatchObject({ code: 'RBAC_FORBIDDEN' });
    expect(retireTasksInTx).not.toHaveBeenCalled();
    expect(ruleClears(statements)).toEqual([]);
  });
});

describe('a next task someone has touched stays', () => {
  it.each<[string, Script]>([
    [
      'it was edited',
      { ...untouched, tree: [treeRow('t-2', 't-2', { updatedAt: NOW })] },
    ],
    [
      'it was started',
      {
        ...untouched,
        tree: [treeRow('t-2', 't-2', { status: 'in_progress' })],
      },
    ],
    [
      'someone commented on it',
      { ...untouched, tree: [treeRow('t-2', 't-2', { commentCount: 1 })] },
    ],
    [
      'an agent ran on it',
      { ...untouched, tree: [treeRow('t-2', 't-2', { agentRunCount: 1 })] },
    ],
    [
      'one of its subtasks was closed',
      {
        ...untouched,
        tree: [
          treeRow('t-2', 't-2'),
          treeRow('c-1', 't-2', { status: 'done' }),
        ],
      },
    ],
    [
      'one of its subtasks was archived',
      {
        ...untouched,
        tree: [treeRow('t-2', 't-2'), treeRow('c-1', 't-2', { archivedAt: 5 })],
      },
    ],
    [
      'someone added a subtask to it',
      {
        ...untouched,
        tree: [
          treeRow('t-2', 't-2'),
          treeRow('c-9', 't-2', { createdAt: NOW, updatedAt: NOW }),
        ],
      },
    ],
    ['a run is live on it', { ...untouched, liveAgentRun: true }],
    ['a dependency was edited', { ...untouched, editedActivity: true }],
    [
      'it blocks a task outside the copied tree',
      { ...untouched, externalDependency: true },
    ],
    [
      'an automation run is live on it',
      { ...untouched, liveAutomationRun: true },
    ],
    [
      'the series runs on past the walk',
      {
        ...untouched,
        copies: [copy('t-2', { repeatNextTaskId: 't-99' })],
      },
    ],
  ])('%s: its rule is cleared instead', async (_name, script) => {
    const { tx, statements } = fakeTx(script);
    await expect(stopTaskRepeat(tx, auth(), 't-1')).resolves.toEqual({
      removedNextTask: false,
    });
    expect(retireTasksInTx).not.toHaveBeenCalled();
    // The copy continues nothing, and neither does the task.
    expect(ruleClears(statements)).toEqual(['t-2', 't-1']);
    expect(
      activity(statements).map((row) => [row.taskId, row.action, row.toValue]),
    ).toEqual([
      ['t-2', 'repeat.changed', null],
      ['t-1', 'repeat.changed', null],
    ]);
  });
});

describe('a task with nothing ahead of it', () => {
  it('a rule but no next task: the rule is cleared', async () => {
    const { tx, statements } = fakeTx({
      task: closedTask({
        status: 'todo',
        repeatNextTaskId: null,
        repeatContinued: false,
      }),
    });
    await expect(stopTaskRepeat(tx, auth(), 't-1')).resolves.toEqual({
      removedNextTask: false,
    });
    expect(ruleClears(statements)).toEqual(['t-1']);
    expect(retireTasksInTx).not.toHaveBeenCalled();
  });

  it('no rule and no next task: nothing is written, and asking again is harmless', async () => {
    const { tx, statements } = fakeTx({
      task: closedTask({ repeat: null, repeatNextTaskId: null }),
    });
    await expect(stopTaskRepeat(tx, auth(), 't-1')).resolves.toEqual({
      removedNextTask: false,
    });
    expect(
      statements.some(
        (s) => s.text.startsWith('UPDATE') || s.text.startsWith('INSERT'),
      ),
    ).toBe(false);
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('a stored rule that no longer validates is cleared without a timeline line', async () => {
    const { tx, statements } = fakeTx({
      task: closedTask({
        repeat: { ...rule, timezone: 'Mars/Olympus_Mons' },
        repeatNextTaskId: null,
      }),
    });
    await stopTaskRepeat(tx, auth(), 't-1');
    expect(ruleClears(statements)).toEqual(['t-1']);
    expect(activity(statements)).toEqual([]);
  });
});

describe('who may stop a series', () => {
  it('someone who can only read the project is refused, and nothing is written', async () => {
    const { tx, statements } = fakeTx(untouched);
    await expect(
      stopTaskRepeat(tx, auth('member'), 't-1'),
    ).rejects.toMatchObject({ code: 'RBAC_FORBIDDEN', status: 403 });
    expect(statements.map((s) => s.text)).toEqual([
      expect.stringMatching(/^SELECT \? FROM app\.tasks WHERE id = \?/),
    ]);
  });

  it('an archived task is refused', async () => {
    const { tx } = fakeTx({
      ...untouched,
      task: closedTask({ archivedAt: 5 }),
    });
    await expect(stopTaskRepeat(tx, auth(), 't-1')).rejects.toMatchObject({
      code: 'TASK_ARCHIVED',
    });
  });

  it('a task in an archived project is refused', async () => {
    vi.mocked(loadProjectOrThrow).mockResolvedValue({
      ...project,
      archivedAt: 5,
    });
    const { tx } = fakeTx(untouched);
    await expect(stopTaskRepeat(tx, auth(), 't-1')).rejects.toMatchObject({
      code: 'PROJECT_ARCHIVED',
    });
  });

  it('the chain is read in the caller’s organization and locked', async () => {
    const { tx, statements } = fakeTx(untouched);
    await stopTaskRepeat(tx, auth(), 't-1');
    const rows = statements.find((s) =>
      s.text.startsWith('SELECT id, org_id AS "organizationId"'),
    );
    expect(rows?.text).toContain(
      'WHERE org_id = ? AND project_id = ? AND repeat_series_id = ? AND id <> ? ORDER BY id FOR UPDATE',
    );
    expect(rows?.values).toEqual(['org-1', 'p-1', 't-1', 't-1']);
  });
});
