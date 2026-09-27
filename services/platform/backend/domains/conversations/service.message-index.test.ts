// @vitest-environment node

/**
 * An inbound email's body is indexed for retrieval, and the queueing rides
 * the transaction that stores the message: a rolled-back insert — the loser
 * of an ingest race included — queues nothing. Deleting a conversation
 * queues the release of its mail's corpus copies — the bodies' and the
 * emailed attachments' — in the delete's own transaction, because those
 * copies live in the knowledge database where the messages' cascade cannot
 * reach. A spam verdict releases them the same way, and lifting it queues
 * them for indexing again.
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

import {
  addMessageToConversation,
  bulkSetConversationStatus,
  deleteConversation,
} from './service.ts';

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
  conversation?: { channel?: string | null; status?: string | null } | null;
  indexedMessageIds?: string[];
  /** The conversation's emailed attachments: unbound file rows bound to it. */
  attachments?: { id: string; storageRef: string }[];
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
                channel:
                  conversation?.channel === undefined
                    ? 'email'
                    : conversation.channel,
                status: conversation?.status ?? 'open',
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
    if (text.startsWith('SELECT id, storage_ref AS "storageRef"')) {
      return Promise.resolve(script.attachments ?? []);
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

/** Mail as the mailbox sync stores it: it always names its connector. */
const inbound = {
  conversationId: 'conv_1',
  organizationId: ORG,
  sender: 'bob@example.test',
  content: '<p>Applying for the field sales agent role.</p>',
  isCustomer: true,
  connectorName: 'imap-smtp',
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

  it('queues nothing for a message a member logged by hand', async () => {
    // `POST /conversations/:id/messages` may say `isCustomer: true` and bring
    // its own `from` and `subject`, but names no connector: a member's words
    // must never index as a customer's mail.
    const { tx } = txDouble({});
    const { connectorName: _connector, ...logged } = inbound;
    await addMessageToConversation(tx, {
      ...logged,
      metadata: { from: [{ address: 'someone@else.test' }], subject: 'Hi' },
    });
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('queues nothing for mail landing on a conversation marked spam', async () => {
    const { tx } = txDouble({ conversation: { status: 'spam' } });
    await addMessageToConversation(tx, inbound);
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
    expect(read?.values).toEqual([ORG, ['conv_1'], 'inbound', 'email', true]);
    // Only mail a connector delivered was ever indexed.
    expect(read?.text).toContain("connector_name <> ''");
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

  it('queues no release for a conversation with no indexed mail', async () => {
    const { tx } = txDouble({ indexedMessageIds: [] });
    await deleteConversation(tx, ORG, 'conv_1');
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('queues the release of its emailed attachments with its bodies', async () => {
    // The attachments' file rows have no cascade from the conversation; the
    // released copy is the corpus one — liveness reads an attachment whose
    // conversation is gone as dead to the corpus, its bytes as kept.
    const { tx, statements, events } = txDouble({
      indexedMessageIds: ['msg_1'],
      attachments: [{ id: 'file_1', storageRef: 's3:org_1/mail/cv.pdf' }],
    });
    await deleteConversation(tx, ORG, 'conv_1');
    expect(addJobInTx).toHaveBeenCalledWith(tx, 'knowledge.release_refs', {
      organizationId: ORG,
      refs: ['msg:msg_1', 's3:org_1/mail/cv.pdf'],
    });
    const read = statements.find((s) =>
      s.text.startsWith('SELECT id, storage_ref AS "storageRef"'),
    );
    expect(read?.text).toContain('document_id IS NULL');
    expect(read?.values.slice(0, 2)).toEqual([ORG, ['conv_1']]);
    // Read before the delete, queued after it.
    expect(events.indexOf('SELECT id, storage_ref')).toBeLessThan(
      events.indexOf('DELETE FROM app.conversations'),
    );
    expect(events.indexOf('enqueue knowledge.release_refs')).toBeGreaterThan(
      events.indexOf('DELETE FROM app.conversations'),
    );
  });
});

describe('a spam verdict — the bulk verb', () => {
  const actor = { userId: 'user_admin' };

  it('queues the release of the conversations it marks spam', async () => {
    const { tx, events } = txDouble({
      conversation: { status: 'open' },
      indexedMessageIds: ['msg_1'],
      attachments: [{ id: 'file_1', storageRef: 's3:org_1/mail/cv.pdf' }],
    });
    await bulkSetConversationStatus(tx, {
      organizationId: ORG,
      conversationIds: ['conv_1'],
      verb: 'spam',
      actor,
    });
    expect(addJobInTx).toHaveBeenCalledWith(tx, 'knowledge.release_refs', {
      organizationId: ORG,
      refs: ['msg:msg_1', 's3:org_1/mail/cv.pdf'],
    });
    expect(events.indexOf('enqueue knowledge.release_refs')).toBeGreaterThan(
      events.indexOf('UPDATE app.conversations SET'),
    );
  });

  it('queues the bodies for indexing again when the verdict is lifted', async () => {
    const { tx, statements } = txDouble({
      conversation: { status: 'spam' },
      indexedMessageIds: ['msg_1', 'msg_2'],
      attachments: [{ id: 'file_1', storageRef: 's3:org_1/mail/cv.pdf' }],
    });
    await bulkSetConversationStatus(tx, {
      organizationId: ORG,
      conversationIds: ['conv_1'],
      verb: 'reopen',
      actor,
    });
    expect(addJobInTx).toHaveBeenCalledWith(tx, 'rag.index_message', {
      messageId: 'msg_1',
    });
    expect(addJobInTx).toHaveBeenCalledWith(tx, 'rag.index_message', {
      messageId: 'msg_2',
    });
    expect(addJobInTx).not.toHaveBeenCalledWith(
      tx,
      'knowledge.release_refs',
      expect.anything(),
    );
    // An empty body is never queued, as at ingest.
    const read = statements.find((s) =>
      s.text.startsWith('SELECT id FROM app.conversation_messages'),
    );
    expect(read?.values.at(-1)).toBe(false);
    // And the attachment is queued as the bind queues one: marked, then a
    // job — never one opted out of indexing.
    expect(addJobInTx).toHaveBeenCalledWith(tx, 'rag.index_file', {
      fileId: 'file_1',
    });
    const attachments = statements.find((s) =>
      s.text.startsWith('SELECT id, storage_ref AS "storageRef"'),
    );
    expect(attachments?.text).toContain(
      'skip_rag_indexing IS DISTINCT FROM true',
    );
    const marked = statements.find((s) =>
      s.text.startsWith('UPDATE app.file_metadata SET'),
    );
    expect(marked?.text).toContain("rag_status = 'queued'");
    expect(marked?.values).toContain('file_1');
  });

  it('leaves the corpus alone for a flip that is not about spam', async () => {
    const { tx } = txDouble({
      conversation: { status: 'open' },
      indexedMessageIds: ['msg_1'],
    });
    await bulkSetConversationStatus(tx, {
      organizationId: ORG,
      conversationIds: ['conv_1'],
      verb: 'close',
      actor,
    });
    expect(addJobInTx).not.toHaveBeenCalled();
  });
});
