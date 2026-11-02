import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { notifyTaskAssigned } from '../collab/service.ts';
import {
  setAgentTaskLabels,
  updateAgentTaskMetadata,
} from './agent-metadata.ts';
import type { TaskRow } from './service.ts';

vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));
vi.mock('../collab/service.ts', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  notifyTaskAssigned: vi.fn(),
}));

function taskRow(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 'task',
    organizationId: 'org',
    projectId: 'project',
    title: 'Triage',
    description: null,
    attachments: null,
    outputs: null,
    number: 1,
    status: 'todo',
    priority: null,
    labelIds: [],
    assigneeType: null,
    assigneeId: null,
    reviewerUserId: 'reviewer',
    reviewerAgentId: null,
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
    totalCostCents: 21,
    agentRunCount: 4,
    lastAgentRunAt: 100,
    claimedAt: null,
    completedAt: null,
    externalClosedAt: null,
    repeat: null,
    repeatNextTaskId: null,
    repeatContinued: false,
    createdBy: 'person',
    createdByType: 'user',
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
    ...overrides,
  };
}

/** Actual domain writers over a statement-recording database; only external
 * audit/notification/outbox sinks are inert. Real rollback and contention
 * are proved by the companion Postgres integration lane. */
function fixture(
  options: {
    task?: Partial<TaskRow>;
    missing?: boolean;
    archivedProject?: boolean;
    pendingReview?: boolean;
    live?: 'agent' | 'automation';
    invalidAgent?: boolean;
    /** The acting agent's grant as its row stores it; `null` for no row. */
    grant?: { tools: string[]; labelGrants: string[] } | null;
  } = {},
) {
  const task = taskRow(options.task);
  const statements: { text: string; values: unknown[] }[] = [];
  const tag = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.startsWith('SELECT ? FROM app.tasks'))
      return options.missing ? [] : [{ ...task }];
    if (text.startsWith('SELECT ? FROM app.projects'))
      return [
        {
          id: 'project',
          organizationId: 'org',
          teamId: null,
          sharedWithTeamIds: [],
          teamIds: [],
          archivedAt: options.archivedProject ? 1 : null,
        },
      ];
    if (text.includes('FROM app.approvals'))
      return options.pendingReview
        ? [
            {
              id: 'review',
              metadata: { requestedFor: 'reviewer' },
              createdAt: 1,
            },
          ]
        : [];
    if (text.includes('label_grants AS "labelGrants" FROM app.project_agents'))
      return options.grant === null
        ? []
        : [
            options.grant ?? {
              tools: ['task_update_metadata', 'task_set_labels'],
              labelGrants: ['Bug', 'optional-ci'],
            },
          ];
    if (text.includes('FROM app.project_agents'))
      return options.invalidAgent ? [] : [{ id: values[0] }];
    if (text.startsWith('SELECT name FROM app.task_labels')) {
      const keys = values[2] as string[];
      return CATALOG.filter(
        (label) =>
          label.projectId === values[1] &&
          keys.includes(label.name.toLowerCase()),
      ).map(({ name }) => ({ name }));
    }
    if (text.startsWith('SELECT id, project_id AS "projectId", name FROM'))
      return CATALOG.filter((label) =>
        (values[1] as string[]).includes(label.id),
      );
    if (text.startsWith('SELECT id FROM app.task_labels'))
      return CATALOG.filter(
        (label) =>
          label.projectId === values[0] &&
          label.name.toLowerCase() === String(values[1]).toLowerCase(),
      ).map(({ id }) => ({ id }));
    if (text.includes('FROM app.project_agent_runs'))
      return options.live === 'agent' ? [{ id: 'live-agent' }] : [];
    if (text.includes('FROM app.automation_runs'))
      return options.live === 'automation' ? [{ id: 'live-automation' }] : [];
    if (text.startsWith('UPDATE app.tasks SET assignee_type')) {
      task.assigneeType = values[0] as TaskRow['assigneeType'];
      task.assigneeId = values[1] as string | null;
    }
    if (text.startsWith('UPDATE app.tasks SET title')) {
      task.priority = values[2] as TaskRow['priority'];
      task.labelIds = values[3] as string[];
    }
    return [];
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- statement-recording postgres.js stand-in, no live effects
  const tx = Object.assign(tag, {
    unsafe: (value: string) => value,
    json: (value: unknown) => value,
  }) as unknown as TransactionSql;
  return {
    task,
    statements,
    tx,
    call: (patch: unknown, reachedProjectIds?: string[]) =>
      updateAgentTaskMetadata(tx, {
        organizationId: 'org',
        projectId: 'project',
        ...(reachedProjectIds !== undefined ? { reachedProjectIds } : {}),
        actorId: 'manager',
        patch,
      }),
    labels: (patch: unknown, reachedProjectIds?: string[]) =>
      setAgentTaskLabels(tx, {
        organizationId: 'org',
        projectId: 'project',
        ...(reachedProjectIds !== undefined ? { reachedProjectIds } : {}),
        actorId: 'manager',
        patch,
      }),
  };
}

/** The labels of the boards the label tool reaches. */
const CATALOG = [
  { id: 'label-bug', projectId: 'project', name: 'Bug' },
  { id: 'label-ci', projectId: 'project', name: 'optional-ci' },
  { id: 'label-hold', projectId: 'project', name: 'hold' },
  { id: 'label-other-bug', projectId: 'other', name: 'Bug' },
];

/** Every statement that writes, the run-start lock's included. */
const writes = (statements: { text: string; values: unknown[] }[]) =>
  statements.filter(({ text }) => /^(UPDATE|INSERT|DELETE)\b/.test(text));

const combined = {
  taskId: 'task',
  priority: 'p1',
  agentId: 'worker',
  expected: { priority: null, assignee: null },
};
const activity = (statements: { text: string; values: unknown[] }[]) =>
  statements.filter((item) =>
    item.text.startsWith('INSERT INTO app.task_activity'),
  );

beforeEach(() => vi.clearAllMocks());

describe('agent metadata domain', () => {
  it('assigns and prioritizes through shared writers with agent audit and board hints', async () => {
    const f = fixture();
    expect(await f.call(combined)).toEqual({
      taskId: 'task',
      priority: 'p1',
      assigneeType: 'agent',
      assigneeId: 'worker',
      changed: true,
    });
    const lock = f.statements.findIndex(({ text }) =>
      text.startsWith('UPDATE app.tasks SET updated_at_ms = updated_at_ms'),
    );
    const liveRead = f.statements.findIndex(({ text }) =>
      text.includes('FROM app.project_agent_runs'),
    );
    expect(lock).toBeGreaterThan(0);
    expect(lock).toBeLessThan(liveRead);
    expect(activity(f.statements).map((row) => row.values.slice(3, 8))).toEqual(
      [
        ['agent', 'manager', 'assignee.changed', null, 'worker'],
        ['agent', 'manager', 'priority.changed', '', 'p1'],
      ],
    );
    expect(vi.mocked(createAuditLog).mock.calls.map((call) => call[1])).toEqual(
      [
        expect.objectContaining({
          actorType: 'api',
          actorId: 'manager',
          metadata: { viaAgent: true, projectId: 'project' },
          newState: { assigneeType: 'agent', assigneeId: 'worker' },
        }),
        expect.objectContaining({
          actorType: 'api',
          actorId: 'manager',
          metadata: { viaAgent: true, projectId: 'project' },
          newState: { priority: 'p1' },
        }),
      ],
    );
    expect(notifyTaskAssigned).toHaveBeenCalledWith(
      f.tx,
      expect.objectContaining({
        actorType: 'agent',
        actorId: 'manager',
        assigneeId: 'worker',
      }),
    );
    expect(emitHintInTx).toHaveBeenCalledTimes(2);
    expect(
      f.statements.some(({ text }) =>
        /INSERT INTO app\.(project_agent_runs|automation_runs)|app_jobs|UPDATE app\.approvals/.test(
          text,
        ),
      ),
    ).toBe(false);
    expect(f.task).toMatchObject({
      status: 'todo',
      reviewerUserId: 'reviewer',
      agentRunCount: 4,
      totalCostCents: 21,
    });
  });

  it('clears an owner and priority and attributes the unassignment to the manager', async () => {
    const f = fixture({
      task: { priority: 'p2', assigneeType: 'agent', assigneeId: 'worker' },
    });
    expect(
      await f.call({
        taskId: 'task',
        priority: null,
        agentId: null,
        expected: { priority: 'p2', assignee: { type: 'agent', id: 'worker' } },
      }),
    ).toEqual({
      taskId: 'task',
      priority: null,
      assigneeType: null,
      assigneeId: null,
      changed: true,
    });
    expect(notifyTaskAssigned).toHaveBeenCalledWith(
      f.tx,
      expect.objectContaining({
        assigneeType: null,
        assigneeId: null,
        previousAssigneeId: 'worker',
      }),
    );
  });

  it.each(['user', 'agent', 'app'] as const)(
    'intentionally transfers an idle %s owner without execution',
    async (type) => {
      const f = fixture({
        task: { assigneeType: type, assigneeId: 'previous' },
      });
      expect(
        await f.call({
          taskId: 'task',
          agentId: 'manager',
          expected: { assignee: { type, id: 'previous' } },
        }),
      ).toMatchObject({ assigneeId: 'manager', changed: true });
    },
  );

  it('matching no-op succeeds under live review without another change trail', async () => {
    const f = fixture({
      task: {
        status: 'in_review',
        priority: 'p1',
        assigneeType: 'agent',
        assigneeId: 'worker',
      },
      pendingReview: true,
      live: 'agent',
    });
    expect(
      await f.call({
        ...combined,
        expected: { priority: 'p1', assignee: { type: 'agent', id: 'worker' } },
      }),
    ).toMatchObject({ changed: false });
    expect(activity(f.statements)).toEqual([]);
    expect(createAuditLog).not.toHaveBeenCalled();
    expect(emitHintInTx).not.toHaveBeenCalled();
  });

  it('priority alone preserves a pending human handoff and its owner', async () => {
    const f = fixture({
      task: {
        status: 'in_review',
        assigneeType: 'agent',
        assigneeId: 'worker',
      },
      pendingReview: true,
      live: 'agent',
    });
    await f.call({
      taskId: 'task',
      priority: 'p0',
      expected: { priority: null },
    });
    expect(f.task).toMatchObject({
      status: 'in_review',
      assigneeId: 'worker',
      reviewerUserId: 'reviewer',
      priority: 'p0',
    });
    expect(activity(f.statements).map((row) => row.values[5])).toEqual([
      'priority.changed',
    ]);
    expect(notifyTaskAssigned).not.toHaveBeenCalled();
    expect(
      f.statements.some(({ text }) =>
        /UPDATE app\.(approvals|project_agent_runs|automation_runs)/.test(text),
      ),
    ).toBe(false);
  });

  it.each([
    [{ live: 'agent' }, 'TASK_HAS_LIVE_RUN'],
    [{ live: 'automation' }, 'TASK_HAS_LIVE_RUN'],
    [{ pendingReview: true }, 'TASK_METADATA_OWNER_PROTECTED'],
    [{ task: { status: 'in_review' } }, 'TASK_METADATA_OWNER_PROTECTED'],
    [{ task: { status: 'done' } }, 'TASK_METADATA_OWNER_PROTECTED'],
    [{ task: { status: 'cancelled' } }, 'TASK_METADATA_OWNER_PROTECTED'],
    [{ invalidAgent: true }, 'AGENT_NOT_ALLOWED_IN_PROJECT'],
    [{ archivedProject: true }, 'PROJECT_ARCHIVED'],
    [{ task: { archivedAt: 1 } }, 'TASK_ARCHIVED'],
    [{ missing: true }, 'TASK_NOT_FOUND'],
    [{ task: { projectId: 'foreign' } }, 'TASK_NOT_FOUND'],
    [{ task: { priority: 'p3' } }, 'TASK_METADATA_STALE'],
    [
      { task: { assigneeType: 'user', assigneeId: 'new-owner' } },
      'TASK_METADATA_STALE',
    ],
  ] as const)(
    'refuses combined changes before either field changes (%j)',
    async (options, code) => {
      const f = fixture(options);
      const before = { ...f.task };
      await expect(f.call(combined)).rejects.toMatchObject({ code });
      expect(f.task).toEqual(before);
      expect(activity(f.statements)).toEqual([]);
      expect(createAuditLog).not.toHaveBeenCalled();
    },
  );

  it('stale desired no-op still refuses: desired equality does not replace the expectation', async () => {
    const f = fixture({ task: { priority: 'p1' } });
    await expect(
      f.call({ taskId: 'task', priority: 'p1', expected: { priority: null } }),
    ).rejects.toMatchObject({ code: 'TASK_METADATA_STALE' });
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it.each([{ missing: true }, { task: { projectId: 'foreign' } }])(
    'never locks a missing or foreign-project target (%j)',
    async (options) => {
      const f = fixture(options);
      await expect(f.call(combined)).rejects.toMatchObject({
        code: 'TASK_NOT_FOUND',
        status: 404,
      });
      expect(
        f.statements.some(
          ({ text }) => text.startsWith('UPDATE') || text.startsWith('INSERT'),
        ),
      ).toBe(false);
    },
  );

  it('assigning the running issuer to its live target is still a transfer refusal', async () => {
    const f = fixture({ live: 'agent' });
    await expect(
      f.call({
        taskId: 'task',
        agentId: 'manager',
        expected: { assignee: null },
      }),
    ).rejects.toMatchObject({ code: 'TASK_HAS_LIVE_RUN' });
  });
});

describe('the agents of a dispatch work the boards it serves like their own [TASK-R73]', () => {
  it('changes a task of a board its project’s dispatch serves, and never one of a board it does not', async () => {
    const served = fixture({ task: { projectId: 'served-board' } });
    expect(
      await served.call(
        {
          taskId: 'task',
          priority: 'p1',
          expected: { priority: null },
        },
        ['served-board'],
      ),
    ).toMatchObject({ taskId: 'task', priority: 'p1', changed: true });
    const unserved = fixture({ task: { projectId: 'other-board' } });
    await expect(
      unserved.call(
        {
          taskId: 'task',
          priority: 'p1',
          expected: { priority: null },
        },
        ['served-board'],
      ),
    ).rejects.toMatchObject({ code: 'TASK_NOT_FOUND' });
  });
});

describe('agent label domain', () => {
  it("adds and removes only labels its grant names, whatever their case, in the board's spelling [TASK-R94]", async () => {
    const f = fixture({ task: { labelIds: ['label-bug'] } });
    expect(
      await f.labels({
        taskId: 'task',
        add: ['OPTIONAL-CI'],
        remove: ['bug'],
        expected: { labels: ['bug'] },
      }),
    ).toEqual({ taskId: 'task', labels: ['optional-ci'], changed: true });
    expect(f.task.labelIds).toEqual(['label-ci']);
  });

  it.each([
    [{ add: ['hold'] }, ['hold']],
    [{ remove: ['Hold'] }, ['Hold']],
    [{ add: ['optional-ci', 'hold'] }, ['hold']],
  ])(
    'refuses a label its grant does not name before any write, naming it only in data (%j) [TASK-R94]',
    async (change, labels) => {
      const f = fixture({ task: { labelIds: ['label-hold'] } });
      await expect(
        f.labels({ taskId: 'task', ...change, expected: { labels: ['hold'] } }),
      ).rejects.toMatchObject({
        code: 'TASK_LABEL_NOT_GRANTED',
        status: 403,
        data: { labels },
        message: expect.not.stringMatching(/hold/i),
      });
      expect(writes(f.statements)).toEqual([]);
    },
  );

  it("refuses a granted label the task's board does not have, and never creates it [TASK-R94]", async () => {
    const f = fixture({ task: { projectId: 'other' } });
    await expect(
      f.labels(
        { taskId: 'task', add: ['optional-ci'], expected: { labels: [] } },
        ['other'],
      ),
    ).rejects.toMatchObject({
      code: 'TASK_LABEL_UNKNOWN',
      status: 400,
      data: { labels: ['optional-ci'] },
      message: expect.not.stringMatching(/optional/i),
    });
    expect(
      writes(f.statements).filter(
        ({ text }) => !text.startsWith('UPDATE app.tasks SET updated_at_ms'),
      ),
    ).toEqual([]);
  });

  it("sets a label on a board its dispatch reaches by that board's own label [TASK-R94]", async () => {
    const f = fixture({ task: { projectId: 'other' } });
    expect(
      await f.labels(
        { taskId: 'task', add: ['bug'], expected: { labels: [] } },
        ['other'],
      ),
    ).toEqual({ taskId: 'task', labels: ['Bug'], changed: true });
    expect(f.task.labelIds).toEqual(['label-other-bug']);
  });

  it.each([[[]], [['Bug']], [['Bug', 'hold', 'optional-ci']]])(
    'refuses a label list that is not the one the task wears now (%j) [TASK-R95]',
    async (expectedLabels) => {
      const f = fixture({ task: { labelIds: ['label-bug', 'label-hold'] } });
      await expect(
        f.labels({
          taskId: 'task',
          add: ['optional-ci'],
          expected: { labels: expectedLabels },
        }),
      ).rejects.toMatchObject({ code: 'TASK_METADATA_STALE', status: 409 });
      expect(
        f.statements.some(({ text }) =>
          /^UPDATE app\.tasks SET title|^INSERT/.test(text),
        ),
      ).toBe(false);
      expect(f.task.labelIds).toEqual(['label-bug', 'label-hold']);
    },
  );

  it('answers a request that changes nothing without writing a row [TASK-R95]', async () => {
    const f = fixture({ task: { labelIds: ['label-bug'] } });
    expect(
      await f.labels({
        taskId: 'task',
        add: ['bug'],
        remove: ['optional-ci'],
        expected: { labels: ['BUG'] },
      }),
    ).toEqual({ taskId: 'task', labels: ['Bug'], changed: false });
    expect(
      f.statements.some(({ text }) =>
        /^UPDATE app\.tasks SET title|^INSERT/.test(text),
      ),
    ).toBe(false);
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { tools: ['task_update_metadata'], labelGrants: ['Bug', 'optional-ci'] },
  ])(
    'reads the grant live: an agent no longer granted the tool is refused before any write (%j) [TASK-R96]',
    async (grant) => {
      const f = fixture({ grant });
      await expect(
        f.labels({ taskId: 'task', add: ['bug'], expected: { labels: [] } }),
      ).rejects.toMatchObject({ code: 'TASK_LABELS_FORBIDDEN', status: 403 });
      expect(writes(f.statements)).toEqual([]);
    },
  );

  it("records the change as the agent's on the timeline and in the audit log [TASK-R97]", async () => {
    const f = fixture({ task: { labelIds: ['label-bug'] } });
    await f.labels({
      taskId: 'task',
      add: ['optional-ci'],
      expected: { labels: ['Bug'] },
    });
    expect(activity(f.statements).map((row) => row.values.slice(3, 6))).toEqual(
      [['agent', 'manager', 'labels.changed']],
    );
    expect(vi.mocked(createAuditLog).mock.calls.map((call) => call[1])).toEqual(
      [
        expect.objectContaining({
          actorType: 'api',
          actorId: 'manager',
          metadata: { viaAgent: true, projectId: 'project' },
          previousState: { labelIds: ['label-bug'] },
          newState: { labelIds: ['label-bug', 'label-ci'] },
        }),
      ],
    );
    expect(emitHintInTx).toHaveBeenCalled();
  });

  it.each([
    { taskId: 'task', expected: { labels: [] } },
    { taskId: 'task', add: ['bug'], remove: ['BUG'], expected: { labels: [] } },
    { taskId: 'task', add: ['bug'] },
    { taskId: 'task', add: ['bug'], expected: { labels: [] }, priority: 'p1' },
  ])(
    'refuses a malformed label request before reading the task (%j)',
    async (patch) => {
      const f = fixture();
      await expect(f.labels(patch)).rejects.toMatchObject({
        code: 'TASK_LABELS_INVALID',
        status: 400,
      });
      expect(f.statements).toEqual([]);
    },
  );
});
