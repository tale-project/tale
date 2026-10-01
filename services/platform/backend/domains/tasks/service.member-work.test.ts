import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addJobInTx } from '../../jobs/enqueue.ts';
import { loadProjectOrThrow, type ProjectRow } from '../projects/service.ts';
import { kickAgentRun } from './agent-runs.ts';
import { closePendingTaskReviewOnStatusLeave } from './reviews.ts';
import {
  addTaskDependency,
  archiveTask,
  assignTask,
  createTask,
  deleteTask,
  dispatchMentionedProjectAgent,
  mentionTriggerPreview,
  moveTask,
  removeTaskDependency,
  restoreTask,
  startTaskAgentRunManual,
  type TaskRow,
  updateTask,
  updateTaskStatus,
} from './service.ts';

vi.mock('../collab/service.ts', () => ({
  autoSubscribe: vi.fn(),
  dismissReviewerAssignedNotifications: vi.fn(),
  notifyTaskAssigned: vi.fn(),
  notifyTaskMentions: vi.fn(),
  notifyTaskReviewerAssigned: vi.fn(),
  notifyTaskStatusChanged: vi.fn(),
}));
vi.mock('../events/emit.ts', () => ({ emitEvent: vi.fn() }));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));
vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));
vi.mock('./reviews.ts', () => ({
  closePendingTaskReviewOnStatusLeave: vi.fn(),
  collectPendingReviewsForProjects: vi.fn(() => Promise.resolve([])),
  requestTaskReview: vi.fn(),
  retargetPendingTaskReview: vi.fn(),
  reviewerEligibility: vi.fn(),
}));
vi.mock('./agent-runs.ts', () => ({
  cancelAgentRunInTx: vi.fn(),
  isStandardAgentRefusal: () => false,
  kickAgentRun: vi.fn(),
}));
vi.mock('./run-start.ts', () => ({
  mentionAutomationEnabled: vi.fn(() => Promise.resolve(true)),
}));
vi.mock('../../lib/org-config.ts', () => ({
  readGovernancePolicyForOrg: vi.fn(() => Promise.resolve(null)),
}));
vi.mock('../projects/service.ts', () => ({
  listProjects: vi.fn(),
  loadProjectOrThrow: vi.fn(),
}));

/**
 * Members create tasks and work their own. Every write below used to answer
 * 403 `RBAC_FORBIDDEN` to a member; now the ONE work gate
 * (`assertTaskWorkable`) lets a member through on a task they created or are
 * assigned to, and keeps refusing them on anyone else's — while editors work
 * every task as before. The agent runs a member starts are booked to them
 * (`startedBy`), which is where the ledger reads its subject.
 */

const member = {
  organizationId: 'org-1',
  userId: 'u-member',
  email: 'member@example.com',
  role: 'member',
  teamIds: [] as string[],
};
const editor = { ...member, userId: 'u-editor', role: 'editor' };

const project: ProjectRow = {
  id: 'p-1',
  organizationId: 'org-1',
  name: 'Contracts',
  description: null,
  icon: null,
  color: null,
  key: 'CON',
  externalItemId: null,
  taskCounter: 1,
  openTaskCount: 1,
  doneTaskCount: 0,
  projectAgentCount: 1,
  teamId: null,
  sharedWithTeamIds: [],
  teamIds: [],
  instructions: null,
  createdBy: 'u-editor',
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  pinnedAt: null,
};

function taskRow(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 't-own',
    organizationId: 'org-1',
    projectId: 'p-1',
    title: 'Summarize the supplier contracts',
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
    externalClosedAt: null,
    repeat: null,
    repeatNextTaskId: null,
    repeatContinued: false,
    createdBy: 'u-member',
    createdByType: 'user',
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
    ...overrides,
  };
}

const agent = {
  id: 'agent-1',
  harness: 'claude-code',
  model: 'anthropic/claude-sonnet',
  modelProvider: null,
};

/** The member's own task, a task they are assigned to, and someone else's. */
const OWN = taskRow();
const ASSIGNED = taskRow({
  id: 't-assigned',
  createdBy: 'u-editor',
  assigneeType: 'user',
  assigneeId: 'u-member',
});
const OTHERS = taskRow({ id: 't-others', createdBy: 'u-editor' });

/** Every statement the fake answered, so a refusal can be shown to have
 * written nothing. */
let statements: string[] = [];

/** The task's live agent run, when a case has one. */
interface LiveRun {
  id: string;
  agentId: string;
  status: 'queued' | 'running';
  startedBy: string;
}

function fakeTx(
  tasks: readonly TaskRow[],
  options: { liveRun?: LiveRun } = {},
): TransactionSql {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const tag = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    statements.push(text);
    if (text.startsWith('SELECT ? FROM app.tasks WHERE id = ?')) {
      const task = values
        .map((value) => (typeof value === 'string' ? byId.get(value) : null))
        .find((row) => row != null);
      return Promise.resolve(task ? [task] : []);
    }
    if (text.startsWith('WITH RECURSIVE up AS')) {
      // The owners up the subtask tree, nearest parent first.
      const chain: TaskRow[] = [];
      let next = typeof values[0] === 'string' ? byId.get(values[0]) : null;
      while (next != null) {
        chain.push(next);
        next = next.parentTaskId === null ? null : byId.get(next.parentTaskId);
      }
      return Promise.resolve(chain);
    }
    if (text.includes('FROM app.project_agent_runs')) {
      const run = options.liveRun;
      return Promise.resolve(
        run === undefined
          ? []
          : [
              {
                ...run,
                execId: 'exec-1',
                sessionId: 'pa-agent-1',
                harness: 'claude-code',
                model: 'anthropic/claude-sonnet',
                modelProvider: null,
                deadlineAt: 9_999_999_999_999,
              },
            ],
      );
    }
    // The project's agent is its own, not the organization's standard one.
    if (text.includes('FROM app.project_agents') && text.includes('managed')) {
      return Promise.resolve([]);
    }
    if (text.includes('FROM app.project_agents')) {
      return Promise.resolve([agent]);
    }
    if (text.startsWith('UPDATE app.projects SET task_counter')) {
      return Promise.resolve([{ taskCounter: 2 }]);
    }
    if (text.startsWith('INSERT INTO app.tasks')) {
      return Promise.resolve([{ id: 't-new' }]);
    }
    return Promise.resolve([]);
  };
  const tx = Object.assign(tag, {
    json: (value: unknown) => ({ json: value }),
    unsafe: (text: string): unknown => text,
    savepoint: (body: (sp: typeof tag) => Promise<unknown>) => body(tag),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- four-member stand-in for the postgres.js transaction function
  return tx as unknown as TransactionSql;
}

const wrote = (prefix: string): boolean =>
  statements.some((text) => text.startsWith(prefix));

beforeEach(() => {
  statements = [];
  vi.mocked(loadProjectOrThrow).mockReset().mockResolvedValue(project);
  vi.mocked(kickAgentRun)
    .mockReset()
    .mockResolvedValue({ runId: 'r-1', execId: 'e-1', reused: false });
  vi.mocked(closePendingTaskReviewOnStatusLeave).mockReset();
  vi.mocked(addJobInTx).mockReset();
});

describe('a member creates a task', () => {
  it('in a project they can read — the insert names them as its creator', async () => {
    const taskId = await createTask(fakeTx([]), member, {
      projectId: 'p-1',
      title: 'Summarize the supplier contracts',
    });

    expect(taskId).toBe('t-new');
    expect(wrote('INSERT INTO app.tasks')).toBe(true);
  });

  it('straight at In progress for a project agent — the run is theirs to pay for', async () => {
    await createTask(fakeTx([]), member, {
      projectId: 'p-1',
      title: 'Summarize the supplier contracts',
      status: 'in_progress',
      assigneeType: 'agent',
      assigneeId: 'agent-1',
    });

    expect(kickAgentRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        taskId: 't-new',
        agentId: 'agent-1',
        startedBy: 'u-member',
        trigger: 'manual',
      }),
    );
  });

  it('not in an archived project, writing nothing', async () => {
    vi.mocked(loadProjectOrThrow).mockResolvedValue({
      ...project,
      archivedAt: 1_700_000_000_000,
    });

    await expect(
      createTask(fakeTx([]), member, { projectId: 'p-1', title: 'Draft' }),
    ).rejects.toMatchObject({ code: 'PROJECT_ARCHIVED', status: 403 });
    expect(wrote('INSERT INTO app.tasks')).toBe(false);
  });

  it('not in a team project they cannot see, writing nothing', async () => {
    vi.mocked(loadProjectOrThrow).mockResolvedValue({
      ...project,
      teamId: 'team-legal',
      teamIds: ['team-legal'],
    });

    await expect(
      createTask(fakeTx([]), member, { projectId: 'p-1', title: 'Draft' }),
    ).rejects.toMatchObject({ code: 'TASK_FORBIDDEN', status: 403 });
    expect(wrote('INSERT INTO app.tasks')).toBe(false);
  });

  it("adds a subtask under their own task, never under someone else's", async () => {
    await expect(
      createTask(fakeTx([OTHERS]), member, {
        projectId: 'p-1',
        title: 'Check clause 7',
        parentTaskId: 't-others',
      }),
    ).rejects.toMatchObject({ code: 'RBAC_FORBIDDEN', status: 403 });
    expect(wrote('INSERT INTO app.tasks')).toBe(false);

    await createTask(fakeTx([OWN]), member, {
      projectId: 'p-1',
      title: 'Check clause 7',
      parentTaskId: 't-own',
    });
    expect(wrote('INSERT INTO app.tasks')).toBe(true);
  });
});

describe('a member works their own task', () => {
  it('edits a task they created or are assigned to', async () => {
    for (const own of [OWN, ASSIGNED]) {
      statements = [];
      await updateTask(fakeTx([own]), member, {
        taskId: own.id,
        title: 'Summarize the supplier contracts (Q3)',
      });
      expect(wrote('UPDATE app.tasks SET title')).toBe(true);
    }
  });

  it('moves it, marking it Done as the review decision', async () => {
    const inReview = taskRow({ status: 'in_review' });
    await updateTaskStatus(fakeTx([inReview]), member, 't-own', 'done');

    expect(wrote('UPDATE app.tasks SET status')).toBe(true);
    // The pending review is approved in the member's name, under the
    // organization's review policy.
    expect(closePendingTaskReviewOnStatusLeave).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        toStatus: 'done',
        actor: expect.objectContaining({ kind: 'user', userId: 'u-member' }),
      }),
    );
  });

  it('starts its project agent, the run booked to the member', async () => {
    const agentTask = taskRow({ assigneeType: 'agent', assigneeId: 'agent-1' });
    const result = await startTaskAgentRunManual(
      fakeTx([agentTask]),
      member,
      't-own',
    );

    expect(result).toEqual({ started: true });
    expect(kickAgentRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ startedBy: 'u-member', agentId: 'agent-1' }),
    );
  });

  it('hands it to a project agent', async () => {
    await assignTask(fakeTx([OWN]), member, {
      taskId: 't-own',
      assigneeType: 'agent',
      assigneeId: 'agent-1',
    });

    expect(wrote('UPDATE app.tasks SET assignee_type')).toBe(true);
  });

  it('puts the agent to work with an @mention, like an editor', async () => {
    await dispatchMentionedProjectAgent(fakeTx([OWN]), {
      auth: member,
      task: OWN,
      project,
      mentions: [{ type: 'agent', id: 'agent-1' }],
      authorType: 'user',
      authorId: 'u-member',
      text: '@contract.reviewer please summarize the attached contracts',
      source: 'comment',
    });

    expect(kickAgentRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        taskId: 't-own',
        agentId: 'agent-1',
        startedBy: 'u-member',
        trigger: 'mention',
      }),
    );
  });

  it('archives it', async () => {
    await archiveTask(fakeTx([OWN]), member, 't-own');

    expect(wrote('UPDATE app.tasks SET archived_at_ms')).toBe(true);
  });

  it('marks it as blocked by another task, but marks no one else’s as blocked', async () => {
    await addTaskDependency(fakeTx([OWN, OTHERS]), member, {
      blockerTaskId: 't-others',
      blockedTaskId: 't-own',
    });
    expect(wrote('INSERT INTO app.task_dependencies')).toBe(true);

    statements = [];
    await expect(
      addTaskDependency(fakeTx([OWN, OTHERS]), member, {
        blockerTaskId: 't-own',
        blockedTaskId: 't-others',
      }),
    ).rejects.toMatchObject({ code: 'RBAC_FORBIDDEN' });
    expect(wrote('INSERT INTO app.task_dependencies')).toBe(false);
  });

  it('does not delete it — deleting stays with owners and admins', async () => {
    await expect(
      deleteTask(fakeTx([OWN]), member, 't-own'),
    ).rejects.toMatchObject({ code: 'ROLE_FORBIDDEN', status: 403 });
  });

  it('works the subtasks an agent or an editor added under it, so they never keep it open', async () => {
    const subtask = taskRow({
      id: 't-sub',
      parentTaskId: 't-own',
      createdBy: 'agent-1',
      createdByType: 'agent',
    });
    await updateTaskStatus(fakeTx([OWN, subtask]), member, 't-sub', 'done');
    expect(wrote('UPDATE app.tasks SET status')).toBe(true);

    // Under someone else's task, a subtask stays theirs.
    statements = [];
    const theirs = taskRow({
      id: 't-sub',
      parentTaskId: 't-others',
      createdBy: 'agent-1',
      createdByType: 'agent',
    });
    await expect(
      updateTaskStatus(fakeTx([OTHERS, theirs]), member, 't-sub', 'done'),
    ).rejects.toMatchObject({ code: 'RBAC_FORBIDDEN' });
    expect(wrote('UPDATE app.tasks')).toBe(false);
  });
});

describe('a member who handed their task to an agent', () => {
  // Assigned to the member, the task became the agent's when the member
  // put it to work with an @mention; the run is still theirs.
  const handedOver = taskRow({
    id: 't-handed',
    createdBy: 'u-editor',
    assigneeType: 'agent',
    assigneeId: 'agent-1',
    status: 'in_progress',
  });
  const theirRun: LiveRun = {
    id: 'r-live',
    agentId: 'agent-1',
    status: 'running',
    startedBy: 'u-member',
  };

  it('steers the run they started with another @mention', async () => {
    await dispatchMentionedProjectAgent(
      fakeTx([handedOver], { liveRun: theirRun }),
      {
        auth: member,
        task: handedOver,
        project,
        mentions: [{ type: 'agent', id: 'agent-1' }],
        authorType: 'user',
        authorId: 'u-member',
        text: '@contract.reviewer use the signed copies only',
        source: 'comment',
      },
    );
    expect(addJobInTx).toHaveBeenCalledWith(
      expect.anything(),
      'task.agent_steer',
      expect.objectContaining({ runId: 'r-live', authorId: 'u-member' }),
    );
    expect(
      await mentionTriggerPreview(
        fakeTx([handedOver], { liveRun: theirRun }) as never,
        member,
        { taskId: 't-handed', slugs: ['agent-1'] },
      ),
    ).toEqual([{ slug: 'agent-1', willTrigger: true, reason: 'ok' }]);
  });

  it("does not steer someone else's run on a task that is not theirs", async () => {
    await dispatchMentionedProjectAgent(
      fakeTx([handedOver], {
        liveRun: { ...theirRun, startedBy: 'u-editor' },
      }),
      {
        auth: member,
        task: handedOver,
        project,
        mentions: [{ type: 'agent', id: 'agent-1' }],
        authorType: 'user',
        authorId: 'u-member',
        text: '@contract.reviewer stop',
        source: 'comment',
      },
    );
    expect(addJobInTx).not.toHaveBeenCalled();
  });
});

describe('a member decides the review of their own task only', () => {
  it("cannot accept the review of someone else's task", async () => {
    const theirs = taskRow({
      id: 't-others',
      createdBy: 'u-editor',
      status: 'in_review',
    });
    await expect(
      updateTaskStatus(fakeTx([theirs]), member, 't-others', 'done'),
    ).rejects.toMatchObject({ code: 'RBAC_FORBIDDEN' });
    expect(closePendingTaskReviewOnStatusLeave).not.toHaveBeenCalled();
    expect(wrote('UPDATE app.tasks')).toBe(false);
  });
});

describe("a member on someone else's task", () => {
  it('cannot edit, move, start or hand it on — and nothing is written', async () => {
    const agentTask = taskRow({
      id: 't-others',
      createdBy: 'u-editor',
      assigneeType: 'agent',
      assigneeId: 'agent-1',
    });
    const attempts = [
      () =>
        updateTask(fakeTx([OTHERS]), member, {
          taskId: 't-others',
          title: 'x',
        }),
      () => updateTaskStatus(fakeTx([OTHERS]), member, 't-others', 'done'),
      () => startTaskAgentRunManual(fakeTx([agentTask]), member, 't-others'),
      () =>
        assignTask(fakeTx([OTHERS]), member, {
          taskId: 't-others',
          assigneeType: 'user',
          assigneeId: 'u-member',
        }),
      () => archiveTask(fakeTx([OTHERS]), member, 't-others'),
      () =>
        restoreTask(fakeTx([{ ...OTHERS, archivedAt: 5 }]), member, 't-others'),
      () =>
        moveTask(fakeTx([OTHERS]), member, {
          taskId: 't-others',
          status: 'done',
        }),
      () =>
        removeTaskDependency(fakeTx([OWN, OTHERS]), member, {
          blockerTaskId: 't-own',
          blockedTaskId: 't-others',
        }),
    ];
    for (const attempt of attempts) {
      await expect(attempt()).rejects.toMatchObject({
        code: 'RBAC_FORBIDDEN',
        status: 403,
      });
    }
    expect(wrote('UPDATE app.tasks')).toBe(false);
    expect(kickAgentRun).not.toHaveBeenCalled();
  });

  it('keeps an @mention of an agent a plain mention', async () => {
    await dispatchMentionedProjectAgent(fakeTx([OTHERS]), {
      auth: member,
      task: OTHERS,
      project,
      mentions: [{ type: 'agent', id: 'agent-1' }],
      authorType: 'user',
      authorId: 'u-member',
      text: '@contract.reviewer take a look',
      source: 'comment',
    });

    expect(kickAgentRun).not.toHaveBeenCalled();
    expect(wrote('UPDATE app.tasks')).toBe(false);
  });
});

describe('the composer’s trigger preview tells the member the truth', () => {
  it('an agent mention on their own task will respond; on someone else’s it will not', async () => {
    const sql = fakeTx([OWN, OTHERS]) as unknown as Parameters<
      typeof mentionTriggerPreview
    >[0];
    expect(
      await mentionTriggerPreview(sql, member, {
        taskId: 't-own',
        slugs: ['agent-1'],
      }),
    ).toEqual([{ slug: 'agent-1', willTrigger: true, reason: 'ok' }]);
    expect(
      await mentionTriggerPreview(sql, member, {
        taskId: 't-others',
        slugs: ['agent-1'],
      }),
    ).toEqual([
      { slug: 'agent-1', willTrigger: false, reason: 'not_permitted' },
    ]);
    // A new task's description is its creator's to write.
    expect(
      await mentionTriggerPreview(sql, member, {
        projectId: 'p-1',
        slugs: ['agent-1'],
      }),
    ).toEqual([{ slug: 'agent-1', willTrigger: true, reason: 'ok' }]);
  });
});

describe('editors, as before', () => {
  it("work anyone's task and start its agent", async () => {
    await updateTask(fakeTx([OTHERS]), editor, {
      taskId: 't-others',
      title: 'Summarize the supplier contracts (Q3)',
    });
    expect(wrote('UPDATE app.tasks SET title')).toBe(true);

    const agentTask = taskRow({
      id: 't-others',
      createdBy: 'u-someone',
      assigneeType: 'agent',
      assigneeId: 'agent-1',
    });
    await startTaskAgentRunManual(fakeTx([agentTask]), editor, 't-others');
    expect(kickAgentRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ startedBy: 'u-editor' }),
    );
  });
});
