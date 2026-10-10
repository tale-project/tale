import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addJobInTx } from '../../jobs/enqueue.ts';
import { addTaskComment } from './comments.ts';

/**
 * A comment that names the automation owning its task starts that
 * automation's run. Written with an API key, the run is the key's spend
 * too: the queued start carries the key, and only a key it was written
 * with (SBX-R14).
 */

vi.mock('../collab/mention-directory.ts', () => ({
  prepareSurfaceText: vi.fn(async (_sql: unknown, args: { body: string }) => ({
    text: args.body,
    mentions: [{ type: 'automation', id: 'triage' }],
    added: [],
    unresolvedMentionTokens: [],
    invalidTokens: [],
  })),
}));
vi.mock('../collab/service.ts', () => ({ notifyTaskComment: vi.fn() }));
vi.mock('../events/emit.ts', () => ({ emitEvent: vi.fn() }));
vi.mock('../audit_logs/service.ts', () => ({
  createAuditLog: vi.fn(),
}));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));
vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));
vi.mock('../projects/service.ts', () => ({
  loadProjectOrThrow: vi.fn().mockResolvedValue({
    id: 'project',
    organizationId: 'org',
    archivedAt: null,
  }),
}));
vi.mock('../threads/store.ts', () => ({
  THREAD_MESSAGES_READ_MAX: 500,
  saveMessage: vi.fn().mockResolvedValue({ messageId: 'comment', order: 1 }),
}));
vi.mock('./automation-access.ts', () => ({
  taskOwnedByAutomation: vi.fn().mockResolvedValue(true),
}));
vi.mock('./run-start.ts', () => ({
  mentionAutomationEnabled: vi.fn().mockResolvedValue(true),
}));
vi.mock('./service.ts', async (importOriginal) => ({
  assertTaskNotArchived: (await importOriginal<typeof import('./service.ts')>())
    .assertTaskNotArchived,
  loadTaskOrThrow: vi.fn().mockResolvedValue({
    id: 'task',
    organizationId: 'org',
    projectId: 'project',
    title: 'Triage the inbox',
    discussionThreadId: 'discussion',
    assigneeType: 'app',
    assigneeId: 'triage',
    archivedAt: null,
  }),
  assertTaskReadable: vi.fn(),
  mayWorkTask: vi.fn().mockResolvedValue(true),
  dispatchMentionedProjectAgent: vi.fn(),
}));

function tx(): TransactionSql {
  const tag = () => Promise.resolve([]);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only tag/json reached; persistence is covered by the real-PG lane
  return Object.assign(tag, {
    json: (value: unknown) => value,
  }) as unknown as TransactionSql;
}

const editor = {
  organizationId: 'org',
  userId: 'editor',
  role: 'editor',
  teamIds: [] as string[],
};

beforeEach(() => vi.mocked(addJobInTx).mockClear());

describe('an @automation comment on the task it owns', () => {
  it('queues the start with the API key the comment was written with [SBX-R14]', async () => {
    await addTaskComment(
      tx(),
      { ...editor, apiKeyId: 'key-1' },
      { taskId: 'task', body: '@triage take another look' },
    );

    expect(addJobInTx).toHaveBeenCalledWith(
      expect.anything(),
      'task.start_workflow',
      {
        organizationId: 'org',
        taskId: 'task',
        workflowSlug: 'triage',
        startedByUserId: 'editor',
        apiKeyId: 'key-1',
      },
      expect.anything(),
    );
  });

  it('queues it with no key when the comment came without one', async () => {
    await addTaskComment(tx(), editor, {
      taskId: 'task',
      body: '@triage take another look',
    });

    expect(addJobInTx).toHaveBeenCalledWith(
      expect.anything(),
      'task.start_workflow',
      {
        organizationId: 'org',
        taskId: 'task',
        workflowSlug: 'triage',
        startedByUserId: 'editor',
      },
      expect.anything(),
    );
  });
});
