/**
 * Naming a thread is a model call the organization pays for: the job hands
 * the naming attempt a meter that holds the call under the thread's member
 * — with the API key that sent the message, and the thread's project — and
 * books it under `thread-title`. The meter itself is `title-meter.ts`'s;
 * here it is a stand-in.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateThreadTitleImpl: vi.fn(async () => null),
  titleMeter: vi.fn(() => ({ marker: 'meter' })),
  readThreadProjectId: vi.fn(
    async (): Promise<string | undefined> => undefined,
  ),
}));

vi.mock('../core/chat/generate_title.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../core/chat/generate_title.ts')>()),
  generateThreadTitleImpl: mocks.generateThreadTitleImpl,
}));
vi.mock('../domains/chat/title-meter.ts', () => ({
  titleMeter: mocks.titleMeter,
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

  it('meters naming a project’s thread under its member, the sending key and the project [GOV-R14]', async () => {
    mocks.readThreadProjectId.mockResolvedValueOnce('project-1');
    await createTaskList({ sql: SQL })['chat.generate_title']?.({
      ...PAYLOAD,
      apiKeyId: 'key-1',
    });

    expect(mocks.readThreadProjectId).toHaveBeenCalledWith(SQL, 'o1', 't1');
    expect(mocks.titleMeter).toHaveBeenCalledWith(SQL, {
      organizationId: 'o1',
      subject: {
        userId: 'u1',
        agentSlug: 'thread-title',
        apiKeyId: 'key-1',
        projectIds: ['project-1'],
      },
    });
    expect(mocks.generateThreadTitleImpl).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ threadId: 't1' }),
      { marker: 'meter' },
    );
  });

  it('passes on that a guardrail refused the message, so no model names its thread', async () => {
    await createTaskList({ sql: SQL })['chat.generate_title']?.({
      ...PAYLOAD,
      nameWithoutModel: true,
    });
    expect(mocks.generateThreadTitleImpl).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ nameWithoutModel: true }),
      { marker: 'meter' },
    );
  });

  it('meters naming a thread outside a project under its member alone', async () => {
    await createTaskList({ sql: SQL })['chat.generate_title']?.(PAYLOAD);
    expect(mocks.titleMeter).toHaveBeenCalledWith(SQL, {
      organizationId: 'o1',
      subject: { userId: 'u1', agentSlug: 'thread-title' },
    });
  });
});
