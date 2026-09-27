// @vitest-environment node

/**
 * A comment body is refused with a sentence naming its limit. Both the post
 * and the edit threw one "Invalid comment body" for an empty body and an
 * over-long one, and the agent's `task_comment` relayed exactly that.
 */

import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TASK_COMMENT_MAX } from '../../core/tasks/helpers.ts';

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
}));

import { addTaskComment, editTaskComment } from './comments.ts';

/** Answers the comment-meta read an edit starts with; every other statement
 * is recorded and answers nothing. */
function fakeTx(): { tx: TransactionSql; statements: string[] } {
  const statements: string[] = [];
  const tag = (strings: TemplateStringsArray) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push(text);
    if (text.includes('FROM app.task_discussion_message_meta WHERE')) {
      return Promise.resolve([
        {
          taskId: 'task-1',
          authorType: 'user',
          authorId: 'user-1',
          mentions: null,
        },
      ]);
    }
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the tag call is exercised
  return { tx: tag as unknown as TransactionSql, statements };
}

const auth = {
  organizationId: 'org_1',
  userId: 'user-1',
  role: 'admin',
  teamIds: [] as string[],
};

const writes = (statements: string[]): string[] =>
  statements.filter((text) => /^(INSERT|UPDATE|DELETE)\b/.test(text));

beforeEach(() => {
  vi.clearAllMocks();
  loadTaskOrThrow.mockResolvedValue({
    id: 'task-1',
    organizationId: 'org_1',
    projectId: 'proj-1',
    archivedAt: null,
  });
  loadProjectOrThrow.mockResolvedValue({
    id: 'proj-1',
    organizationId: 'org_1',
    teamId: null,
    sharedWithTeamIds: [] as string[],
    archivedAt: null,
  });
});

describe('a comment body names its limit when refused', () => {
  it('tells an empty comment from an over-long one on the post', async () => {
    const empty = fakeTx();
    await expect(
      addTaskComment(empty.tx, auth, { taskId: 'task-1', body: '  \n ' }),
    ).rejects.toMatchObject({
      code: 'TASK_COMMENT_INVALID',
      message: 'The comment is empty — it takes 1 to 10,000 UTF-16 code units.',
    });
    expect(writes(empty.statements)).toEqual([]);

    const long = fakeTx();
    await expect(
      addTaskComment(long.tx, auth, {
        taskId: 'task-1',
        body: 'c'.repeat(TASK_COMMENT_MAX + 1),
      }),
    ).rejects.toMatchObject({
      code: 'TASK_COMMENT_INVALID',
      message:
        'The comment is capped at 10,000 UTF-16 code units (most emoji ' +
        'count as 2); this one has 10,001.',
    });
    expect(writes(long.statements)).toEqual([]);
  });

  it('refuses an over-long edit the same way, rewriting nothing', async () => {
    const { tx, statements } = fakeTx();
    await expect(
      editTaskComment(tx, auth, {
        messageId: 'msg-1',
        body: 'c'.repeat(TASK_COMMENT_MAX + 1),
      }),
    ).rejects.toMatchObject({
      code: 'TASK_COMMENT_INVALID',
      message: expect.stringContaining(
        'capped at 10,000 UTF-16 code units',
      ) as unknown,
    });
    expect(writes(statements)).toEqual([]);
  });
});
