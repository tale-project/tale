import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadOwnedThread, loadProjectSharedThread } from '../chat/threads.ts';
import { getLatestAgentRunCardForTask } from './agent-runs.ts';
import {
  assertTaskSourceThreadReadable,
  listTasksFromThread,
} from './source-thread.ts';

vi.mock('../chat/threads.ts', () => ({
  loadOwnedThread: vi.fn(),
  loadProjectSharedThread: vi.fn(),
}));
vi.mock('./agent-runs.ts', () => ({
  getLatestAgentRunCardForTask: vi.fn(),
}));

type Row = Record<string, unknown>;

function fakeSql(rows: Row[]): {
  sql: Sql;
  statements: { text: string; values: unknown[] }[];
} {
  const statements: { text: string; values: unknown[] }[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    statements.push({
      text: strings.join('?').replaceAll(/\s+/g, ' ').trim(),
      values,
    });
    return Promise.resolve(rows);
  };
  const sql = Object.assign(tag, { unsafe: (text: string) => text });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a two-member stand-in for the postgres.js template function
  return { sql: sql as unknown as Sql, statements };
}

const THREAD = { id: 'thread-1' };
const AUTH = {
  organizationId: 'org-1',
  userId: 'u-1',
  role: 'member',
  teamIds: ['team-a'],
};

beforeEach(() => {
  vi.mocked(loadOwnedThread).mockReset().mockResolvedValue(null);
  vi.mocked(loadProjectSharedThread).mockReset().mockResolvedValue(null);
  vi.mocked(getLatestAgentRunCardForTask).mockReset().mockResolvedValue(null);
});

describe('assertTaskSourceThreadReadable', () => {
  const args = { organizationId: 'org-1', userId: 'u-1', threadId: 'thread-1' };

  it('admits the person’s own conversation', async () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the thread row's shape is not what this test pins
    vi.mocked(loadOwnedThread).mockResolvedValue(THREAD as never);
    await expect(
      assertTaskSourceThreadReadable(fakeSql([]).sql, args),
    ).resolves.toBeUndefined();
  });

  it('admits a conversation its owner shared with a project the person can open', async () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the thread row's shape is not what this test pins
    vi.mocked(loadProjectSharedThread).mockResolvedValue(THREAD as never);
    await expect(
      assertTaskSourceThreadReadable(fakeSql([]).sql, args),
    ).resolves.toBeUndefined();
  });

  it('refuses any other conversation as not found', async () => {
    await expect(
      assertTaskSourceThreadReadable(fakeSql([]).sql, args),
    ).rejects.toMatchObject({
      code: 'TASK_SOURCE_THREAD_NOT_FOUND',
      status: 404,
    });
  });
});

describe('listTasksFromThread', () => {
  const task = (overrides: Row = {}): Row => ({
    id: 'task-1',
    projectId: 'proj-1',
    projectName: 'Website relaunch',
    title: 'Compare the offers',
    status: 'in_progress',
    assigneeType: 'agent',
    assigneeId: 'agent-1',
    outputCount: 0,
    teamIds: [],
    ...overrides,
  });

  it('lists only tasks in projects the reader can open, with each agent task’s run', async () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the thread row's shape is not what this test pins
    vi.mocked(loadOwnedThread).mockResolvedValue(THREAD as never);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the fields the tray reads
    vi.mocked(getLatestAgentRunCardForTask).mockResolvedValue({
      _id: 'run-1',
      status: 'failed',
      failureCode: 'budget_exceeded',
    } as never);
    const { sql, statements } = fakeSql([
      task(),
      task({ id: 'task-2', teamIds: ['team-b'] }),
      task({ id: 'task-3', teamIds: ['team-a'], assigneeType: 'user' }),
    ]);

    const tasks = await listTasksFromThread(sql, AUTH, 'thread-1');

    expect(tasks.map((row) => row.id)).toEqual(['task-1', 'task-3']);
    expect(tasks[0]?.run).toEqual({
      status: 'failed',
      failureCode: 'budget_exceeded',
    });
    expect(tasks[1]?.run).toBeUndefined();
    expect(tasks[0]).not.toHaveProperty('teamIds');
    // Bound to the organization and the conversation, archived work left out.
    expect(statements[0]?.text).toContain('t.source_thread_id = ?');
    expect(statements[0]?.text).toContain('t.archived_at_ms IS NULL');
    expect(statements[0]?.values).toContain('thread-1');
  });

  it('refuses a conversation the reader cannot read', async () => {
    await expect(
      listTasksFromThread(fakeSql([task()]).sql, AUTH, 'thread-1'),
    ).rejects.toMatchObject({ code: 'TASK_SOURCE_THREAD_NOT_FOUND' });
  });
});
