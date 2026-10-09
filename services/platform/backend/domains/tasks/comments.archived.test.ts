// @vitest-environment node

/**
 * An archived project is read-only, its task discussions included. The REST
 * comment door refused with `PROJECT_ARCHIVED` while the app door (and the
 * ask-answer mirrors) went straight through `addTaskComment`, which gated
 * on readability alone — so a comment could still land on an archived
 * project's task from the app.
 *
 * An archived TASK is read-only the same way (#3589): the REST door refused a
 * comment with `TASK_ARCHIVED`, while the app's create, edit and delete went
 * through and changed the archived task's discussion for a stale client.
 */

import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loadProjectOrThrow, loadTaskOrThrow } = vi.hoisted(() => ({
  loadProjectOrThrow: vi.fn(),
  loadTaskOrThrow: vi.fn(),
}));

vi.mock('../projects/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../projects/service.ts')>()),
  loadProjectOrThrow,
}));
vi.mock('./service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./service.ts')>()),
  loadTaskOrThrow,
  dispatchMentionedProjectAgent: vi.fn(),
}));
vi.mock('../collab/mention-directory.ts', () => ({
  prepareSurfaceText: vi.fn(async (_sql: unknown, args: { body: string }) => ({
    text: args.body,
    mentions: [],
    added: [],
    unresolvedMentionTokens: [],
    invalidTokens: [],
  })),
}));
vi.mock('../collab/service.ts', () => ({ notifyTaskComment: vi.fn() }));
vi.mock('../events/emit.ts', () => ({ emitEvent: vi.fn() }));
vi.mock('../audit_logs/service.ts', () => ({
  createAuditLog: vi.fn(),
  auditChainQueueKey: (id: string) => `audit-chain:${id}`,
}));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));
vi.mock('../threads/store.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../threads/store.ts')>()),
  createThread: vi.fn().mockResolvedValue('thread-1'),
  saveMessage: vi.fn().mockResolvedValue({ messageId: 'm-new', order: 1 }),
  updateMessageText: vi.fn(),
  deleteMessage: vi.fn(),
}));

import { createAuditLog } from '../audit_logs/service.ts';
import { notifyTaskComment } from '../collab/service.ts';
import {
  deleteMessage,
  saveMessage,
  updateMessageText,
} from '../threads/store.ts';
import {
  addTaskComment,
  deleteTaskComment,
  editTaskComment,
} from './comments.ts';

/** A transaction that records every statement; a comment's meta row (written
 * by `metaAuthorId`) is its one answer. */
function fakeTx(metaAuthorId = 'user-1'): {
  tx: TransactionSql;
  statements: string[];
} {
  const statements: string[] = [];
  const tag = (strings: TemplateStringsArray) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push(text);
    return Promise.resolve(
      text.startsWith('SELECT task_id')
        ? [
            {
              taskId: 'task-1',
              authorType: 'user',
              authorId: metaAuthorId,
              mentions: [],
            },
          ]
        : [],
    );
  };
  const tx = Object.assign(tag, { json: (value: unknown) => value });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a two-member stand-in for the postgres.js transaction function
  return { tx: tx as unknown as TransactionSql, statements };
}

/** What a refused write may have run: its reads and the queue lock. */
const writesIn = (statements: string[]): string[] =>
  statements.filter(
    (s) =>
      !s.startsWith('SELECT pg_advisory') && !s.startsWith('SELECT task_id'),
  );

const auth = {
  organizationId: 'org_1',
  userId: 'user-1',
  role: 'admin',
  teamIds: [] as string[],
};

const project = {
  id: 'proj-1',
  organizationId: 'org_1',
  teamId: null,
  sharedWithTeamIds: [] as string[],
  archivedAt: null as number | null,
};

const task = {
  id: 'task-1',
  organizationId: 'org_1',
  projectId: 'proj-1',
  title: 'Check figures',
  createdBy: 'user-2',
  createdByType: 'user',
  assigneeType: null,
  assigneeId: null,
  parentTaskId: null,
  discussionThreadId: 'thread-1',
  archivedAt: null as number | null,
};

beforeEach(() => {
  vi.clearAllMocks();
  loadTaskOrThrow.mockResolvedValue(task);
  loadProjectOrThrow.mockResolvedValue(project);
});

describe('addTaskComment on an archived project', () => {
  it('refuses with 403 PROJECT_ARCHIVED after the reads, writing nothing [TASK-R7]', async () => {
    loadProjectOrThrow.mockResolvedValue({
      ...project,
      archivedAt: 1_700_000_000_000,
    });
    const { tx, statements } = fakeTx();
    await expect(
      addTaskComment(tx, auth, { taskId: 'task-1', body: 'hello' }),
    ).rejects.toMatchObject({ code: 'PROJECT_ARCHIVED', status: 403 });
    // The queue lock is the only statement: no thread, message or meta row.
    expect(
      statements.filter((s) => !s.startsWith('SELECT pg_advisory')),
    ).toEqual([]);
  });
});

describe('the discussion of an archived task', () => {
  beforeEach(() => {
    loadTaskOrThrow.mockResolvedValue({
      ...task,
      archivedAt: 1_700_000_000_000,
    });
  });

  it("refuses a person's comment with TASK_ARCHIVED, writing nothing [TASK-R5]", async () => {
    const { tx, statements } = fakeTx();
    await expect(
      addTaskComment(tx, auth, { taskId: 'task-1', body: 'hello' }),
    ).rejects.toMatchObject({ code: 'TASK_ARCHIVED' });
    // No thread, message, meta row, count, activity line or audit row.
    expect(writesIn(statements)).toEqual([]);
    expect(saveMessage).not.toHaveBeenCalled();
    expect(notifyTaskComment).not.toHaveBeenCalled();
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('refuses its author an edit or a delete, changing nothing', async () => {
    const edit = fakeTx('user-1');
    await expect(
      editTaskComment(edit.tx, auth, { messageId: 'm-1', body: 'Late fix.' }),
    ).rejects.toMatchObject({ code: 'TASK_ARCHIVED' });
    const removal = fakeTx('user-1');
    await expect(
      deleteTaskComment(removal.tx, auth, 'm-1'),
    ).rejects.toMatchObject({ code: 'TASK_ARCHIVED' });
    expect(writesIn(edit.statements)).toEqual([]);
    expect(writesIn(removal.statements)).toEqual([]);
    expect(updateMessageText).not.toHaveBeenCalled();
    expect(deleteMessage).not.toHaveBeenCalled();
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it("refuses an admin's moderation of someone else's comment", async () => {
    const edit = fakeTx('user-2');
    await expect(
      editTaskComment(edit.tx, auth, { messageId: 'm-1', body: 'Moderated.' }),
    ).rejects.toMatchObject({ code: 'TASK_ARCHIVED' });
    const removal = fakeTx('user-2');
    await expect(
      deleteTaskComment(removal.tx, auth, 'm-1'),
    ).rejects.toMatchObject({ code: 'TASK_ARCHIVED' });
    expect(writesIn(edit.statements)).toEqual([]);
    expect(writesIn(removal.statements)).toEqual([]);
    expect(updateMessageText).not.toHaveBeenCalled();
    expect(deleteMessage).not.toHaveBeenCalled();
  });

  it('still takes the report of a run working the task: the gate is a person’s [TASK-R6]', async () => {
    // A live run is not cancelled by the archive, and its settle posts its
    // report beside the status park, which ignores the archive as well.
    const { tx } = fakeTx();
    await expect(
      addTaskComment(tx, auth, {
        taskId: 'task-1',
        body: 'Done: the figures add up.',
        author: { actorType: 'agent', actorId: 'agent-1' },
      }),
    ).resolves.toMatchObject({ messageId: 'm-new' });
  });
});

describe('the discussion of an active task', () => {
  it('takes, edits and deletes a comment as before', async () => {
    await expect(
      addTaskComment(fakeTx().tx, auth, { taskId: 'task-1', body: 'hello' }),
    ).resolves.toMatchObject({ messageId: 'm-new' });
    await editTaskComment(fakeTx('user-1').tx, auth, {
      messageId: 'm-1',
      body: 'Corrected.',
    });
    await deleteTaskComment(fakeTx('user-2').tx, auth, 'm-1');
    expect(saveMessage).toHaveBeenCalledOnce();
    expect(updateMessageText).toHaveBeenCalledWith(
      expect.anything(),
      'm-1',
      'Corrected.',
    );
    expect(deleteMessage).toHaveBeenCalledWith(expect.anything(), 'm-1');
  });
});
