import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addJobInTx } from '../../jobs/enqueue.ts';
import { firstForeignUpload } from '../files/upload-intents.ts';
import { loadProjectOrThrow, type ProjectRow } from '../projects/service.ts';
import {
  createTask,
  parseTaskAttachments,
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

/**
 * The create and edit dialogs send `attachments` (drag, paste, the remove
 * button); the routes stripped the key and nothing ever wrote the column, so
 * an upload "succeeded" and was gone on the next read. This pins the write
 * path: the column is written on create and full-replaced on update, every
 * ref NEW to the task must be the caller's own upload, and a ref the list
 * drops goes to the blob release seam once no task names it.
 */

function fakeTx(
  fixture: TaskRow,
  extra: (text: string, values: unknown[]) => unknown[] | undefined = () =>
    undefined,
): { tx: TransactionSql; statements: { text: string; values: unknown[] }[] } {
  const statements: { text: string; values: unknown[] }[] = [];
  const tag = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    statements.push({ text, values });
    const scripted = extra(text, values);
    if (scripted !== undefined) return Promise.resolve(scripted);
    if (text.startsWith('SELECT ? FROM app.tasks WHERE id = ?')) {
      return Promise.resolve([fixture]);
    }
    if (text.startsWith('UPDATE app.projects SET task_counter')) {
      return Promise.resolve([{ taskCounter: 3 }]);
    }
    if (text.startsWith('INSERT INTO app.tasks')) {
      return Promise.resolve([{ id: 't-1' }]);
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

const brief = {
  fileId: 's3:org-1/brief.pdf',
  fileName: 'brief.pdf',
  fileType: 'application/pdf',
  fileSize: 1200,
};
const theirs = {
  fileId: 's3:org-1/theirs.png',
  fileName: 'theirs.png',
  fileType: 'image/png',
  fileSize: 300,
};
const fresh = {
  fileId: 's3:org-1/fresh.csv',
  fileName: 'fresh.csv',
  fileType: 'text/csv',
  fileSize: 90,
};

function taskRow(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 't-1',
    organizationId: 'org-1',
    projectId: 'p-1',
    title: 'With files',
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

beforeEach(() => {
  vi.mocked(loadProjectOrThrow).mockReset().mockResolvedValue(project);
  vi.mocked(firstForeignUpload).mockReset().mockResolvedValue(null);
  vi.mocked(addJobInTx).mockReset();
});

describe('createTask — attachments', () => {
  it('writes the dialog’s attachments into the row after proving the caller uploaded them', async () => {
    const { tx, statements } = fakeTx(taskRow());
    await createTask(tx, auth, {
      projectId: 'p-1',
      title: 'With files',
      attachments: [brief, { ...brief, fileName: 'dup.pdf' }],
    });
    expect(firstForeignUpload).toHaveBeenCalledWith(
      tx,
      { organizationId: 'org-1', userId: 'u-owner' },
      [brief.fileId],
    );
    const insert = statements.find((statement) =>
      statement.text.startsWith('INSERT INTO app.tasks'),
    );
    expect(insert?.text).toContain('description, attachments, status');
    // De-duplicated by ref, first wins.
    expect(insert?.values).toContainEqual({ json: [brief] });
  });

  it('refuses a ref that is not the caller’s upload before anything is written', async () => {
    vi.mocked(firstForeignUpload).mockResolvedValue(theirs.fileId);
    const { tx, statements } = fakeTx(taskRow());
    await expect(
      createTask(tx, auth, {
        projectId: 'p-1',
        title: 'Stolen',
        attachments: [theirs],
      }),
    ).rejects.toMatchObject({ code: 'TASK_ATTACHMENT_NOT_OWNED', status: 403 });
    expect(
      statements.some((statement) => statement.text.startsWith('INSERT')),
    ).toBe(false);
  });

  it('stores NULL, not an empty list, when the dialog sent no files', async () => {
    const { tx, statements } = fakeTx(taskRow());
    await createTask(tx, auth, { projectId: 'p-1', title: 'Bare' });
    const insert = statements.find((statement) =>
      statement.text.startsWith('INSERT INTO app.tasks'),
    );
    expect(
      insert?.values.some(
        (value) =>
          typeof value === 'object' && value !== null && 'json' in value,
      ),
    ).toBe(false);
    expect(firstForeignUpload).not.toHaveBeenCalled();
  });
});

describe('updateTask — attachments are a full replace', () => {
  it('proves only the refs NEW to the task, replaces the column, and releases the dropped ref', async () => {
    const { tx, statements } = fakeTx(
      taskRow({ attachments: [theirs, brief] }),
      (text) =>
        text.startsWith('SELECT r.ref FROM unnest')
          ? [{ ref: brief.fileId }]
          : undefined,
    );
    // Someone else attached `theirs`; the owner removes `brief` and adds
    // `fresh` in one full-replace send.
    await updateTask(tx, auth, {
      taskId: 't-1',
      attachments: [theirs, fresh],
    });

    expect(firstForeignUpload).toHaveBeenCalledWith(
      tx,
      { organizationId: 'org-1', userId: 'u-owner' },
      [fresh.fileId],
    );
    const update = statements.find((statement) =>
      statement.text.startsWith('UPDATE app.tasks SET title'),
    );
    expect(update?.text).toContain('attachments = CASE WHEN ?::boolean');
    expect(update?.values).toContain(true);
    expect(update?.values).toContainEqual({ json: [theirs, fresh] });
    // The dropped ref is checked for other holders AFTER the row changed…
    const releaseAt = statements.findIndex((statement) =>
      statement.text.startsWith('SELECT r.ref FROM unnest'),
    );
    expect(releaseAt).toBeGreaterThan(statements.indexOf(update!));
    expect(statements[releaseAt]?.values[0]).toEqual([brief.fileId]);
    // …its unbound file row is trashed and the durable release enqueued.
    expect(
      statements.some((statement) =>
        statement.text.startsWith(
          'UPDATE app.file_metadata SET lifecycle_status',
        ),
      ),
    ).toBe(true);
    expect(addJobInTx).toHaveBeenCalledWith(tx, 'knowledge.release_refs', {
      organizationId: 'org-1',
      refs: [brief.fileId],
    });
  });

  it('keeps a ref another user attached when the list merely re-sends it', async () => {
    const { tx, statements } = fakeTx(taskRow({ attachments: [theirs] }));
    await updateTask(tx, auth, { taskId: 't-1', attachments: [theirs] });
    // Nothing new to prove, nothing changed, nothing released.
    expect(firstForeignUpload).not.toHaveBeenCalled();
    expect(
      statements.some((statement) =>
        statement.text.startsWith('UPDATE app.tasks'),
      ),
    ).toBe(false);
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('refuses a foreign ref and writes nothing', async () => {
    vi.mocked(firstForeignUpload).mockResolvedValue(theirs.fileId);
    const { tx, statements } = fakeTx(taskRow({ attachments: [brief] }));
    await expect(
      updateTask(tx, auth, { taskId: 't-1', attachments: [brief, theirs] }),
    ).rejects.toMatchObject({ code: 'TASK_ATTACHMENT_NOT_OWNED' });
    expect(
      statements.some((statement) => statement.text.startsWith('UPDATE')),
    ).toBe(false);
  });

  it("removing the last file stores NULL (createTask's empty spelling) and releases the ref", async () => {
    const { tx, statements } = fakeTx(
      taskRow({ attachments: [brief] }),
      (text) =>
        text.startsWith('SELECT r.ref FROM unnest')
          ? [{ ref: brief.fileId }]
          : undefined,
    );
    await updateTask(tx, auth, { taskId: 't-1', attachments: [] });
    const update = statements.find((statement) =>
      statement.text.startsWith('UPDATE app.tasks SET title'),
    );
    expect(update?.values).not.toContainEqual({ json: [] });
    expect(update?.values).toContain(null);
    expect(addJobInTx).toHaveBeenCalledTimes(1);
  });
});

describe('parseTaskAttachments', () => {
  it('reads the stored list and skips malformed elements', () => {
    expect(
      parseTaskAttachments([
        brief,
        null,
        'junk',
        { fileName: 'no-ref' },
        { fileId: 's3:x' },
      ]),
    ).toEqual([
      brief,
      { fileId: 's3:x', fileName: '', fileType: '', fileSize: 0 },
    ]);
    expect(parseTaskAttachments(null)).toEqual([]);
  });
});
