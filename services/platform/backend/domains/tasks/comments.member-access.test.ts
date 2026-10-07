import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deleteMessage, updateMessageText } from '../threads/store.ts';
import { deleteTaskComment, editTaskComment } from './comments.ts';

/**
 * Who may change a comment: its author, with the read access posting it
 * took — a member fixes or removes their own comment on someone else's task,
 * where they may not change anything else — and an admin moderating
 * someone else's words. Another member's comment stays as its author left
 * it, and an archived project is read-only for everyone.
 */

const project = vi.hoisted(() => ({
  id: 'p-1',
  organizationId: 'org-1',
  teamId: null,
  sharedWithTeamIds: [] as string[],
  archivedAt: null as number | null,
}));

vi.mock('../collab/mention-directory.ts', () => ({
  resolveSurfaceMentions: vi.fn().mockResolvedValue({ mentions: [] }),
}));
vi.mock('../collab/service.ts', () => ({ notifyTaskComment: vi.fn() }));
vi.mock('../events/emit.ts', () => ({ emitEvent: vi.fn() }));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));
vi.mock('../projects/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../projects/service.ts')>()),
  loadProjectOrThrow: vi.fn(async () => project),
}));
vi.mock('./service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./service.ts')>()),
  // Someone else's task: an editor created it and nobody is assigned.
  loadTaskOrThrow: vi.fn().mockResolvedValue({
    id: 't-1',
    organizationId: 'org-1',
    projectId: 'p-1',
    title: 'Check figures',
    createdBy: 'u-editor',
    createdByType: 'user',
    assigneeType: null,
    assigneeId: null,
    parentTaskId: null,
    archivedAt: null,
  }),
}));
vi.mock('../threads/store.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../threads/store.ts')>()),
  updateMessageText: vi.fn(),
  deleteMessage: vi.fn(),
}));

/** A transaction whose comment row was written by `authorId`. */
function commentTx(authorId: string): TransactionSql {
  const tag = (strings: TemplateStringsArray) => {
    const text = strings.join('?').replace(/\s+/g, ' ');
    return Promise.resolve(
      text.includes('SELECT task_id')
        ? [{ taskId: 't-1', authorType: 'user', authorId, mentions: [] }]
        : [],
    );
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a one-member stand-in for the postgres.js transaction function
  return tag as unknown as TransactionSql;
}

const member = {
  organizationId: 'org-1',
  userId: 'u-member',
  role: 'member',
  teamIds: [] as string[],
};

beforeEach(() => {
  vi.mocked(updateMessageText).mockClear();
  vi.mocked(deleteMessage).mockClear();
  project.archivedAt = null;
});

describe("a member's own comment on someone else's task", () => {
  it('is theirs to edit', async () => {
    await editTaskComment(commentTx('u-member'), member, {
      messageId: 'm-1',
      body: 'Corrected: the Q3 figures.',
    });
    expect(updateMessageText).toHaveBeenCalledWith(
      expect.anything(),
      'm-1',
      'Corrected: the Q3 figures.',
    );
  });

  it('is theirs to delete', async () => {
    await deleteTaskComment(commentTx('u-member'), member, 'm-1');
    expect(deleteMessage).toHaveBeenCalledWith(expect.anything(), 'm-1');
  });

  it('stays as it is in an archived project', async () => {
    project.archivedAt = 5;
    await expect(
      editTaskComment(commentTx('u-member'), member, {
        messageId: 'm-1',
        body: 'Late fix.',
      }),
    ).rejects.toMatchObject({ code: 'PROJECT_ARCHIVED' });
    expect(updateMessageText).not.toHaveBeenCalled();
  });
});

describe("someone else's comment", () => {
  it('stays as its author left it for a member', async () => {
    await expect(
      editTaskComment(commentTx('u-editor'), member, {
        messageId: 'm-1',
        body: 'Rewritten.',
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      deleteTaskComment(commentTx('u-editor'), member, 'm-1'),
    ).rejects.toMatchObject({ status: 403 });
    expect(updateMessageText).not.toHaveBeenCalled();
    expect(deleteMessage).not.toHaveBeenCalled();
  });

  it('can be removed by an admin', async () => {
    await deleteTaskComment(
      commentTx('u-editor'),
      { ...member, userId: 'u-admin', role: 'admin' },
      'm-1',
    );
    expect(deleteMessage).toHaveBeenCalledWith(expect.anything(), 'm-1');
  });
});
