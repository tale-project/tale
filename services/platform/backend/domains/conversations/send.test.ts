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

const { runConnectorAction, createAuditLog, addJobInTx, emitHintInTx } =
  vi.hoisted(() => ({
    runConnectorAction: vi.fn(),
    createAuditLog: vi.fn(async () => undefined),
    addJobInTx: vi.fn(async () => 'job-1'),
    emitHintInTx: vi.fn(async () => undefined),
  }));

vi.mock('../connectors/service.ts', () => ({ runConnectorAction }));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog }));
vi.mock('../files/service.ts', () => ({ getFileUrl: vi.fn() }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx }));
vi.mock('../events/emit.ts', () => ({
  emitEvent: vi.fn(async () => undefined),
}));
vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx }));

import {
  composeEmailConversation,
  discardOutboundMessage,
  resolveSentExternalMessageId,
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

  it('does not send when the row cannot be claimed (undone, settled, or already claimed)', async () => {
    const { sql, statements } = fakeSql({ [CLAIM]: [] });
    await runSendMessageJob(sql, JOB_PAYLOAD);
    expect(runConnectorAction).not.toHaveBeenCalled();
    expect(statements.some((s) => s.text.includes(SETTLE))).toBe(false);
  });

  it('claims the queued row in one conditional update, then sends and settles it', async () => {
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
});

describe('undoSendMessage — after the claim', () => {
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
    ).resolves.toEqual({ sourceMarkdown: null });
    const deletes = statements.filter((s) => s.text.startsWith('DELETE'));
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.text).toContain("delivery_state = 'queued'");
    expect(deletes[0]?.text).toContain("metadata->>'sendClaimedAt' IS NULL");
    expect(deletes[0]?.values).toEqual(['m1', 'o1']);
    expect(createAuditLog).toHaveBeenCalledTimes(1);
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
