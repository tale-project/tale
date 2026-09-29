// @vitest-environment node

/**
 * Every writer that rewrites a conversation's summary — the unread count, the
 * status stamps, the activity time — from a read of the row reads it
 * `FOR UPDATE`, in the transaction that writes it back. Two appends that read
 * the same unlocked snapshot both committed, and the later one wrote back one
 * unread message and the older message's time (#3735).
 *
 * This pins the statement shape so a writer cannot lose the lock unnoticed;
 * the overlap itself — a held append beside one through the native door — is
 * proven on real Postgres by the `checkConversations` lane of
 * `backend:integration`.
 */

import type { Sql, TransactionSql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../jobs/enqueue.ts', () => ({
  addJobInTx: vi.fn(async () => 'job-1'),
}));
vi.mock('../../realtime/outbox.ts', () => ({
  emitHintInTx: vi.fn(async () => undefined),
}));
vi.mock('../audit_logs/service.ts', () => ({
  createAuditLog: vi.fn(async () => undefined),
}));
vi.mock('../events/emit.ts', () => ({
  emitEvent: vi.fn(async () => undefined),
}));

import {
  addMessageToConversation,
  bulkSetConversationStatus,
  markConversationAsRead,
  updateConversation,
} from './service.ts';

const ORG = 'org_1';

/** A transaction double that records statements and answers the parent read. */
function txDouble() {
  const statements: string[] = [];
  const tag = (strings: TemplateStringsArray): Promise<unknown[]> => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push(text);
    if (text.startsWith('SELECT') && text.includes('FROM app.conversations')) {
      return Promise.resolve([
        {
          id: 'conv_1',
          organizationId: ORG,
          channel: 'api',
          status: 'open',
          lastMessageAt: 1_000,
          metadata: { unread_count: 1, routing: 'desk' },
          connectorName: 'qa-desk',
        },
      ]);
    }
    if (text.startsWith('INSERT INTO app.conversation_messages')) {
      return Promise.resolve([{ id: 'msg_1' }]);
    }
    return Promise.resolve([]);
  };
  const tx = Object.assign(tag, {
    unsafe: (text: string) => text,
    json: (value: unknown) => value,
    begin: (callback: (inner: unknown) => unknown) =>
      Promise.resolve(callback(tx)),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js transaction tag
  return { tx: tx as unknown as TransactionSql & Sql, statements };
}

/** The read of the parent the writer's UPDATE is computed from. */
function parentReadBeforeUpdate(statements: readonly string[]): string {
  const update = statements.findIndex((text) =>
    text.startsWith('UPDATE app.conversations SET'),
  );
  expect(update, 'the writer rewrites the conversation').toBeGreaterThan(-1);
  const read = statements
    .slice(0, update)
    .findLast(
      (text) =>
        text.startsWith('SELECT') && text.includes('FROM app.conversations'),
    );
  expect(read, 'the writer reads the conversation first').toBeDefined();
  return read ?? '';
}

describe('a conversation summary is rewritten from a locked read', () => {
  it('when a message is appended', async () => {
    const { tx, statements } = txDouble();
    await addMessageToConversation(tx, {
      conversationId: 'conv_1',
      organizationId: ORG,
      sender: 'customer',
      content: 'Where is my order?',
      isCustomer: true,
      sentAt: 2_000,
    });
    expect(parentReadBeforeUpdate(statements)).toMatch(/ FOR UPDATE$/);
  });

  it('when it is marked as read', async () => {
    const { tx, statements } = txDouble();
    await markConversationAsRead(tx, ORG, 'conv_1');
    expect(parentReadBeforeUpdate(statements)).toMatch(/ FOR UPDATE$/);
  });

  it('when its status or metadata is patched', async () => {
    const { tx, statements } = txDouble();
    await updateConversation(
      tx,
      ORG,
      'conv_1',
      { status: 'closed' },
      { userId: 'u1' },
    );
    expect(parentReadBeforeUpdate(statements)).toMatch(/ FOR UPDATE$/);
  });

  it('when a bulk verb flips its status', async () => {
    const { tx, statements } = txDouble();
    await bulkSetConversationStatus(tx, {
      organizationId: ORG,
      conversationIds: ['conv_1'],
      verb: 'close',
      actor: { userId: 'u1' },
    });
    expect(parentReadBeforeUpdate(statements)).toMatch(/ FOR UPDATE$/);
  });
});
