/**
 * The outbound send job and its undo window.
 *
 * The external id stamped on a sent row is the RFC Message-ID, so a customer's
 * reply threads back onto the conversation. Gmail's send returns only its own
 * API id, so the sent message is read back once to recover the RFC id; the
 * other connectors keep whatever the send output already carried.
 *
 * The undo window closes at ONE instant for both sides: the job claims the
 * queued row with a conditional update before the connector call, so a fired
 * job after an undo finds nothing to claim, and an undo after the claim is
 * refused — the seconds a connector send takes are no longer a window in which
 * the mail leaves while the row is deleted. The undo's DELETE carries the same
 * state predicate, so a claim that commits between the undo's read and its
 * delete (READ COMMITTED re-checks the predicate on the new row version) is
 * refused too, instead of deleting the claimed row.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  runConnectorAction,
  createAuditLog,
  addJobInTx,
  emitHintInTx,
  queueApiReply,
  assertOwnedAttachments,
} = vi.hoisted(() => ({
  runConnectorAction: vi.fn(),
  createAuditLog: vi.fn(async () => undefined),
  addJobInTx: vi.fn(async () => 'job-1'),
  emitHintInTx: vi.fn(async () => undefined),
  queueApiReply: vi.fn(async () => 'm-api'),
  assertOwnedAttachments: vi.fn(async () => undefined),
}));

vi.mock('../connectors/service.ts', () => ({ runConnectorAction }));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog }));
vi.mock('../files/service.ts', () => ({ getFileUrl: vi.fn() }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx }));
vi.mock('../events/emit.ts', () => ({
  emitEvent: vi.fn(async () => undefined),
}));
vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx }));
vi.mock('./attachment-ownership.ts', () => ({ assertOwnedAttachments }));
vi.mock('./api-sync.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api-sync.ts')>()),
  queueApiReply,
}));

import {
  composeEmailConversation,
  discardOutboundMessage,
  replyToConversation,
  resolveSentExternalMessageId,
  retrySendMessage,
  runSendMessageJob,
  undoSendMessage,
} from './send.ts';
import type { ConversationMessageRow, ConversationRow } from './service.ts';

const SQL = {} as never;

const QUEUED_ROW: ConversationMessageRow = {
  id: 'm1',
  organizationId: 'o1',
  conversationId: 'c1',
  channel: 'email',
  direction: 'outbound',
  externalMessageId: null,
  deliveryState: 'queued',
  retryCount: null,
  connectorName: 'imap-smtp',
  credentialId: null,
  content: 'On its way.',
  sentAt: null,
  deliveredAt: null,
  metadata: { subject: 'Re: Order 42', to: ['carla@ext.test'] },
  createdAt: 1_000,
};

const JOB_PAYLOAD = {
  organizationId: 'o1',
  messageId: 'm1',
  connectorName: 'imap-smtp',
  to: ['carla@ext.test'],
  subject: 'Re: Order 42',
  body: '<p>On its way.</p>',
  contentType: 'HTML',
};

/** A recorded statement and the transaction (index into `begins`) it ran
 * in — `null` outside any `begin`. */
type Statement = { text: string; values: unknown[]; begin: number | null };
type Begin = { status: 'open' | 'committed' | 'rolled_back' };

/**
 * A `sql` double that records statements and answers by statement shape:
 * `answer` maps a text fragment to the rows that statement returns (or the
 * error it rejects with); the first matching fragment wins, and anything
 * unmatched answers no rows. `begin` runs the callback on the same tag and
 * records whether the transaction committed or rolled back.
 */
function fakeSql(answer: Record<string, unknown[] | Error>) {
  const statements: Statement[] = [];
  const begins: Begin[] = [];
  let current: number | null = null;
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values, begin: current });
    const hit = Object.entries(answer).find(([needle]) =>
      text.includes(needle),
    );
    if (hit?.[1] instanceof Error) return Promise.reject(hit[1]);
    return Promise.resolve(hit ? hit[1] : []);
  };
  const sql = Object.assign(tag, {
    unsafe: (text: string) => text,
    json: (value: unknown) => value,
    begin: async (cb: (tx: unknown) => unknown) => {
      const index = begins.push({ status: 'open' }) - 1;
      current = index;
      try {
        const result = await cb(sql);
        begins[index] = { status: 'committed' };
        return result;
      } catch (error) {
        begins[index] = { status: 'rolled_back' };
        throw error;
      } finally {
        current = null;
      }
    },
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
  return { sql: sql as unknown as Sql, statements, begins };
}

const CLAIM = "metadata->>'sendClaimedAt' IS NULL";
const SETTLE = "delivery_state = 'sent'";

describe('runSendMessageJob — the claim', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not send when the row cannot be claimed (undone, settled, or already claimed) [CONV-R10]', async () => {
    const { sql, statements } = fakeSql({ [CLAIM]: [] });
    await runSendMessageJob(sql, JOB_PAYLOAD);
    expect(runConnectorAction).not.toHaveBeenCalled();
    expect(statements.some((s) => s.text.includes(SETTLE))).toBe(false);
  });

  it('claims the queued row in one conditional update, then sends and settles it [CONV-R10]', async () => {
    runConnectorAction.mockResolvedValue({
      status: 'ok',
      output: { messageId: '<smtp-1@door.test>' },
    });
    const { sql, statements } = fakeSql({
      [CLAIM]: [QUEUED_ROW],
      [SETTLE]: [{ id: 'm1' }],
    });
    await runSendMessageJob(sql, JOB_PAYLOAD);

    const claim = statements.find((s) => s.text.includes(CLAIM));
    expect(claim?.text).toContain('UPDATE app.conversation_messages');
    // Queued, outbound, in THIS org, unclaimed — and the claim stamp itself.
    expect(claim?.text).toContain("delivery_state = 'queued'");
    expect(claim?.text).toContain("direction = 'outbound'");
    expect(claim?.text).toContain('org_id = ?');
    expect(claim?.values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sendClaimedAt: expect.any(Number) }),
        'm1',
        'o1',
      ]),
    );
    // The claim precedes the connector call, and the settle follows it.
    const claimIndex = statements.findIndex((s) => s.text.includes(CLAIM));
    const settleIndex = statements.findIndex((s) => s.text.includes(SETTLE));
    expect(runConnectorAction).toHaveBeenCalledTimes(1);
    expect(claimIndex).toBeGreaterThanOrEqual(0);
    expect(settleIndex).toBeGreaterThan(claimIndex);
    expect(statements[settleIndex]?.text).toContain('RETURNING id');
  });

  it('counts the delivery as its sender’s connector call [GOV-R15]', async () => {
    runConnectorAction.mockResolvedValue({
      status: 'ok',
      output: { messageId: '<smtp-1@door.test>' },
    });
    const { sql } = fakeSql({
      [CLAIM]: [QUEUED_ROW],
      [SETTLE]: [{ id: 'm1' }],
    });
    await runSendMessageJob(sql, { ...JOB_PAYLOAD, sentBy: { userId: 'u1' } });
    expect(runConnectorAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        caller: { kind: 'system', reason: 'conversation email reply' },
        spender: { userId: 'u1' },
      }),
    );
  });

  it('hands the chosen From to the connector send', async () => {
    runConnectorAction.mockResolvedValue({
      status: 'ok',
      output: { messageId: '<smtp-1@door.test>' },
    });
    const { sql } = fakeSql({
      [CLAIM]: [QUEUED_ROW],
      [SETTLE]: [{ id: 'm1' }],
    });
    await runSendMessageJob(sql, { ...JOB_PAYLOAD, from: 'billing@door.test' });
    expect(runConnectorAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        connector: 'imap-smtp',
        input: expect.objectContaining({ from: 'billing@door.test' }),
      }),
    );
  });

  it('settles a delivered row sent without the Message-ID the Sent-folder sync landed first', async () => {
    runConnectorAction.mockResolvedValue({
      status: 'ok',
      output: { messageId: '<smtp-1@door.test>' },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // The id is unique per org (0077): the settle that stamps it collides when
    // the sync already ingested the sent mail. The first (stamping) UPDATE is
    // refused; the settle must still record the send, not fail it.
    const { sql, statements } = fakeSql({
      [CLAIM]: [QUEUED_ROW],
      'external_message_id = ?': Object.assign(new Error('duplicate key'), {
        code: '23505',
      }),
      [SETTLE]: [{ id: 'm1' }],
    });
    await runSendMessageJob(sql, JOB_PAYLOAD);
    const settles = statements.filter((s) => s.text.includes(SETTLE));
    expect(settles).toHaveLength(2);
    expect(settles[0]?.text).toContain('external_message_id = ?');
    expect(settles[1]?.text).not.toContain('external_message_id');
    expect(statements.some((s) => s.text.includes("'failed'"))).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('landed that Message-ID first'),
    );
    warn.mockRestore();
  });

  it('warns instead of failing when the delivered row is gone at settle time', async () => {
    runConnectorAction.mockResolvedValue({
      status: 'ok',
      output: { messageId: '<smtp-1@door.test>' },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { sql } = fakeSql({ [CLAIM]: [QUEUED_ROW], [SETTLE]: [] });
    await runSendMessageJob(sql, JOB_PAYLOAD);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('delivered but its row is gone'),
    );
    warn.mockRestore();
  });
});

describe('composeEmailConversation — one transaction', () => {
  beforeEach(() => vi.clearAllMocks());

  const CONVERSATION: ConversationRow = {
    id: 'c-new',
    organizationId: 'o1',
    contactId: 'ct1',
    assigneeUserId: 'u1',
    assigneeTeamId: null,
    externalMessageId: null,
    subject: 'Quote 7',
    status: 'open',
    priority: null,
    type: null,
    channel: 'email',
    direction: 'outbound',
    connectorName: 'imap-smtp',
    lastMessageAt: null,
    metadata: null,
    lifecycleStatus: null,
    statusChangedAt: null,
    createdAt: 1_000,
  };
  const answers = {
    'email FROM app.contacts': [
      { organizationId: 'o1', email: 'carla@ext.test' },
    ],
    'INSERT INTO app.conversations': [{ id: 'c-new' }],
    'FROM app.conversations WHERE id = ?': [CONVERSATION],
    'INSERT INTO app.conversation_messages': [{ id: 'm-new' }],
  };
  const compose = (sql: Sql) =>
    composeEmailConversation(sql, {
      organizationId: 'o1',
      contactId: 'ct1',
      connectorName: 'imap-smtp',
      subject: 'Quote 7',
      content: 'Seven units.',
      actor: { userId: 'u1', role: 'member' },
    });

  it('creates the conversation and queues its message in the same transaction', async () => {
    const { sql, statements, begins } = fakeSql(answers);
    await expect(compose(sql)).resolves.toEqual({
      conversationId: 'c-new',
      messageId: 'm-new',
    });
    expect(begins).toEqual([{ status: 'committed' }]);
    const conversationInsert = statements.find((s) =>
      s.text.startsWith('INSERT INTO app.conversations'),
    );
    const messageInsert = statements.find((s) =>
      s.text.startsWith('INSERT INTO app.conversation_messages'),
    );
    expect(conversationInsert?.begin).toBe(0);
    expect(messageInsert?.begin).toBe(0);
    expect(addJobInTx).toHaveBeenCalledTimes(1);
    // The delivery is the sender's connector call.
    const [payload] = addJobInTx.mock.calls[0]?.slice(2) ?? [];
    expect(payload).toMatchObject({ sentBy: { userId: 'u1' } });
  });

  it('a failed enqueue rolls the conversation back too — no empty outbound thread', async () => {
    addJobInTx.mockRejectedValueOnce(new Error('pg-boss unavailable'));
    const { sql, statements, begins } = fakeSql(answers);
    await expect(compose(sql)).rejects.toThrow('pg-boss unavailable');
    // The conversation insert ran inside the ONE transaction that rolled back;
    // nothing about it was committed on its own.
    const conversationInsert = statements.find((s) =>
      s.text.startsWith('INSERT INTO app.conversations'),
    );
    expect(conversationInsert).toBeDefined();
    expect(conversationInsert?.begin).toBe(0);
    expect(begins).toEqual([{ status: 'rolled_back' }]);
  });

  /**
   * One connector can hold several mailboxes. A compose names the one it
   * sends from, and the outbound row records it, so the thread's later
   * replies stay on that mailbox.
   */
  const MAILBOX = 'FROM app.connector_credentials';
  const composeFrom = (sql: Sql) =>
    composeEmailConversation(sql, {
      organizationId: 'o1',
      contactId: 'ct1',
      connectorName: 'imap-smtp',
      credentialId: 'cred-b',
      subject: 'Quote 7',
      content: 'Seven units.',
      actor: { userId: 'u1', role: 'member' },
    });

  it('sends through the chosen mailbox and records it on the message', async () => {
    const { sql, statements } = fakeSql({
      ...answers,
      [MAILBOX]: [{ connectorSlug: 'imap-smtp', status: 'active' }],
    });
    await composeFrom(sql);

    const lookup = statements.find((st) => st.text.includes(MAILBOX));
    // Scoped to the organization: an id from another org is no mailbox.
    expect(lookup?.values).toEqual(['cred-b', 'o1']);
    const insert = statements.find((st) =>
      st.text.startsWith('INSERT INTO app.conversation_messages'),
    );
    // org, conversation, connector_name, credential_id
    expect(insert?.values[3]).toBe('cred-b');
    const [payload] = addJobInTx.mock.calls[0]?.slice(2) ?? [];
    expect(payload).toMatchObject({ credentialId: 'cred-b' });
  });

  it.each([
    ['compose_mailbox_not_found', []],
    [
      'compose_mailbox_connector_mismatch',
      [{ connectorSlug: 'gmail', status: 'active' }],
    ],
    [
      'compose_mailbox_inactive',
      [{ connectorSlug: 'imap-smtp', status: 'disabled' }],
    ],
  ])('refuses with %s before writing anything', async (code, mailbox) => {
    const { sql, statements, begins } = fakeSql({
      ...answers,
      [MAILBOX]: mailbox,
    });
    await expect(composeFrom(sql)).rejects.toMatchObject({ code });
    expect(begins).toEqual([]);
    expect(statements.some((st) => st.text.startsWith('INSERT'))).toBe(false);
    expect(addJobInTx).not.toHaveBeenCalled();
  });
});

describe('retrySendMessage — the mailbox', () => {
  beforeEach(() => vi.clearAllMocks());

  const FAILED_ROW: ConversationMessageRow = {
    ...QUEUED_ROW,
    deliveryState: 'failed',
    credentialId: 'cred-b',
    metadata: {
      subject: 'Re: Order 42',
      to: ['carla@ext.test'],
      error: 'SMTP refused',
    },
  };
  const answers = (row: ConversationMessageRow) => ({
    'FROM app.conversation_messages WHERE id': [row],
    'SELECT metadata FROM app.conversations': [{ metadata: null }],
  });

  it('retries through the mailbox the failed attempt used', async () => {
    const { sql } = fakeSql(answers(FAILED_ROW));
    await retrySendMessage(sql, {
      organizationId: 'o1',
      messageId: 'm1',
      actor: { userId: 'u1' },
    });
    const [payload] = addJobInTx.mock.calls[0]?.slice(2) ?? [];
    expect(payload).toMatchObject({ credentialId: 'cred-b' });
    // A retry is a new delivery, the retrying member's call.
    expect(payload).toMatchObject({ sentBy: { userId: 'u1' } });
  });

  it('leaves the credential unset for a message that recorded none', async () => {
    const { sql } = fakeSql(answers({ ...FAILED_ROW, credentialId: null }));
    await retrySendMessage(sql, {
      organizationId: 'o1',
      messageId: 'm1',
      actor: { userId: 'u1' },
    });
    const [payload] = addJobInTx.mock.calls[0]?.slice(2) ?? [];
    expect(payload).not.toHaveProperty('credentialId');
  });
});

describe('undoSendMessage — after the claim [CONV-R9]', () => {
  beforeEach(() => vi.clearAllMocks());
  const actor = { userId: 'u1' };
  const LOAD = 'FROM app.conversation_messages WHERE id = ? LIMIT 1';
  const UNDO_DELETE =
    "DELETE FROM app.conversation_messages WHERE id = ? AND org_id = ? AND direction = 'outbound' AND delivery_state = 'queued' AND metadata->>'sendClaimedAt' IS NULL RETURNING id";

  it('refuses a row the send job has claimed (409, nothing deleted)', async () => {
    const claimedRow = {
      ...QUEUED_ROW,
      metadata: { ...QUEUED_ROW.metadata, sendClaimedAt: 1_500 },
    };
    const { sql, statements } = fakeSql({ [LOAD]: [claimedRow] });
    await expect(
      undoSendMessage(sql, { organizationId: 'o1', messageId: 'm1', actor }),
    ).rejects.toMatchObject({ code: 'undo_window_closed', status: 409 });
    expect(statements.some((s) => s.text.startsWith('DELETE'))).toBe(false);
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('refuses when the claim lands between the read and the delete (0 rows, 409, no audit or hint)', async () => {
    // The read saw an unclaimed queued row; the send job's claim committed
    // before our DELETE, whose re-checked predicate then matches nothing.
    const { sql, statements, begins } = fakeSql({
      [LOAD]: [QUEUED_ROW],
      [UNDO_DELETE]: [],
    });
    await expect(
      undoSendMessage(sql, { organizationId: 'o1', messageId: 'm1', actor }),
    ).rejects.toMatchObject({ code: 'undo_window_closed', status: 409 });
    expect(statements.filter((s) => s.text.startsWith('DELETE'))).toHaveLength(
      1,
    );
    expect(begins[0]?.status).toBe('rolled_back');
    expect(createAuditLog).not.toHaveBeenCalled();
    expect(emitHintInTx).not.toHaveBeenCalled();
  });

  it('recalls an unclaimed queued row through a DELETE that is itself the state check', async () => {
    const { sql, statements } = fakeSql({
      [LOAD]: [QUEUED_ROW],
      [UNDO_DELETE]: [{ id: 'm1' }],
    });
    await expect(
      undoSendMessage(sql, { organizationId: 'o1', messageId: 'm1', actor }),
    ).resolves.toEqual({ sourceMarkdown: null, attachments: [] });
    const deletes = statements.filter((s) => s.text.startsWith('DELETE'));
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.text).toContain("delivery_state = 'queued'");
    expect(deletes[0]?.text).toContain("metadata->>'sendClaimedAt' IS NULL");
    expect(deletes[0]?.values).toEqual(['m1', 'o1']);
    expect(createAuditLog).toHaveBeenCalledTimes(1);
  });

  // The undo hands the whole draft back: the markdown AND the files the send
  // named, so undoing a reply that carried only an attachment still gives
  // the person their message back. It used to hand back the markdown alone.
  const INVOICE = {
    id: 's3:o1/invoice',
    filename: 'invoice.pdf',
    contentType: 'application/pdf',
    size: 8,
    storageId: 's3:o1/invoice',
  };
  const HANDED_BACK = {
    storageId: 's3:o1/invoice',
    fileName: 'invoice.pdf',
    contentType: 'application/pdf',
    size: 8,
  };

  it('hands back the text and the files of the send it recalls', async () => {
    const row = {
      ...QUEUED_ROW,
      metadata: {
        ...QUEUED_ROW.metadata,
        sourceMarkdown: 'The invoice is attached.',
        attachments: [INVOICE],
      },
    };
    const { sql } = fakeSql({ [LOAD]: [row], [UNDO_DELETE]: [{ id: 'm1' }] });
    await expect(
      undoSendMessage(sql, { organizationId: 'o1', messageId: 'm1', actor }),
    ).resolves.toEqual({
      sourceMarkdown: 'The invoice is attached.',
      attachments: [HANDED_BACK],
    });
  });

  it('hands back the files of an attachment-only send, which has no text', async () => {
    const row = {
      ...QUEUED_ROW,
      content: '',
      metadata: { ...QUEUED_ROW.metadata, attachments: [INVOICE] },
    };
    const { sql } = fakeSql({ [LOAD]: [row], [UNDO_DELETE]: [{ id: 'm1' }] });
    await expect(
      undoSendMessage(sql, { organizationId: 'o1', messageId: 'm1', actor }),
    ).resolves.toEqual({ sourceMarkdown: null, attachments: [HANDED_BACK] });
  });

  it('hands back the files of an API-source reply in the same shape', async () => {
    // `queueApiReply` stamps its files with the source's external id as `id`.
    const row = {
      ...QUEUED_ROW,
      channel: 'api',
      metadata: {
        sourceMarkdown: 'Here it is.',
        attachments: [{ ...INVOICE, id: 'ext-7' }],
      },
    };
    const { sql } = fakeSql({ [LOAD]: [row], [UNDO_DELETE]: [{ id: 'm1' }] });
    await expect(
      undoSendMessage(sql, { organizationId: 'o1', messageId: 'm1', actor }),
    ).resolves.toEqual({
      sourceMarkdown: 'Here it is.',
      attachments: [HANDED_BACK],
    });
  });
});

describe('discardOutboundMessage — the delete is the state check', () => {
  beforeEach(() => vi.clearAllMocks());
  const actor = { userId: 'u1' };
  const LOAD = 'FROM app.conversation_messages WHERE id = ? LIMIT 1';
  const DISCARD_DELETE =
    "DELETE FROM app.conversation_messages WHERE id = ? AND org_id = ? AND direction = 'outbound' AND delivery_state = 'failed' RETURNING id";
  const FAILED_ROW: ConversationMessageRow = {
    ...QUEUED_ROW,
    deliveryState: 'failed',
    metadata: { ...QUEUED_ROW.metadata, error: 'SMTP 550' },
  };

  it('refuses when a retry re-queued the row between the read and the delete', async () => {
    const { sql, begins } = fakeSql({
      [LOAD]: [FAILED_ROW],
      [DISCARD_DELETE]: [],
    });
    await expect(
      discardOutboundMessage(sql, {
        organizationId: 'o1',
        messageId: 'm1',
        actor,
      }),
    ).rejects.toMatchObject({ code: 'discard_not_available', status: 409 });
    expect(begins[0]?.status).toBe('rolled_back');
    expect(createAuditLog).not.toHaveBeenCalled();
    expect(emitHintInTx).not.toHaveBeenCalled();
  });

  it('discards a failed row', async () => {
    const { sql, statements } = fakeSql({
      [LOAD]: [FAILED_ROW],
      [DISCARD_DELETE]: [{ id: 'm1' }],
    });
    await expect(
      discardOutboundMessage(sql, {
        organizationId: 'o1',
        messageId: 'm1',
        actor,
      }),
    ).resolves.toBeUndefined();
    const deletes = statements.filter((s) => s.text.startsWith('DELETE'));
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.text).toContain("delivery_state = 'failed'");
    expect(createAuditLog).toHaveBeenCalledTimes(1);
  });
});

describe('resolveSentExternalMessageId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads a Gmail send back and stamps its RFC Message-ID', async () => {
    runConnectorAction.mockResolvedValue({
      status: 'ok',
      output: {
        message: {
          id: 'gmail-api-id-xyz',
          payload: {
            headers: [
              { name: 'Message-ID', value: '<sent-42@mail.gmail.com>' },
            ],
          },
        },
      },
    });

    const id = await resolveSentExternalMessageId(SQL, {
      organizationId: 'o1',
      connector: 'gmail',
      connectorName: 'gmail',
      output: { id: 'gmail-api-id-xyz', threadId: 't1' },
    });

    expect(id).toBe('sent-42@mail.gmail.com');
    expect(runConnectorAction).toHaveBeenCalledWith(
      SQL,
      expect.objectContaining({
        connector: 'gmail',
        action: 'get_message',
        input: { messageId: 'gmail-api-id-xyz' },
      }),
    );
  });

  it('keeps the Gmail API id when the read-back fails', async () => {
    runConnectorAction.mockRejectedValue(new Error('rate limited'));
    const id = await resolveSentExternalMessageId(SQL, {
      organizationId: 'o1',
      connector: 'gmail',
      connectorName: 'gmail',
      output: { id: 'gmail-api-id-xyz' },
    });
    expect(id).toBe('gmail-api-id-xyz');
  });

  it('does not read back for imap-smtp — its send already returns the RFC id', async () => {
    const id = await resolveSentExternalMessageId(SQL, {
      organizationId: 'o1',
      connector: 'imap-smtp',
      connectorName: 'imap-smtp',
      output: { messageId: '<sent-7@mail.example.com>' },
    });
    expect(id).toBe('sent-7@mail.example.com');
    expect(runConnectorAction).not.toHaveBeenCalled();
  });
});

/**
 * Which MAILBOX a reply leaves from.
 *
 * `connector_name` names the connector, never the account, and an
 * organization may hold several credentials on one connector. Without a
 * credential on the run the resolver falls through to the connector's
 * `is_default`, so a thread received on one mailbox could be answered from
 * another. The reply carries the credential recorded on the newest inbound
 * message, else on the newest outbound one (a thread composed in Tale). A
 * thread with none (its messages predate 0113) replies from the one active
 * mailbox whose address is the one the correspondent wrote to, and keeps the
 * old default-credential behaviour when no single mailbox claims it.
 */
describe('replyToConversation — the mailbox', () => {
  beforeEach(() => vi.clearAllMocks());

  const CONVERSATION = 'FROM app.conversations c';
  const CONVERSATION_ROW = 'FROM app.conversations WHERE id';
  /** The resolver's per-thread read; the recorded-credential subquery is a
   *  fragment inside it, recorded as its own statement by this double. */
  const CARRIED = 'AS "credentialId" FROM app.conversations';
  const RECORDED = 'm.credential_id IS NOT NULL';
  const MAILBOXES = 'FROM app.connector_credentials';
  /** The row `sendMessageViaConnectorInTx` re-reads inside the transaction. */
  const ROW = { id: 'c1', organizationId: 'o1', metadata: null };
  const EMAIL_ROW = {
    organizationId: 'o1',
    connectorName: 'imap-smtp',
    channel: 'email',
    subject: 'Order 42',
    contactEmail: 'carla@ext.test',
  };
  const REPLY = {
    conversationId: 'c1',
    organizationId: 'o1',
    content: '<p>On its way.</p>',
    actor: { userId: 'u1' },
  };

  function insertedCredential(statements: Statement[]): unknown {
    const insert = statements.find((st) =>
      st.text.includes('INSERT INTO app.conversation_messages'),
    );
    // `credential_id` is the 4th bound value on the outbound insert:
    // org, conversation, connector_name, credential_id.
    return insert?.values[3];
  }

  it('replies through the mailbox the newest inbound message recorded', async () => {
    const { sql, statements } = fakeSql({
      [CONVERSATION]: [EMAIL_ROW],
      [CONVERSATION_ROW]: [ROW],
      [CARRIED]: [{ conversationId: 'c1', credentialId: 'cred-b' }],
      'INSERT INTO app.conversation_messages': [{ id: 'm9' }],
    });

    await replyToConversation(sql, REPLY);

    expect(insertedCredential(statements)).toBe('cred-b');
    const [payload] = addJobInTx.mock.calls[0]?.slice(2) ?? [];
    expect(payload).toMatchObject({ credentialId: 'cred-b' });
  });

  it('falls back to the default credential when no message recorded one', async () => {
    const { sql, statements } = fakeSql({
      [CONVERSATION]: [EMAIL_ROW],
      [CONVERSATION_ROW]: [ROW],
      [CARRIED]: [],
      'INSERT INTO app.conversation_messages': [{ id: 'm9' }],
    });

    await replyToConversation(sql, REPLY);

    expect(insertedCredential(statements)).toBeNull();
    const [payload] = addJobInTx.mock.calls[0]?.slice(2) ?? [];
    expect(payload).not.toHaveProperty('credentialId');
  });

  it('ranks where they wrote above where we sent, newest first within each', async () => {
    const { sql, statements } = fakeSql({
      [CONVERSATION]: [EMAIL_ROW],
      [CONVERSATION_ROW]: [ROW],
      [CARRIED]: [{ conversationId: 'c1', credentialId: 'cred-b' }],
      'INSERT INTO app.conversation_messages': [{ id: 'm9' }],
    });

    await replyToConversation(sql, REPLY);

    // The ordering itself is proven on real Postgres (integration-check);
    // this pins that the statement carries it.
    const lookup = statements.find((st) => st.text.includes(RECORDED));
    expect(lookup?.text).toContain(
      "ORDER BY (m.direction = 'inbound') DESC, coalesce(m.sent_at_ms, m.delivered_at_ms, m.created_at_ms) DESC, m.seq DESC",
    );
    expect(lookup?.text).toContain('m.org_id = conversations.org_id');
  });

  /** An unrecorded thread the correspondent wrote to `hello@` at. */
  const OLD_EMAIL_ROW = {
    ...EMAIL_ROW,
    direction: 'inbound',
    metadata: { to: [{ address: 'Hello@Support.Test' }] },
  };
  const GENERAL = {
    id: 'cred-general',
    connectorSlug: 'imap-smtp',
    config: { fromAddress: 'hello@support.test' },
  };
  const RECRUITMENT = {
    id: 'cred-recruitment',
    connectorSlug: 'imap-smtp',
    config: { fromAddress: 'jobs@support.test' },
  };

  it('replies to an unrecorded thread from the mailbox its address names', async () => {
    const { sql, statements } = fakeSql({
      [CONVERSATION]: [OLD_EMAIL_ROW],
      [CONVERSATION_ROW]: [ROW],
      [CARRIED]: [],
      [MAILBOXES]: [RECRUITMENT, GENERAL],
      'INSERT INTO app.conversation_messages': [{ id: 'm9' }],
    });

    await replyToConversation(sql, REPLY);

    expect(insertedCredential(statements)).toBe('cred-general');
    const [payload] = addJobInTx.mock.calls[0]?.slice(2) ?? [];
    expect(payload).toMatchObject({ credentialId: 'cred-general' });
    // Only a mailbox that can still send is a candidate.
    const lookup = statements.find((st) => st.text.includes(MAILBOXES));
    expect(lookup?.text).toContain("status = 'active'");
  });

  it('prefers the recorded credential over the address', async () => {
    const { sql, statements } = fakeSql({
      [CONVERSATION]: [OLD_EMAIL_ROW],
      [CONVERSATION_ROW]: [ROW],
      [CARRIED]: [{ conversationId: 'c1', credentialId: 'cred-recruitment' }],
      [MAILBOXES]: [RECRUITMENT, GENERAL],
      'INSERT INTO app.conversation_messages': [{ id: 'm9' }],
    });

    await replyToConversation(sql, REPLY);

    expect(insertedCredential(statements)).toBe('cred-recruitment');
    expect(statements.some((st) => st.text.includes(MAILBOXES))).toBe(false);
  });

  it('keeps the default credential when two mailboxes claim the address', async () => {
    const { sql, statements } = fakeSql({
      [CONVERSATION]: [OLD_EMAIL_ROW],
      [CONVERSATION_ROW]: [ROW],
      [CARRIED]: [],
      [MAILBOXES]: [GENERAL, { ...RECRUITMENT, config: GENERAL.config }],
      'INSERT INTO app.conversation_messages': [{ id: 'm9' }],
    });

    await replyToConversation(sql, REPLY);

    expect(insertedCredential(statements)).toBeNull();
    const [payload] = addJobInTx.mock.calls[0]?.slice(2) ?? [];
    expect(payload).not.toHaveProperty('credentialId');
  });

  it('keeps the default credential when no mailbox has the address', async () => {
    const { sql, statements } = fakeSql({
      [CONVERSATION]: [OLD_EMAIL_ROW],
      [CONVERSATION_ROW]: [ROW],
      [CARRIED]: [],
      [MAILBOXES]: [RECRUITMENT],
      'INSERT INTO app.conversation_messages': [{ id: 'm9' }],
    });

    await replyToConversation(sql, REPLY);

    expect(insertedCredential(statements)).toBeNull();
  });
});

/**
 * What queueing a reply promises besides the message itself: it waits out
 * the undo window before its send job may start, and the drafted reply an
 * automation left on the conversation is settled by the person's send, in
 * the transaction that queues it.
 */
describe('replyToConversation — the queued reply', () => {
  beforeEach(() => vi.clearAllMocks());

  const THREAD = {
    'FROM app.conversations c': [
      {
        organizationId: 'o1',
        connectorName: 'imap-smtp',
        channel: 'email',
        subject: 'Order 42',
        contactEmail: 'carla@ext.test',
      },
    ],
    'FROM app.conversations WHERE id': [
      { id: 'c1', organizationId: 'o1', metadata: null },
    ],
    'INSERT INTO app.conversation_messages': [{ id: 'm9' }],
  };
  const REPLY = {
    conversationId: 'c1',
    organizationId: 'o1',
    content: '<p>On its way.</p>',
    actor: { userId: 'u1' },
  };
  const queuedMessage = (statements: Statement[]) =>
    statements.find((st) =>
      st.text.startsWith('INSERT INTO app.conversation_messages'),
    );

  it('holds a reply for 10 seconds before its send may start [CONV-R9]', async () => {
    // Unset, the window is the product's own: ten seconds.
    vi.stubEnv('CONVERSATION_UNDO_SEND_DELAY_MS', '');
    try {
      const { sql, statements } = fakeSql(THREAD);
      await replyToConversation(sql, REPLY);

      // org, conversation, connector_name, credential_id, content, sent_at,
      // delivered_at, metadata: the row is stamped when it was queued.
      const insert = queuedMessage(statements);
      const queuedAt = Number(insert?.values[5]);
      expect(Number.isFinite(queuedAt)).toBe(true);
      expect(insert?.values[7]).toMatchObject({
        scheduledSendAt: queuedAt + 10_000,
      });
      const [, options] = addJobInTx.mock.calls[0]?.slice(2) ?? [];
      expect(options).toEqual({ startAfter: new Date(queuedAt + 10_000) });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('completes the drafted reply waiting on the conversation [CONV-R12]', async () => {
    const { sql, statements } = fakeSql({
      ...THREAD,
      'FROM app.approvals': [
        { id: 'appr_1', metadata: { emailBody: 'A drafted answer.' } },
      ],
    });
    await replyToConversation(sql, REPLY);

    const settled = statements.find((st) =>
      st.text.startsWith('UPDATE app.approvals'),
    );
    expect(settled?.text).toContain("status = 'completed'");
    // approved_by, reviewed_at_ms, metadata, id: the person who sent, and
    // what they sent beside what was drafted.
    expect(settled?.values[0]).toBe('u1');
    expect(settled?.values[2]).toMatchObject({
      emailBody: 'A drafted answer.',
      sentContent: '<p>On its way.</p>',
      sentTo: ['carla@ext.test'],
      sentSubject: 'Re: Order 42',
    });
    expect(settled?.values[3]).toBe('appr_1');
    // In the reply's own transaction: a send that rolls back leaves the
    // draft waiting.
    expect(settled?.begin).not.toBeNull();
    expect(settled?.begin).toBe(queuedMessage(statements)?.begin);
  });

  it('settles nothing when no draft is waiting [CONV-R12]', async () => {
    const { sql, statements } = fakeSql(THREAD);
    await replyToConversation(sql, REPLY);

    expect(
      statements.some((st) => st.text.startsWith('UPDATE app.approvals')),
    ).toBe(false);
  });
});

/**
 * The composer sends an empty body beside files when nothing was typed — an
 * attachment-only email. The service queues it like any other send, and
 * refuses a send that carries neither a body nor a file before it reads or
 * writes anything, whichever caller reached it.
 */
describe('replyToConversation and composeEmailConversation — files alone', () => {
  beforeEach(() => vi.clearAllMocks());

  const FILE = {
    storageId: 'blob-1',
    fileName: 'invoice.pdf',
    contentType: 'application/pdf',
    size: 1024,
  };
  const threadOn = (channel: string) => ({
    'FROM app.conversations c': [
      {
        organizationId: 'o1',
        connectorName: 'imap-smtp',
        channel,
        subject: 'Order 42',
        contactEmail: 'carla@ext.test',
      },
    ],
    'FROM app.conversations WHERE id': [
      { id: 'c1', organizationId: 'o1', metadata: null },
    ],
    'INSERT INTO app.conversation_messages': [{ id: 'm9' }],
  });
  const reply = (sql: Sql, extra: Record<string, unknown>) =>
    replyToConversation(sql, {
      conversationId: 'c1',
      organizationId: 'o1',
      content: '',
      actor: { userId: 'u1', email: 'u@example.test' },
      ...extra,
    });
  const COMPOSE_ANSWERS = {
    'email FROM app.contacts': [
      { organizationId: 'o1', email: 'carla@ext.test' },
    ],
    'INSERT INTO app.conversations': [{ id: 'c-new' }],
    'FROM app.conversations WHERE id = ?': [
      { id: 'c-new', organizationId: 'o1', metadata: null },
    ],
    'INSERT INTO app.conversation_messages': [{ id: 'm-new' }],
  };
  const compose = (sql: Sql, extra: Record<string, unknown>) =>
    composeEmailConversation(sql, {
      organizationId: 'o1',
      contactId: 'ct1',
      connectorName: 'imap-smtp',
      subject: 'Invoice',
      content: '',
      actor: { userId: 'u1', role: 'member' },
      ...extra,
    });

  /** The outbound row's `content` and `metadata`, by bound position: org,
   * conversation, connector_name, credential_id, content, sent_at,
   * delivered_at, metadata. */
  function insertedMessage(statements: Statement[]) {
    const insert = statements.find((st) =>
      st.text.startsWith('INSERT INTO app.conversation_messages'),
    );
    return { content: insert?.values[4], metadata: insert?.values[7] };
  }

  it('queues an email reply with an empty body and its files', async () => {
    const { sql, statements } = fakeSql(threadOn('email'));

    await expect(reply(sql, { attachments: [FILE] })).resolves.toBe('m9');

    const message = insertedMessage(statements);
    expect(message.content).toBe('');
    expect(message.metadata).toMatchObject({
      sendContentType: 'Text',
      attachments: [
        expect.objectContaining({
          storageId: 'blob-1',
          filename: 'invoice.pdf',
        }),
      ],
    });
    // The files are proven the sender's own inside the send's transaction,
    // where the proof's stamp rolls back with any refusal (#4111).
    expect(assertOwnedAttachments).toHaveBeenCalledWith(
      expect.anything(),
      { organizationId: 'o1', userId: 'u1' },
      [FILE],
    );
    const [payload] = addJobInTx.mock.calls[0]?.slice(2) ?? [];
    // An empty plain-text part beside the file: every mail connector sends
    // that as a body-less email with its attachment.
    expect(payload).toMatchObject({
      to: ['carla@ext.test'],
      body: '',
      contentType: 'Text',
      attachments: [
        {
          storageRef: 'blob-1',
          fileName: 'invoice.pdf',
          contentType: 'application/pdf',
          size: 1024,
        },
      ],
    });
  });

  it('hands an API thread an empty body and its files', async () => {
    const { sql } = fakeSql(threadOn('api'));

    await expect(reply(sql, { attachments: [FILE] })).resolves.toBe('m-api');

    expect(queueApiReply).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({ content: '', body: '', attachments: [FILE] }),
    );
  });

  it('queues a new email with an empty body and its files', async () => {
    const { sql, statements, begins } = fakeSql(COMPOSE_ANSWERS);

    await expect(compose(sql, { attachments: [FILE] })).resolves.toEqual({
      conversationId: 'c-new',
      messageId: 'm-new',
    });

    expect(begins).toEqual([{ status: 'committed' }]);
    expect(insertedMessage(statements).content).toBe('');
    const [payload] = addJobInTx.mock.calls[0]?.slice(2) ?? [];
    expect(payload).toMatchObject({
      body: '',
      contentType: 'Text',
      attachments: [expect.objectContaining({ storageRef: 'blob-1' })],
    });
  });

  // Both doors hold an email's files to the same two checks: each file is
  // the sender's own upload, and the set stays within the email's limits.
  it('proves the files of a reply and of a new email the sender’s own [CONV-R11]', async () => {
    const owned = [
      expect.anything(),
      { organizationId: 'o1', userId: 'u1' },
      [FILE],
    ];
    await reply(fakeSql(threadOn('email')).sql, { attachments: [FILE] });
    expect(assertOwnedAttachments).toHaveBeenCalledWith(...owned);

    vi.clearAllMocks();
    await compose(fakeSql(COMPOSE_ANSWERS).sql, { attachments: [FILE] });
    expect(assertOwnedAttachments).toHaveBeenCalledWith(...owned);
  });

  it('refuses an eleventh file on a reply and on a new email before writing anything [CONV-R11]', async () => {
    const files = Array.from({ length: 11 }, (_, index) => ({
      ...FILE,
      storageId: `blob-${index}`,
    }));
    const tooMany = { data: { code: 'CONVERSATION_ATTACHMENTS_TOO_MANY' } };

    const replied = fakeSql(threadOn('email'));
    await expect(
      reply(replied.sql, { attachments: files }),
    ).rejects.toMatchObject(tooMany);
    const composed = fakeSql(COMPOSE_ANSWERS);
    await expect(
      compose(composed.sql, { attachments: files }),
    ).rejects.toMatchObject(tooMany);

    for (const { statements } of [replied, composed]) {
      expect(statements.some((st) => /^(INSERT|UPDATE)/.test(st.text))).toBe(
        false,
      );
    }
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it.each([
    ['no attachments', {}],
    ['an empty attachment list', { attachments: [] }],
  ])('refuses an empty body with %s before any statement', async (_, extra) => {
    const replied = fakeSql(threadOn('email'));
    await expect(reply(replied.sql, extra)).rejects.toMatchObject({
      code: 'reply_content_required',
      status: 400,
    });
    expect(replied.statements).toEqual([]);

    const composed = fakeSql(COMPOSE_ANSWERS);
    await expect(compose(composed.sql, extra)).rejects.toMatchObject({
      code: 'compose_content_required',
      status: 400,
    });
    expect(composed.statements).toEqual([]);

    expect(addJobInTx).not.toHaveBeenCalled();
    expect(queueApiReply).not.toHaveBeenCalled();
  });
});

describe('runSendMessageJob — the credential', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends through the recorded credential rather than the connector default', async () => {
    runConnectorAction.mockResolvedValue({
      status: 'ok',
      output: { messageId: '<smtp-1@door.test>' },
    });
    const { sql } = fakeSql({
      [CLAIM]: [QUEUED_ROW],
      [SETTLE]: [{ id: 'm1' }],
    });

    await runSendMessageJob(sql, { ...JOB_PAYLOAD, credentialId: 'cred-b' });

    expect(runConnectorAction.mock.calls[0]?.[1]).toMatchObject({
      credentialRef: 'cred-b',
    });
  });

  it('leaves the credential unset when the payload carries none', async () => {
    runConnectorAction.mockResolvedValue({
      status: 'ok',
      output: { messageId: '<smtp-1@door.test>' },
    });
    const { sql } = fakeSql({
      [CLAIM]: [QUEUED_ROW],
      [SETTLE]: [{ id: 'm1' }],
    });

    await runSendMessageJob(sql, JOB_PAYLOAD);

    expect(runConnectorAction.mock.calls[0]?.[1]).not.toHaveProperty(
      'credentialRef',
    );
  });
});

/**
 * A send and a recalled send rewrite the conversation's summary from a read
 * of the row, so they read it `FOR UPDATE` in the transaction that writes it
 * back — the rule in `service.ts`'s module doc. Unlocked, a reply beside an
 * inbound message wrote back the unread count it had read (#3735).
 */
describe('the send lane rewrites the summary from a locked read', () => {
  beforeEach(() => vi.clearAllMocks());
  const actor = { userId: 'u1' };
  const LOAD = 'FROM app.conversation_messages WHERE id = ? LIMIT 1';

  function lockedReadBeforeUpdate(statements: Statement[]): Statement {
    const update = statements.findIndex((st) =>
      st.text.startsWith('UPDATE app.conversations SET'),
    );
    expect(update, 'the summary is rewritten').toBeGreaterThan(-1);
    const read = statements
      .slice(0, update)
      .findLast(
        (st) =>
          st.text.startsWith('SELECT') &&
          st.text.includes('FROM app.conversations WHERE id = ?'),
      );
    expect(read, 'the row is read first').toBeDefined();
    // oxlint-disable-next-line typescript/no-non-null-assertion -- asserted defined above
    return read!;
  }

  it('when a reply is queued', async () => {
    const { sql, statements } = fakeSql({
      'FROM app.conversations c': [
        {
          organizationId: 'o1',
          connectorName: 'imap-smtp',
          channel: 'email',
          subject: 'Order 42',
          contactEmail: 'carla@ext.test',
        },
      ],
      'FROM app.conversations WHERE id': [
        { id: 'c1', organizationId: 'o1', metadata: { unread_count: 2 } },
      ],
      'INSERT INTO app.conversation_messages': [{ id: 'm9' }],
    });
    await replyToConversation(sql, {
      conversationId: 'c1',
      organizationId: 'o1',
      content: '<p>On its way.</p>',
      actor,
    });
    const read = lockedReadBeforeUpdate(statements);
    expect(read.text).toMatch(/ FOR UPDATE$/);
    expect(read.begin).not.toBeNull();
  });

  it.each([
    [
      'an undo',
      QUEUED_ROW,
      "AND delivery_state = 'queued'",
      (sql: Sql) =>
        undoSendMessage(sql, { organizationId: 'o1', messageId: 'm1', actor }),
    ],
    [
      'a discard',
      { ...QUEUED_ROW, deliveryState: 'failed' as const },
      "AND delivery_state = 'failed'",
      (sql: Sql) =>
        discardOutboundMessage(sql, {
          organizationId: 'o1',
          messageId: 'm1',
          actor,
        }),
    ],
  ])('when %s walks the activity time back', async (_, row, remove, run) => {
    const { sql, statements } = fakeSql({
      [LOAD]: [row],
      [remove]: [{ id: 'm1' }],
      'AS "createdAt" FROM app.conversations': [
        { metadata: { unread_count: 2 }, createdAt: 500 },
      ],
    });
    await run(sql);
    const read = lockedReadBeforeUpdate(statements);
    expect(read.text).toMatch(/ FOR UPDATE$/);
    expect(read.begin).not.toBeNull();
  });
});
