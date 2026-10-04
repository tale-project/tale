import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { notifyTaskComment } from '../collab/service.ts';
import { emitEvent } from '../events/emit.ts';
import { saveMessage } from '../threads/store.ts';
import { taskOwnedByAutomation } from './automation-access.ts';
import { addTaskComment, addTaskReviewFeedback } from './comments.ts';
import { dispatchMentionedProjectAgent } from './service.ts';

vi.mock('../collab/mention-directory.ts', () => ({
  resolveSurfaceMentions: vi.fn().mockResolvedValue({
    mentions: [
      { type: 'agent', id: 'implementation' },
      { type: 'automation', id: 'workflow' },
    ],
    unresolvedTokens: [],
  }),
}));
vi.mock('../collab/service.ts', () => ({ notifyTaskComment: vi.fn() }));
vi.mock('../events/emit.ts', () => ({ emitEvent: vi.fn() }));
vi.mock('../audit_logs/service.ts', () => ({
  createAuditLog: vi.fn(),
  auditChainQueueKey: (id: string) => `audit-chain:${id}`,
}));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));
vi.mock('../projects/service.ts', () => ({
  loadProjectOrThrow: vi.fn().mockResolvedValue({
    id: 'project',
    organizationId: 'org',
    archivedAt: null,
  }),
}));
vi.mock('../threads/store.ts', () => ({
  THREAD_MESSAGES_READ_MAX: 500,
  saveMessage: vi.fn().mockResolvedValue({ messageId: 'feedback', order: 1 }),
}));
vi.mock('./automation-access.ts', () => ({
  taskOwnedByAutomation: vi.fn().mockReturnValue(false),
}));
vi.mock('./service.ts', async (importOriginal) => ({
  assertTaskNotArchived: (await importOriginal<typeof import('./service.ts')>())
    .assertTaskNotArchived,
  loadTaskOrThrow: vi.fn().mockResolvedValue({
    id: 'task',
    organizationId: 'org',
    projectId: 'project',
    title: 'Implementation',
    discussionThreadId: 'discussion',
    archivedAt: null,
  }),
  assertTaskReadable: vi.fn(),
  mayWorkTask: vi.fn().mockResolvedValue(true),
  dispatchMentionedProjectAgent: vi.fn(),
}));
function fixture() {
  const writes: string[] = [];
  const tag = (parts: TemplateStringsArray) => {
    writes.push(parts.join('?').replaceAll(/\s+/g, ' ').trim());
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only tag/json reached; persistence is covered by the real-PG lane
  return {
    tx: Object.assign(tag, {
      json: (value: unknown) => value,
    }) as unknown as TransactionSql,
    writes,
  };
}
beforeEach(() => vi.clearAllMocks());

describe('native review feedback', () => {
  it('saves an ordinary attributed visible comment with notifications but no dispatch of any kind', async () => {
    const f = fixture();
    expect(
      await addTaskReviewFeedback(f.tx, {
        organizationId: 'org',
        taskId: 'task',
        agentId: 'reviewer',
        body: '@implementation @workflow Please fix the regression.',
      }),
    ).toMatchObject({ messageId: 'feedback' });
    expect(saveMessage).toHaveBeenCalledWith(
      f.tx,
      expect.objectContaining({
        authorId: 'reviewer',
        role: 'assistant',
        text: '@implementation @workflow Please fix the regression.',
      }),
    );
    expect(notifyTaskComment).toHaveBeenCalledOnce();
    expect(
      f.writes.some((text) =>
        text.startsWith('INSERT INTO app.task_discussion_message_meta'),
      ),
    ).toBe(true);
    expect(dispatchMentionedProjectAgent).not.toHaveBeenCalled();
    expect(taskOwnedByAutomation).not.toHaveBeenCalled();
    expect(emitEvent).not.toHaveBeenCalled();
  });
  it('keeps ordinary comment mention and automation event behavior intact', async () => {
    const f = fixture();
    await addTaskComment(
      f.tx,
      { organizationId: 'org', userId: 'editor', role: 'admin', teamIds: [] },
      { taskId: 'task', body: '@implementation @workflow Please continue.' },
    );
    expect(dispatchMentionedProjectAgent).toHaveBeenCalledOnce();
    expect(emitEvent).toHaveBeenCalledWith(
      f.tx,
      expect.objectContaining({ eventType: 'comment.created' }),
    );
  });
});
