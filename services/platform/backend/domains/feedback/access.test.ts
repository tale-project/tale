// @vitest-environment node

/**
 * A vote is recorded only against a message the caller can read. The ids in
 * the body are client-supplied, so the service re-derives the right to vote
 * from the database: the message must exist in the caller's organization and
 * thread, and the thread must be theirs or shared with a project they can
 * read. Every other case is the same opaque refusal, before any write.
 */

import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loadOwnedThread, loadProjectSharedThread } = vi.hoisted(() => ({
  loadOwnedThread: vi.fn(),
  loadProjectSharedThread: vi.fn(),
}));

vi.mock('../chat/threads.ts', () => ({
  loadOwnedThread,
  loadProjectSharedThread,
}));

import { FeedbackError, submitMessageFeedback } from './service.ts';

const SCOPE = { organizationId: 'org-1', userId: 'user-1' };
const VOTE = { threadId: 't-1', messageId: 'm-1', rating: 'positive' } as const;

/** A tagged-template `tx` that answers the message lookup from `messageRows`
 * and records every statement, so the test can see whether a write ran. */
function fakeTx(messageRows: { id: string }[]): {
  tx: TransactionSql;
  statements: string[];
} {
  const statements: string[] = [];
  const tag = (strings: TemplateStringsArray): Promise<unknown[]> => {
    const text = strings.join('?');
    statements.push(text);
    return Promise.resolve(
      text.includes('FROM app.messages') ? messageRows : [],
    );
  };
  Object.assign(tag, { json: (value: unknown) => value });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the tag call and `json` are exercised
  return { tx: tag as unknown as TransactionSql, statements };
}

const wrote = (statements: string[]): boolean =>
  statements.some((text) => text.includes('INSERT INTO app.message_feedback'));

beforeEach(() => {
  vi.clearAllMocks();
  loadOwnedThread.mockResolvedValue(null);
  loadProjectSharedThread.mockResolvedValue(null);
});

describe('submitMessageFeedback — the message must be within reach', () => {
  it('refuses a message that is not in the caller organization and thread, before any write', async () => {
    const { tx, statements } = fakeTx([]);
    await expect(submitMessageFeedback(tx, SCOPE, VOTE)).rejects.toBeInstanceOf(
      FeedbackError,
    );
    expect(wrote(statements)).toBe(false);
    // Nothing else is consulted once the message itself is out of reach.
    expect(loadOwnedThread).not.toHaveBeenCalled();
    expect(loadProjectSharedThread).not.toHaveBeenCalled();
  });

  it('records the vote on a message in a thread the caller owns', async () => {
    loadOwnedThread.mockResolvedValue({ id: 't-1' });
    const { tx, statements } = fakeTx([{ id: 'm-1' }]);
    await submitMessageFeedback(tx, SCOPE, VOTE);
    expect(wrote(statements)).toBe(true);
    expect(loadOwnedThread).toHaveBeenCalledWith(tx, 'org-1', 'user-1', 't-1');
  });

  it('records the vote on a message in a thread shared with a project the caller can read', async () => {
    loadProjectSharedThread.mockResolvedValue({ id: 't-1' });
    const { tx, statements } = fakeTx([{ id: 'm-1' }]);
    await submitMessageFeedback(tx, SCOPE, VOTE);
    expect(wrote(statements)).toBe(true);
    expect(loadProjectSharedThread).toHaveBeenCalledWith(
      tx,
      'org-1',
      'user-1',
      't-1',
    );
  });

  it("refuses another member's private thread with the same opaque answer", async () => {
    const { tx, statements } = fakeTx([{ id: 'm-1' }]);
    const refusal = await submitMessageFeedback(tx, SCOPE, VOTE).catch(
      (error: unknown) => error,
    );
    expect(refusal).toBeInstanceOf(FeedbackError);
    expect(refusal).toMatchObject({ code: 'MESSAGE_NOT_FOUND', status: 404 });
    expect(wrote(statements)).toBe(false);
  });
});
