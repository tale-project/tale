import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getProjectAuthContext } from '../projects/service.ts';
import { addTaskComment } from '../tasks/comments.ts';
import { pgTaskStore } from './task-store.ts';

vi.mock('../projects/service.ts', () => ({ getProjectAuthContext: vi.fn() }));
vi.mock('../tasks/comments.ts', () => ({
  addTaskComment: vi.fn(),
  listTaskComments: vi.fn(),
  TASK_COMMENT_PAGE_MAX: 200,
}));

beforeEach(() => {
  vi.mocked(getProjectAuthContext).mockReset();
  vi.mocked(addTaskComment).mockReset();
});

/**
 * `task.get` answers `null` for exactly one thing — the task does not exist
 * in the org. Regression: the store wrapped the load in `catch { return
 * null }`, so a lost connection or an exhausted pool read as "task not
 * found" and a workflow acted on a phantom miss.
 */

/** A `Sql` stand-in for the one read `get` performs: the tagged-template
 * call answers `rows`, or rejects with `failure`. */
function sqlStub(outcome: { rows?: unknown[]; failure?: Error }): Sql {
  const call = (): Promise<unknown[]> =>
    outcome.failure
      ? Promise.reject(outcome.failure)
      : Promise.resolve(outcome.rows ?? []);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the store touches only the tagged call and `unsafe` on this path
  return Object.assign(call, {
    unsafe: (text: string) => text,
  }) as unknown as Sql;
}

describe('pgTaskStore.get', () => {
  it('answers null when the org holds no such task', async () => {
    const store = pgTaskStore(sqlStub({ rows: [] }));
    await expect(
      store.get({ organizationId: 'org-1', taskId: 'missing' }),
    ).resolves.toBeNull();
  });

  it('answers the task view when the row exists', async () => {
    const store = pgTaskStore(
      sqlStub({
        rows: [
          {
            id: 'task-1',
            title: 'Ship it',
            status: 'todo',
            description: null,
            projectId: 'project-1',
          },
        ],
      }),
    );
    await expect(
      store.get({ organizationId: 'org-1', taskId: 'task-1' }),
    ).resolves.toEqual({
      taskId: 'task-1',
      title: 'Ship it',
      status: 'todo',
      projectId: 'project-1',
    });
  });

  it('propagates a database failure instead of calling it "not found"', async () => {
    const failure = Object.assign(new Error('connection terminated'), {
      code: '57P01',
    });
    const store = pgTaskStore(sqlStub({ failure }));
    await expect(
      store.get({ organizationId: 'org-1', taskId: 'task-1' }),
    ).rejects.toBe(failure);
  });
});

describe('pgTaskStore.comment', () => {
  /** The `task.comment` native validates `bodyByLocale` (one narrator per
   * language) and the reader picks their locale from it; the store used to
   * drop it on the floor, so every localized workflow comment rendered
   * English-only. */
  it('forwards the by-locale bodies to the comment writer', async () => {
    const auth = {
      organizationId: 'org-1',
      userId: 'system',
      role: 'owner' as const,
      teamIds: [],
    };
    vi.mocked(getProjectAuthContext).mockResolvedValue(auth);
    vi.mocked(addTaskComment).mockResolvedValue({
      messageId: 'm-1',
      threadId: 'th-1',
      unresolvedMentionTokens: [],
    });
    const tx = sqlStub({ rows: [] });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `begin` runs the callback on the same stand-in
    const sql = Object.assign(tx, {
      begin: (callback: (tx: Sql) => unknown) => callback(tx),
    }) as unknown as Sql;
    const store = pgTaskStore(sql);

    await expect(
      store.comment({
        organizationId: 'org-1',
        taskId: 'task-1',
        body: 'Done.',
        bodyByLocale: { en: 'Done.', de: 'Erledigt.', fr: 'Terminé.' },
      }),
    ).resolves.toEqual({ messageId: 'm-1' });

    expect(addTaskComment).toHaveBeenCalledWith(tx, auth, {
      taskId: 'task-1',
      body: 'Done.',
      bodyByLocale: { en: 'Done.', de: 'Erledigt.', fr: 'Terminé.' },
      author: { actorType: 'agent', actorId: 'workflow' },
    });
  });

  it('leaves bodyByLocale out when the native sent none', async () => {
    vi.mocked(getProjectAuthContext).mockResolvedValue({
      organizationId: 'org-1',
      userId: 'system',
      role: 'owner',
      teamIds: [],
    });
    vi.mocked(addTaskComment).mockResolvedValue({
      messageId: 'm-2',
      threadId: 'th-1',
      unresolvedMentionTokens: [],
    });
    const tx = sqlStub({ rows: [] });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `begin` runs the callback on the same stand-in
    const sql = Object.assign(tx, {
      begin: (callback: (tx: Sql) => unknown) => callback(tx),
    }) as unknown as Sql;
    await pgTaskStore(sql).comment({
      organizationId: 'org-1',
      taskId: 'task-1',
      body: 'Done.',
    });
    const [, , args] = vi.mocked(addTaskComment).mock.calls[0] ?? [];
    expect(args).not.toHaveProperty('bodyByLocale');
  });
});
