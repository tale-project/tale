import type { Sql, TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAuditLog } from '../audit_logs/service.ts';
import { loadProjectOrThrow, type ProjectRow } from '../projects/service.ts';
import {
  addTaskDependency,
  getTask,
  removeTaskDependency,
  type TaskRow,
} from './service.ts';

vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));
vi.mock('../projects/service.ts', () => ({
  listProjects: vi.fn(),
  loadProjectOrThrow: vi.fn(),
}));

/**
 * An archived task's dependencies stay as they were archived (#3589). The
 * board offers no archived task to link and no link on an archived one, but
 * the dependency doors judged only the work gate, so a stale client still
 * added and removed edges on an archived task and wrote its activity line.
 *
 * The edge is the BLOCKED task's record: its activity line and its Blocked
 * chip. Adding refuses when either end is archived: an archived blocker can
 * no longer move, so a new edge from it would block for good. Removing
 * refuses when the blocked task is archived, and still drops an archived
 * blocker from an active task, which is the only way to free it.
 */

const editor = {
  organizationId: 'org-1',
  userId: 'u-editor',
  role: 'editor',
  teamIds: [] as string[],
};

const project: ProjectRow = {
  id: 'p-1',
  organizationId: 'org-1',
  name: 'Contracts',
  description: null,
  icon: null,
  color: null,
  key: 'CON',
  externalItemId: null,
  taskCounter: 3,
  openTaskCount: 3,
  doneTaskCount: 0,
  projectAgentCount: 0,
  defaultTaskReviewerAgentId: null,
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

function taskRow(overrides: Partial<TaskRow>): TaskRow {
  return {
    id: 't-active',
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
    createdBy: 'u-editor',
    createdByType: 'user',
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
    ...overrides,
  };
}

const ACTIVE = taskRow({ id: 't-active' });
const OTHER = taskRow({ id: 't-other', number: 2 });
const ARCHIVED = taskRow({ id: 't-archived', number: 3, archivedAt: 5 });

/** Every statement the fake answered, so a refusal can be shown to have
 * written nothing. */
let statements: string[] = [];

function fakeTx(tasks: readonly TaskRow[]): TransactionSql {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const tag = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown> => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    statements.push(text);
    if (text.startsWith('SELECT ? FROM app.tasks WHERE id = ?')) {
      const task = values
        .map((value) => (typeof value === 'string' ? byId.get(value) : null))
        .find((row) => row != null);
      return Promise.resolve(task ? [task] : []);
    }
    if (text.startsWith('INSERT INTO app.task_dependencies')) {
      return Promise.resolve(Object.assign([], { count: 1 }));
    }
    if (text.startsWith('DELETE FROM app.task_dependencies')) {
      return Promise.resolve(Object.assign([], { count: 1 }));
    }
    return Promise.resolve([]);
  };
  const tx = Object.assign(tag, {
    json: (value: unknown) => ({ json: value }),
    unsafe: (text: string): unknown => text,
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- three-member stand-in for the postgres.js transaction function
  return tx as unknown as TransactionSql;
}

/** The same stand-in as a plain read connection. */
function fakeSql(tasks: readonly TaskRow[]): Sql {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the reads use the same tag the transaction stand-in answers
  return fakeTx(tasks) as unknown as Sql;
}

const wrote = (prefix: string): boolean =>
  statements.some((text) => text.startsWith(prefix));

beforeEach(() => {
  statements = [];
  vi.mocked(createAuditLog).mockReset();
  vi.mocked(loadProjectOrThrow).mockReset().mockResolvedValue(project);
});

describe('adding a dependency', () => {
  it('refuses an archived blocked task with TASK_ARCHIVED, writing nothing', async () => {
    await expect(
      addTaskDependency(fakeTx([ACTIVE, ARCHIVED]), editor, {
        blockerTaskId: 't-active',
        blockedTaskId: 't-archived',
      }),
    ).rejects.toMatchObject({ code: 'TASK_ARCHIVED' });
    expect(wrote('INSERT INTO app.task_dependencies')).toBe(false);
    expect(wrote('INSERT INTO app.task_activity')).toBe(false);
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('refuses an archived blocker with TASK_ARCHIVED, writing nothing', async () => {
    await expect(
      addTaskDependency(fakeTx([ACTIVE, ARCHIVED]), editor, {
        blockerTaskId: 't-archived',
        blockedTaskId: 't-active',
      }),
    ).rejects.toMatchObject({ code: 'TASK_ARCHIVED' });
    expect(wrote('INSERT INTO app.task_dependencies')).toBe(false);
    expect(wrote('INSERT INTO app.task_activity')).toBe(false);
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('links two active tasks as before', async () => {
    await addTaskDependency(fakeTx([ACTIVE, OTHER]), editor, {
      blockerTaskId: 't-other',
      blockedTaskId: 't-active',
    });
    expect(wrote('INSERT INTO app.task_dependencies')).toBe(true);
    expect(wrote('INSERT INTO app.task_activity')).toBe(true);
  });
});

describe('removing a dependency', () => {
  it('refuses an archived blocked task with TASK_ARCHIVED, writing nothing', async () => {
    await expect(
      removeTaskDependency(fakeTx([ACTIVE, ARCHIVED]), editor, {
        blockerTaskId: 't-active',
        blockedTaskId: 't-archived',
      }),
    ).rejects.toMatchObject({ code: 'TASK_ARCHIVED' });
    expect(wrote('DELETE FROM app.task_dependencies')).toBe(false);
    expect(wrote('INSERT INTO app.task_activity')).toBe(false);
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('still drops an archived blocker from an active task', async () => {
    await removeTaskDependency(fakeTx([ACTIVE, ARCHIVED]), editor, {
      blockerTaskId: 't-archived',
      blockedTaskId: 't-active',
    });
    expect(wrote('DELETE FROM app.task_dependencies')).toBe(true);
    expect(wrote('INSERT INTO app.task_activity')).toBe(true);
  });

  it('unlinks two active tasks as before', async () => {
    await removeTaskDependency(fakeTx([ACTIVE, OTHER]), editor, {
      blockerTaskId: 't-other',
      blockedTaskId: 't-active',
    });
    expect(wrote('DELETE FROM app.task_dependencies')).toBe(true);
  });
});

describe('the task read', () => {
  it('offers comments on an active task in an active project only', async () => {
    const read = async (task: TaskRow) =>
      (await getTask(fakeSql([task]), editor, task.id)).canComment;
    expect(await read(ACTIVE)).toBe(true);
    // The composer and the comment actions follow this flag: an archived
    // task, like a task of an archived project, refuses every comment write.
    expect(await read(ARCHIVED)).toBe(false);
    vi.mocked(loadProjectOrThrow).mockResolvedValue({
      ...project,
      archivedAt: 7,
    });
    expect(await read(ACTIVE)).toBe(false);
  });
});
