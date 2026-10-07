// @vitest-environment node

/**
 * The task domain names the limit a value broke. `validateTitle` threw one
 * "Invalid title" for an empty title and an over-long one on the human create
 * and update paths (GitHub #3155), and the description and label caps
 * answered "Description too long" and "Invalid label name" with no limit at
 * all. The app door and the agent's tool result now carry these sentences
 * beside the code, so this pins them where they are thrown, and pins that
 * nothing is written for a refused value.
 */

import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TASK_DESCRIPTION_MAX,
  TASK_LABEL_CHARS_MAX,
  TASK_TITLE_MAX,
} from '../../core/tasks/helpers.ts';
import { loadProjectOrThrow, type ProjectRow } from '../projects/service.ts';
import {
  agentCreateTaskTrusted,
  createTask,
  TaskError,
  type TaskRow,
  updateTask,
} from './service.ts';

vi.mock('../collab/service.ts', () => ({
  autoSubscribe: vi.fn(),
  notifyTaskAssigned: vi.fn(),
  notifyTaskReviewerAssigned: vi.fn(),
  notifyTaskStatusChanged: vi.fn(),
}));
vi.mock('../events/emit.ts', () => ({ emitEvent: vi.fn() }));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));
vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));
vi.mock('../files/upload-intents.ts', () => ({ firstForeignUpload: vi.fn() }));
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
  defaultTaskReviewerAgentId: null,
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

const task: TaskRow = {
  id: 't-1',
  organizationId: 'org-1',
  projectId: 'p-1',
  title: 'Existing',
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
  totalCostCents: null,
  agentRunCount: 0,
  lastAgentRunAt: null,
  claimedAt: null,
  completedAt: null,
  externalClosedAt: null,
  repeat: null,
  repeatNextTaskId: null,
  repeatContinued: false,
  createdBy: 'u-owner',
  createdByType: 'user',
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
};

const auth = {
  organizationId: 'org-1',
  userId: 'u-owner',
  role: 'owner',
  teamIds: [] as string[],
};

/** Answers the task read `updateTask` starts with and records every
 * statement, so a test can prove no write ran. */
function fakeTx(): { tx: TransactionSql; statements: string[] } {
  const statements: string[] = [];
  const tag = (
    strings: TemplateStringsArray,
    ..._values: unknown[]
  ): Promise<unknown[]> => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    statements.push(text);
    if (text.startsWith('SELECT ? FROM app.tasks WHERE id = ?')) {
      return Promise.resolve([task]);
    }
    return Promise.resolve([]);
  };
  const tx = Object.assign(tag, {
    json: (value: unknown) => ({ json: value }),
    unsafe: (text: string): unknown => text,
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a three-member stand-in for the postgres.js transaction function
  return { tx: tx as unknown as TransactionSql, statements };
}

async function refusal(run: Promise<unknown>): Promise<TaskError> {
  try {
    await run;
  } catch (error) {
    if (error instanceof TaskError) return error;
    throw error;
  }
  throw new Error('expected a TaskError');
}

const writes = (statements: string[]): string[] =>
  statements.filter((text) => /^(INSERT|UPDATE|DELETE)\b/.test(text));

const EMPTY_TITLE =
  'The task title is empty — it takes 1 to 200 UTF-16 code units.';

beforeEach(() => {
  vi.mocked(loadProjectOrThrow).mockReset().mockResolvedValue(project);
});

describe('createTask (the human create path) names the refused limit [TASK-R8]', () => {
  it.each(['', '   \n'])(
    'refuses the empty title %j as empty, naming the range',
    async (title) => {
      const { tx, statements } = fakeTx();
      const error = await refusal(
        createTask(tx, auth, { projectId: 'p-1', title }),
      );
      expect(error.code).toBe('TASK_TITLE_INVALID');
      expect(error.message).toBe(EMPTY_TITLE);
      expect(writes(statements)).toEqual([]);
    },
  );

  it('refuses an over-long title as over-long, naming the cap and its length', async () => {
    const { tx, statements } = fakeTx();
    const error = await refusal(
      createTask(tx, auth, {
        projectId: 'p-1',
        title: 't'.repeat(TASK_TITLE_MAX + 5),
      }),
    );
    expect(error.code).toBe('TASK_TITLE_INVALID');
    expect(error.message).toBe(
      'The task title is capped at 200 UTF-16 code units (most emoji count ' +
        'as 2); this one has 205.',
    );
    expect(writes(statements)).toEqual([]);
  });

  it('refuses a description over the cap, naming it', async () => {
    const { tx, statements } = fakeTx();
    const error = await refusal(
      createTask(tx, auth, {
        projectId: 'p-1',
        title: 'Fits',
        description: 'd'.repeat(TASK_DESCRIPTION_MAX + 1),
      }),
    );
    expect(error.code).toBe('TASK_DESCRIPTION_INVALID');
    expect(error.message).toContain('capped at 20,000 UTF-16 code units');
    expect(error.message).toContain('this one has 20,001');
    expect(writes(statements)).toEqual([]);
  });

  it('refuses a label name over 50 code units, naming the cap', async () => {
    const { tx, statements } = fakeTx();
    const error = await refusal(
      createTask(tx, auth, {
        projectId: 'p-1',
        title: 'Fits',
        labels: ['bug', 'l'.repeat(TASK_LABEL_CHARS_MAX + 1)],
      }),
    );
    expect(error.code).toBe('TASK_LABELS_INVALID');
    expect(error.message).toBe(
      'A label name is capped at 50 UTF-16 code units (most emoji count as ' +
        '2); this one has 51.',
    );
    // Refused before the catalog lookup, let alone a label insert.
    expect(statements).toEqual([]);
  });
});

describe('updateTask (the human edit path) names the refused limit [TASK-R8]', () => {
  it('refuses a title cleared to empty as empty', async () => {
    const { tx, statements } = fakeTx();
    const error = await refusal(
      updateTask(tx, auth, { taskId: 't-1', title: ' ' }),
    );
    expect(error.code).toBe('TASK_TITLE_INVALID');
    expect(error.message).toBe(EMPTY_TITLE);
    expect(writes(statements)).toEqual([]);
  });

  it('refuses an over-long title as over-long, naming the cap', async () => {
    const { tx, statements } = fakeTx();
    const error = await refusal(
      updateTask(tx, auth, {
        taskId: 't-1',
        title: 't'.repeat(TASK_TITLE_MAX + 1),
      }),
    );
    expect(error.code).toBe('TASK_TITLE_INVALID');
    expect(error.message).toContain('capped at 200 UTF-16 code units');
    expect(error.message).toContain('this one has 201');
    expect(writes(statements)).toEqual([]);
  });

  it('refuses a description over the cap, naming it', async () => {
    const { tx, statements } = fakeTx();
    const error = await refusal(
      updateTask(tx, auth, {
        taskId: 't-1',
        description: 'd'.repeat(TASK_DESCRIPTION_MAX + 1),
      }),
    );
    expect(error.code).toBe('TASK_DESCRIPTION_INVALID');
    expect(error.message).toContain('capped at 20,000 UTF-16 code units');
    expect(writes(statements)).toEqual([]);
  });
});

describe('agentCreateTaskTrusted (the task_create lower half) names the refused limit [TASK-R8]', () => {
  const agentArgs = {
    organizationId: 'org-1',
    actorId: 'agent-7',
    projectId: 'p-1',
    title: 'Filed by an agent',
  };

  it('refuses a description over the cap, naming it', async () => {
    const { tx, statements } = fakeTx();
    const error = await refusal(
      agentCreateTaskTrusted(tx, {
        ...agentArgs,
        description: 'd'.repeat(TASK_DESCRIPTION_MAX + 1),
      }),
    );
    expect(error.code).toBe('TASK_DESCRIPTION_INVALID');
    expect(error.message).toContain('capped at 20,000 UTF-16 code units');
    expect(writes(statements)).toEqual([]);
  });

  it('refuses a label name over 50 code units before minting any label', async () => {
    const { tx, statements } = fakeTx();
    const error = await refusal(
      agentCreateTaskTrusted(tx, {
        ...agentArgs,
        labels: ['l'.repeat(TASK_LABEL_CHARS_MAX + 1)],
      }),
    );
    expect(error.code).toBe('TASK_LABELS_INVALID');
    expect(error.message).toContain('capped at 50 UTF-16 code units');
    expect(writes(statements)).toEqual([]);
  });
});
