/**
 * Naming a thread is a model call the organization pays for, booked through
 * the ledger the turn writes through — and, for a project's thread, to the
 * project as well, so the project's caps count it.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  record: vi.fn(async () => undefined),
  readThreadProjectId: vi.fn(
    async (): Promise<string | undefined> => undefined,
  ),
}));

vi.mock('../core/chat/generate_title.ts', () => ({
  // The naming attempt itself is its own test's; here it spends once.
  generateThreadTitleImpl: vi.fn(
    async (
      _ctx: unknown,
      _input: unknown,
      recordUsage: (entry: Record<string, unknown>) => Promise<void>,
    ) => {
      await recordUsage({
        organizationId: 'o1',
        userId: 'u1',
        agentSlug: 'thread-title',
        model: 'm',
        provider: 'p',
        inputTokens: 10,
        outputTokens: 2,
        totalTokens: 12,
      });
      return null;
    },
  ),
}));
vi.mock('../domains/chat/store.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../domains/chat/store.ts')>()),
  createPgUsageLedger: () => ({ record: mocks.record }),
}));
vi.mock('../domains/chat/threads.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../domains/chat/threads.ts')>()),
  readThreadProjectId: mocks.readThreadProjectId,
}));

import { createTaskList } from './task-list.ts';

const SQL = {} as Sql;

const PAYLOAD = {
  organizationId: 'o1',
  threadId: 't1',
  userId: 'u1',
  firstMessage: 'Plan the launch',
};

describe('chat.generate_title', () => {
  beforeEach(() => vi.clearAllMocks());

  it('books naming a project’s thread to the project [GOV-R14]', async () => {
    mocks.readThreadProjectId.mockResolvedValueOnce('project-1');
    await createTaskList({ sql: SQL })['chat.generate_title']?.(PAYLOAD);
    expect(mocks.readThreadProjectId).toHaveBeenCalledWith(SQL, 'o1', 't1');
    expect(mocks.record).toHaveBeenCalledWith(
      expect.objectContaining({
        agentSlug: 'thread-title',
        totalTokens: 12,
        projectId: 'project-1',
      }),
    );
  });

  it('books naming a thread outside a project to the ledger alone', async () => {
    await createTaskList({ sql: SQL })['chat.generate_title']?.(PAYLOAD);
    expect(mocks.record).toHaveBeenCalledWith(
      expect.not.objectContaining({ projectId: expect.anything() }),
    );
  });
});
