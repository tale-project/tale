import type { Sql, TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addJobInTx } from '../../jobs/enqueue.ts';
import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import { resolveSurfaceMentions } from '../collab/mention-directory.ts';
import { notifyTaskMentions } from '../collab/service.ts';
import { loadProjectOrThrow, type ProjectRow } from '../projects/service.ts';
import { kickAgentRun } from './agent-runs.ts';
import { requestTaskReview } from './reviews.ts';
import {
  createTask,
  mentionTriggerPreview,
  type TaskRow,
  updateTask,
} from './service.ts';

vi.mock('../collab/mention-directory.ts', () => ({
  resolveSurfaceMentions: vi.fn(),
}));
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
vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));
vi.mock('../files/upload-intents.ts', () => ({
  firstForeignUpload: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../lib/org-config.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/org-config.ts')>()),
  readGovernancePolicyForOrg: vi.fn(),
}));
vi.mock('./reviews.ts', () => ({
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
 * A description's @mentions do what a comment's do. The composer promises it
 * under the description (`MentionTriggerChips`: "X will respond"), and
 * `createTask` used to end in a TODO. The named humans get the mention bell;
 * a named project agent is assigned and kicked while the task is idle, or
 * steered while it runs, under the task automation switch the chips preview.
 * An edit fans out only the mentions it ADDS.
 *
 * The resolution itself (the directory, the edit diff) is the directory
 * module's and has its own tests; here it is scripted, and what is pinned
 * is what the service does with its answer. The real-Postgres lane is
 * `checkTaskDescriptionMentions` in `backend:integration`.
 */

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
  projectAgentCount: 1,
  teamId: null,
  sharedWithTeamIds: [],
  teamIds: [],
  instructions: null,
  createdBy: 'u-owner',
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  pinnedAt: null,
};

const WRITER = {
  id: 'agent-writer',
  harness: 'claude-code',
  model: 'itest-model',
  modelProvider: null,
};
const ADA = { type: 'user' as const, id: 'u-ada' };
const BOB = { type: 'user' as const, id: 'u-bob' };
const WRITER_MENTION = { type: 'agent' as const, id: WRITER.id };

function taskRow(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 't-1',
    organizationId: 'org-1',
    projectId: 'p-1',
    title: 'Draft the overview',
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
    createdBy: 'u-owner',
    createdByType: 'user',
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
    ...overrides,
  };
}

interface LiveRun {
  id: string;
  agentId: string;
  status: 'queued' | 'running';
  execId: string;
  sessionId: string;
  harness: string;
  model: string;
  modelProvider: string | null;
  deadlineAt: number;
}

/** A postgres.js stand-in answering the statements the create/edit path and
 * the mention dispatcher read; `state.liveRun` is the task's live agent run
 * the dispatcher's probe sees. */
function fakeTx(task: TaskRow, state: { liveRun?: LiveRun } = {}) {
  const statements: { text: string; values: unknown[] }[] = [];
  const tag = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.startsWith('SELECT ? FROM app.tasks WHERE id = ?')) {
      return Promise.resolve([task]);
    }
    // The kick's move, so a later read of the card sees it.
    if (text.startsWith("UPDATE app.tasks SET status = 'in_progress'")) {
      task.status = 'in_progress';
      return Promise.resolve([]);
    }
    if (text.startsWith('UPDATE app.projects SET task_counter')) {
      return Promise.resolve([{ taskCounter: 7 }]);
    }
    if (text.startsWith('INSERT INTO app.tasks')) {
      return Promise.resolve([{ id: task.id }]);
    }
    if (text.startsWith('SELECT id, agent_id AS "agentId", status, exec_id')) {
      return Promise.resolve(
        state.liveRun === undefined ? [] : [state.liveRun],
      );
    }
    // The dispatcher's instance lookup (and the create choreography's).
    if (
      text.startsWith(
        'SELECT id, harness, model, model_provider AS "modelProvider" FROM app.project_agents',
      )
    ) {
      return Promise.resolve([WRITER]);
    }
    // `assignTask`'s check that the agent is an instance of this project.
    if (text.startsWith('SELECT id FROM app.project_agents')) {
      return Promise.resolve([{ id: WRITER.id }]);
    }
    if (text.startsWith('SELECT instructions, skills, connectors')) {
      return Promise.resolve([
        {
          instructions: null,
          skills: [],
          connectors: [],
          tools: [],
          secrets: [],
        },
      ]);
    }
    if (text.startsWith('SELECT "name", "email" FROM "user"')) {
      return Promise.resolve([{ name: 'Olive Owner', email: null }]);
    }
    return Promise.resolve([]);
  };
  const tx = Object.assign(tag, {
    json: (value: unknown) => ({ json: value }),
    unsafe: (text: string): unknown => text,
  });
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a three-member stand-in for the postgres.js transaction function
    tx: tx as unknown as TransactionSql,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the same stand-in for a read outside a transaction
    sql: tx as unknown as Sql,
    statements,
  };
}

function resolvesTo(
  mentions: { type: 'user' | 'agent'; id: string }[],
  added = mentions,
) {
  vi.mocked(resolveSurfaceMentions).mockResolvedValue({
    mentions,
    added,
    unresolvedMentionTokens: [],
  });
}

function assigned(statements: { text: string; values: unknown[] }[]) {
  return statements.filter((statement) =>
    statement.text.startsWith('UPDATE app.tasks SET assignee_type'),
  );
}

function movedToInProgress(statements: { text: string; values: unknown[] }[]) {
  return statements.filter((statement) =>
    statement.text.startsWith("UPDATE app.tasks SET status = 'in_progress'"),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadProjectOrThrow).mockResolvedValue(project);
  vi.mocked(readGovernancePolicyForOrg).mockResolvedValue({ enabled: true });
  vi.mocked(kickAgentRun).mockResolvedValue({
    runId: 'run-1',
    execId: 'exec-1',
    reused: false,
  });
});

describe('createTask — description @mentions fan out', () => {
  it('builds no directory for a description that names nobody', async () => {
    const { tx } = fakeTx(taskRow());
    await createTask(tx, auth, {
      projectId: 'p-1',
      title: 'Draft the overview',
      // An address is not a mention: the grammar wants a boundary before `@`.
      description: 'Plain brief; send questions to ada@example.com',
    });
    expect(resolveSurfaceMentions).not.toHaveBeenCalled();
    expect(notifyTaskMentions).not.toHaveBeenCalled();
    expect(kickAgentRun).not.toHaveBeenCalled();
  });

  it('bells the named teammate and puts the named agent to work', async () => {
    const description = '@ada and @writer: draft a one-page overview';
    resolvesTo([ADA, WRITER_MENTION]);
    const { tx, statements } = fakeTx(taskRow({ id: 't-new' }));

    await createTask(tx, auth, {
      projectId: 'p-1',
      title: 'Draft the overview',
      description,
    });

    // Every mention is new on create: no previous text to diff against.
    expect(resolveSurfaceMentions).toHaveBeenCalledWith(tx, {
      organizationId: 'org-1',
      projectId: 'p-1',
      body: description,
    });
    expect(notifyTaskMentions).toHaveBeenCalledWith(tx, {
      task: expect.objectContaining({ id: 't-new', projectId: 'p-1' }),
      mentions: [ADA, WRITER_MENTION],
      actorType: 'user',
      actorId: 'u-owner',
    });
    // The idle lane: (re)assigned like the picker, a 'mention' run kicked
    // with the text that named the agent, and the card moved to In progress.
    expect(assigned(statements)[0]?.values.slice(0, 2)).toEqual([
      'agent',
      WRITER.id,
    ]);
    expect(kickAgentRun).toHaveBeenCalledTimes(1);
    expect(kickAgentRun).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        taskId: 't-new',
        agentId: WRITER.id,
        trigger: 'mention',
        mentionSource: 'description',
        startedBy: 'u-owner',
      }),
    );
    // No copy of the text rides the run: its start reads the description as
    // it stands then, so an edit made while it waits is not contradicted.
    expect(vi.mocked(kickAgentRun).mock.calls[0]?.[1]).not.toHaveProperty(
      'feedback',
    );
    expect(movedToInProgress(statements)).toHaveLength(1);
  });

  it('leaves a card born In progress with the run its assignee was given', async () => {
    resolvesTo([WRITER_MENTION]);
    const state: { liveRun?: LiveRun } = {};
    vi.mocked(kickAgentRun).mockImplementation(() => {
      // The choreography's kick queues the run the dispatcher then sees.
      state.liveRun = {
        id: 'run-1',
        agentId: WRITER.id,
        status: 'queued',
        execId: 'exec-1',
        sessionId: `pa-${WRITER.id}`,
        harness: WRITER.harness,
        model: WRITER.model,
        modelProvider: null,
        deadlineAt: Date.now() + 60_000,
      };
      return Promise.resolve({
        runId: 'run-1',
        execId: 'exec-1',
        reused: false,
      });
    });
    const { tx, statements } = fakeTx(
      taskRow({
        id: 't-new',
        status: 'in_progress',
        assigneeType: 'agent',
        assigneeId: WRITER.id,
      }),
      state,
    );

    await createTask(tx, auth, {
      projectId: 'p-1',
      title: 'Draft the overview',
      description: '@writer draft it',
      status: 'in_progress',
      assigneeType: 'agent',
      assigneeId: WRITER.id,
    });

    // One engine per task: the manual kick of the choreography, and no
    // mention kick or steer on top of the queued run.
    expect(kickAgentRun).toHaveBeenCalledTimes(1);
    expect(kickAgentRun).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ trigger: 'manual' }),
    );
    expect(addJobInTx).not.toHaveBeenCalledWith(
      tx,
      'task.agent_steer',
      expect.anything(),
    );
    expect(assigned(statements)).toEqual([]);
  });

  it('starts one mention run for an agent named on a card born In progress for a person', async () => {
    resolvesTo([WRITER_MENTION]);
    const { tx, statements } = fakeTx(
      taskRow({
        id: 't-new',
        status: 'in_progress',
        assigneeType: 'user',
        assigneeId: 'u-owner',
      }),
    );

    await createTask(tx, auth, {
      projectId: 'p-1',
      title: 'Draft the overview',
      description: '@writer draft it',
      status: 'in_progress',
      assigneeType: 'user',
      assigneeId: 'u-owner',
    });

    // A person's card gets no run from the choreography; the mention is
    // the only start, and the card is already where the kick would move it.
    expect(kickAgentRun).toHaveBeenCalledTimes(1);
    expect(kickAgentRun).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ trigger: 'mention', agentId: WRITER.id }),
    );
    expect(assigned(statements)[0]?.values.slice(0, 2)).toEqual([
      'agent',
      WRITER.id,
    ]);
    expect(movedToInProgress(statements)).toEqual([]);
  });

  it('opens no review for a card born In review whose description puts an agent to work', async () => {
    resolvesTo([WRITER_MENTION]);
    const { tx, statements } = fakeTx(
      taskRow({ id: 't-new', status: 'in_review' }),
    );

    await createTask(tx, auth, {
      projectId: 'p-1',
      title: 'Draft the overview',
      description: '@writer draft it',
      status: 'in_review',
    });

    // The agent is put to work, which moves the card to In progress; a
    // review opened first would ring the reviewer and be withdrawn at once.
    expect(kickAgentRun).toHaveBeenCalledTimes(1);
    expect(movedToInProgress(statements)).toHaveLength(1);
    expect(requestTaskReview).not.toHaveBeenCalled();
  });

  it('still opens the review for a card born In review that names only people', async () => {
    resolvesTo([ADA]);
    const { tx } = fakeTx(taskRow({ id: 't-new', status: 'in_review' }));

    await createTask(tx, auth, {
      projectId: 'p-1',
      title: 'Draft the overview',
      description: '@ada please review',
      status: 'in_review',
    });

    expect(notifyTaskMentions).toHaveBeenCalledTimes(1);
    expect(kickAgentRun).not.toHaveBeenCalled();
    expect(requestTaskReview).toHaveBeenCalledTimes(1);
    expect(requestTaskReview).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        task: expect.objectContaining({ id: 't-new', status: 'in_review' }),
      }),
    );
  });
});

describe('updateTask — only the mentions an edit adds fan out', () => {
  it('resolves the new text against the one it replaces and fans out the added mention', async () => {
    resolvesTo([ADA, BOB], [BOB]);
    const { tx } = fakeTx(taskRow({ description: '@ada please review' }));

    await updateTask(tx, auth, {
      taskId: 't-1',
      description: '@ada please review, cc @bob',
    });

    expect(resolveSurfaceMentions).toHaveBeenCalledWith(tx, {
      organizationId: 'org-1',
      projectId: 'p-1',
      body: '@ada please review, cc @bob',
      previousBody: '@ada please review',
    });
    expect(notifyTaskMentions).toHaveBeenCalledTimes(1);
    expect(notifyTaskMentions).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ mentions: [BOB] }),
    );
    expect(kickAgentRun).not.toHaveBeenCalled();
  });

  it('builds no directory for an edit that adds no @token', async () => {
    const { tx, statements } = fakeTx(
      taskRow({ description: '@ada and @writer: draft it' }),
    );

    await updateTask(tx, auth, {
      taskId: 't-1',
      // Reworded, reordered, one token dropped: nothing the old text lacked.
      description: 'By Friday, @WRITER: draft it',
    });

    expect(resolveSurfaceMentions).not.toHaveBeenCalled();
    expect(notifyTaskMentions).not.toHaveBeenCalled();
    expect(kickAgentRun).not.toHaveBeenCalled();
    expect(
      statements.some((statement) =>
        statement.text.includes('FROM app.project_agent_runs'),
      ),
    ).toBe(false);
  });

  it('fires nothing again for a new handle of someone already named', async () => {
    resolvesTo([ADA, WRITER_MENTION], []);
    const { tx, statements } = fakeTx(
      taskRow({ description: '@ada and @writer: draft it' }),
    );

    await updateTask(tx, auth, {
      taskId: 't-1',
      description: '@ada.lovelace and @writer: draft it by Friday',
    });

    expect(resolveSurfaceMentions).toHaveBeenCalledTimes(1);
    expect(notifyTaskMentions).not.toHaveBeenCalled();
    expect(kickAgentRun).not.toHaveBeenCalled();
    expect(addJobInTx).not.toHaveBeenCalled();
    // The dispatcher never ran: no probe of the task's live runs.
    expect(
      statements.some((statement) =>
        statement.text.includes('FROM app.project_agent_runs'),
      ),
    ).toBe(false);
  });

  it('resolves nothing when the edit leaves the description alone or clears it', async () => {
    const task = taskRow({ description: '@ada please review' });
    await updateTask(fakeTx(task).tx, auth, {
      taskId: 't-1',
      title: 'A better title',
    });
    await updateTask(fakeTx(task).tx, auth, {
      taskId: 't-1',
      description: '@ada please review',
    });
    await updateTask(fakeTx(task).tx, auth, {
      taskId: 't-1',
      description: null,
    });
    expect(resolveSurfaceMentions).not.toHaveBeenCalled();
  });

  it('with task automation off, still bells the humans but leaves the agent idle — as the preview says', async () => {
    vi.mocked(readGovernancePolicyForOrg).mockResolvedValue({
      enabled: false,
    });
    resolvesTo([ADA, WRITER_MENTION]);
    const { tx, sql, statements } = fakeTx(
      taskRow({ description: 'Draft it' }),
    );

    await expect(
      mentionTriggerPreview(sql, auth, { taskId: 't-1', slugs: [WRITER.id] }),
    ).resolves.toEqual([
      { slug: WRITER.id, willTrigger: false, reason: 'pack_disabled' },
    ]);
    await updateTask(tx, auth, {
      taskId: 't-1',
      description: '@ada and @writer: draft it',
    });

    expect(notifyTaskMentions).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ mentions: [ADA, WRITER_MENTION] }),
    );
    expect(kickAgentRun).not.toHaveBeenCalled();
    expect(assigned(statements)).toEqual([]);
    expect(movedToInProgress(statements)).toEqual([]);
  });

  it('steers the running agent it newly names with the edited description', async () => {
    resolvesTo([WRITER_MENTION]);
    const description = 'Draft it. @writer: also add a summary table';
    const { tx, statements } = fakeTx(
      taskRow({
        description: 'Draft it.',
        status: 'in_progress',
        assigneeType: 'agent',
        assigneeId: WRITER.id,
      }),
      {
        liveRun: {
          id: 'run-9',
          agentId: WRITER.id,
          status: 'running',
          execId: 'exec-9',
          sessionId: `pa-${WRITER.id}`,
          harness: WRITER.harness,
          model: WRITER.model,
          modelProvider: null,
          deadlineAt: Date.now() + 60_000,
        },
      },
    );

    await updateTask(tx, auth, { taskId: 't-1', description });

    expect(addJobInTx).toHaveBeenCalledWith(
      tx,
      'task.agent_steer',
      expect.objectContaining({
        runId: 'run-9',
        execId: 'exec-9',
        feedback: description,
        mentionSource: 'description',
        author: 'Olive Owner',
        authorId: 'u-owner',
      }),
    );
    expect(kickAgentRun).not.toHaveBeenCalled();
    expect(assigned(statements)).toEqual([]);
  });
});
