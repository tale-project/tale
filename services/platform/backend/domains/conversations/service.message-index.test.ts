// @vitest-environment node

/**
 * An inbound email's body is indexed for retrieval, and the queueing rides
 * the transaction that stores the message: a rolled-back insert — the loser
 * of an ingest race included — queues nothing. Deleting a conversation
 * queues the release of its bodies' corpus copies in the delete's own
 * transaction, because those copies live in the knowledge database where
 * the messages' cascade cannot reach.
 */

import type { Sql, TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { addJobInTx } = vi.hoisted(() => ({
  addJobInTx: vi.fn(
    async (_tx: unknown, _name: string, _payload: unknown) => 'job-1',
  ),
}));

vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx }));
vi.mock('../../realtime/outbox.ts', () => ({
  emitHintInTx: vi.fn(async () => undefined),
}));
vi.mock('../audit_logs/service.ts', () => ({
  createAuditLog: vi.fn(async () => undefined),
}));
vi.mock('../events/emit.ts', () => ({
  emitEvent: vi.fn(async () => undefined),
}));
vi.mock('../legal_holds/service.ts', () => ({
  assertNotHeld: vi.fn(async () => undefined),
}));

import { addMessageToConversation, deleteConversation } from './service.ts';

const ORG = 'org_1';

interface Statement {
  text: string;
  values: unknown[];
}

/**
 * A transaction double answering the reads the two lanes make: the parent
 * conversation, the message insert's id, and the conversation's inbound
 * email ids. `events` interleaves statements with enqueues, so a test can
 * read the ORDER.
 */
function txDouble(script: {
  conversation?: { channel: string | null } | null;
  indexedMessageIds?: string[];
}) {
  const statements: Statement[] = [];
  const events: string[] = [];
  const tag = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    events.push(text.split(' ').slice(0, 3).join(' '));
    if (text.startsWith('SELECT') && text.includes('FROM app.conversations')) {
      const conversation = script.conversation;
      return Promise.resolve(
        conversation === null
          ? []
          : [
              {
                id: 'conv_1',
                organizationId: ORG,
                channel: conversation?.channel ?? 'email',
                lastMessageAt: null,
                metadata: {},
                connectorName: 'imap-smtp',
              },
            ],
      );
    }
    if (text.startsWith('INSERT INTO app.conversation_messages')) {
      return Promise.resolve([{ id: 'msg_1' }]);
    }
    if (text.startsWith('SELECT id FROM app.conversation_messages')) {
      return Promise.resolve(
        (script.indexedMessageIds ?? []).map((id) => ({ id })),
      );
    }
    return Promise.resolve([]);
  };
  const tx = Object.assign(tag, {
    unsafe: (text: string) => text,
    json: (value: unknown) => value,
    begin: (callback: (inner: unknown) => unknown) =>
      Promise.resolve(callback(tx)),
  });
  addJobInTx.mockImplementation(async (_tx: unknown, name: string) => {
    events.push(`enqueue ${name}`);
    return 'job-1';
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js transaction tag
  return { tx: tx as unknown as TransactionSql & Sql, statements, events };
}

const inbound = {
  conversationId: 'conv_1',
  organizationId: ORG,
  sender: 'bob@example.test',
  content: '<p>Applying for the field sales agent role.</p>',
  isCustomer: true,
};

beforeEach(() => {
  addJobInTx.mockClear();
});

describe('addMessageToConversation — indexing an inbound email body', () => {
  it('queues the body in the transaction that stores the message', async () => {
    const { tx } = txDouble({});
    const { messageId } = await addMessageToConversation(tx, inbound);
    expect(messageId).toBe('msg_1');
    expect(addJobInTx).toHaveBeenCalledWith(tx, 'rag.index_message', {
      messageId: 'msg_1',
    });
  });

  it('queues nothing for our own reply', async () => {
    const { tx } = txDouble({});
    await addMessageToConversation(tx, { ...inbound, isCustomer: false });
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('queues nothing for a conversation mirrored over the API', async () => {
    const { tx } = txDouble({ conversation: { channel: 'api' } });
    await addMessageToConversation(tx, inbound);
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('queues nothing for an empty body', async () => {
    const { tx } = txDouble({});
    await addMessageToConversation(tx, { ...inbound, content: '  \n ' });
    expect(addJobInTx).not.toHaveBeenCalled();
  });
});

describe('deleteConversation — releasing the indexed bodies', () => {
  it('queues the release of its inbound emails in the delete’s own transaction', async () => {
    const { tx, statements, events } = txDouble({
      indexedMessageIds: ['msg_1', 'msg_2'],
    });
    await deleteConversation(tx, ORG, 'conv_1');

    const read = statements.find((s) =>
      s.text.startsWith('SELECT id FROM app.conversation_messages'),
    );
    expect(read?.values).toEqual(['conv_1', ORG, 'inbound', 'email']);
    expect(addJobInTx).toHaveBeenCalledWith(tx, 'knowledge.release_refs', {
      organizationId: ORG,
      refs: ['msg:msg_1', 'msg:msg_2'],
    });
    // The job is queued after the delete, in the same transaction: it runs
    // once the rows are gone and finds the refs dead.
    expect(events.indexOf('enqueue knowledge.release_refs')).toBeGreaterThan(
      events.indexOf('DELETE FROM app.conversations'),
    );
  });

  it('queues no release for a conversation with no indexed body', async () => {
    const { tx } = txDouble({ indexedMessageIds: [] });
    await deleteConversation(tx, ORG, 'conv_1');
    expect(addJobInTx).not.toHaveBeenCalled();
  });
});
