/**
 * Replying on a channel that is not email.
 *
 * The send lane assumed mail everywhere: it needed a contact ADDRESS, put `Re:`
 * on the subject, walked the thread for a previous Message-ID, and stamped
 * every outbound row `channel: 'email'` whatever the conversation said. A
 * conversation opened by a product that owns its own customer surface has an id
 * where the address would be and no mail thread to join.
 *
 * The email path is the one that must not move, so it is asserted here beside
 * the new one: same recipient, same `Re:`, same threading headers, same stamped
 * channel.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The enqueued send payloads, in order — what the connector will be handed. */
const { createAuditLog, addJobInTx, emitHintInTx, enqueued } = vi.hoisted(
  () => {
    const sent: Record<string, unknown>[] = [];
    return {
      enqueued: sent,
      createAuditLog: vi.fn(async () => undefined),
      addJobInTx: vi.fn(
        async (
          _tx: unknown,
          _queue: string,
          payload: Record<string, unknown>,
        ) => {
          sent.push(payload);
          return 'job-1';
        },
      ),
      emitHintInTx: vi.fn(async () => undefined),
    };
  },
);

vi.mock('../connectors/service.ts', () => ({ runConnectorAction: vi.fn() }));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog }));
vi.mock('../files/service.ts', () => ({ getFileUrl: vi.fn() }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx }));
vi.mock('../events/emit.ts', () => ({
  emitEvent: vi.fn(async () => undefined),
}));
vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx }));

import { replyToConversation } from './send.ts';

interface ReplyRow {
  organizationId: string;
  connectorName: string | null;
  credentialId: string | null;
  subject: string | null;
  channel: string | null;
  contactEmail: string | null;
  contactExternalId: string | null;
}

const EMAIL_ROW: ReplyRow = {
  organizationId: 'o1',
  connectorName: 'imap-smtp',
  credentialId: null,
  subject: 'Order 42',
  channel: 'email',
  contactEmail: 'buyer@example.com',
  contactExternalId: null,
};

const CHANNEL_ROW: ReplyRow = {
  organizationId: 'o1',
  connectorName: 'webhook-channel',
  credentialId: 'cred_product_a',
  subject: 'Payment not reflecting',
  channel: 'api',
  contactEmail: null,
  contactExternalId: 'user_42',
};

const ACTOR = { userId: 'u_agent', email: 'agent@desk.test' };

/**
 * A sql double covering the two reads the reply makes: its own join for the
 * recipient, and the conversation load inside the send transaction. The
 * conversation's stored `externalMessageId` is set so a mail reply has a
 * previous Message-ID to thread onto — and a channel reply has one available
 * that it must NOT use.
 */
function replySql(row: ReplyRow) {
  const statements: { text: string; values: unknown[] }[] = [];
  const answer = (text: string): unknown[] => {
    if (text.includes('LEFT JOIN app.contacts')) return [row];
    if (text.includes('FROM app.conversations')) {
      return [
        {
          id: 'c1',
          organizationId: 'o1',
          contactId: 'ct1',
          credentialId: row.credentialId,
          externalMessageId: '<root@mail.test>',
          subject: row.subject,
          status: 'open',
          channel: row.channel,
          connectorName: row.connectorName,
          lastMessageAt: 1_000,
          metadata: {},
          createdAt: 1_000,
        },
      ];
    }
    if (text.includes('FROM app.conversation_messages')) {
      return [{ externalMessageId: '<previous@mail.test>' }];
    }
    if (text.includes('INSERT INTO app.conversation_messages')) {
      return [{ id: 'm1' }];
    }
    return [];
  };
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    return Promise.resolve(answer(text));
  };
  const sql = Object.assign(tag, {
    unsafe: (text: string) => text,
    json: (value: unknown) => value,
    begin: (fn: (tx: unknown) => Promise<unknown>) => fn(sql),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
  return { sql: sql as unknown as Sql, statements };
}

const jobPayload = () => enqueued.at(-1);

const insertOf = (statements: { text: string; values: unknown[] }[]) =>
  statements.find((s) =>
    s.text.includes('INSERT INTO app.conversation_messages'),
  );

beforeEach(() => {
  enqueued.length = 0;
  vi.mocked(addJobInTx).mockClear();
  vi.mocked(createAuditLog).mockClear();
});

describe('replyToConversation on the email channel (unchanged)', () => {
  it('answers the contact address with a Re: subject', async () => {
    const { sql } = replySql(EMAIL_ROW);
    await replyToConversation(sql, {
      conversationId: 'c1',
      organizationId: 'o1',
      content: 'On its way.',
      actor: ACTOR,
    });
    expect(jobPayload()).toMatchObject({
      to: ['buyer@example.com'],
      subject: 'Re: Order 42',
    });
  });

  it('still carries the threading headers that join the mail thread', async () => {
    const { sql } = replySql(EMAIL_ROW);
    await replyToConversation(sql, {
      conversationId: 'c1',
      organizationId: 'o1',
      content: 'On its way.',
      actor: ACTOR,
    });
    expect(jobPayload()).toMatchObject({ inReplyTo: '<previous@mail.test>' });
  });

  it('refuses when the contact has no address', async () => {
    const { sql } = replySql({ ...EMAIL_ROW, contactEmail: null });
    await expect(
      replyToConversation(sql, {
        conversationId: 'c1',
        organizationId: 'o1',
        content: 'On its way.',
        actor: ACTOR,
      }),
    ).rejects.toMatchObject({ code: 'customer_email_not_found', status: 409 });
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('refuses a placeholder address rather than mailing it', async () => {
    const { sql } = replySql({
      ...EMAIL_ROW,
      contactEmail: 'unknown@example.com',
    });
    await expect(
      replyToConversation(sql, {
        conversationId: 'c1',
        organizationId: 'o1',
        content: 'On its way.',
        actor: ACTOR,
      }),
    ).rejects.toMatchObject({ code: 'customer_email_not_found' });
  });
});

describe('replyToConversation off the email channel', () => {
  it("answers the contact's external id, not an address", async () => {
    const { sql } = replySql(CHANNEL_ROW);
    await replyToConversation(sql, {
      conversationId: 'c1',
      organizationId: 'o1',
      content: 'Credited.',
      actor: ACTOR,
    });
    expect(jobPayload()).toMatchObject({ to: ['user_42'] });
  });

  it('leaves the subject alone — there is no mail header to prefix', async () => {
    const { sql } = replySql(CHANNEL_ROW);
    await replyToConversation(sql, {
      conversationId: 'c1',
      organizationId: 'o1',
      content: 'Credited.',
      actor: ACTOR,
    });
    expect(jobPayload()).toMatchObject({ subject: 'Payment not reflecting' });
  });

  it('sends no threading headers even though the row carries a Message-ID', async () => {
    const { sql } = replySql(CHANNEL_ROW);
    await replyToConversation(sql, {
      conversationId: 'c1',
      organizationId: 'o1',
      content: 'Credited.',
      actor: ACTOR,
    });
    const payload = jobPayload();
    expect(payload).not.toHaveProperty('inReplyTo');
    expect(payload).not.toHaveProperty('references');
  });

  it("stamps the outbound row with the conversation's channel", async () => {
    const { sql, statements } = replySql(CHANNEL_ROW);
    await replyToConversation(sql, {
      conversationId: 'c1',
      organizationId: 'o1',
      content: 'Credited.',
      actor: ACTOR,
    });
    expect(insertOf(statements)?.values).toContain('api');
  });

  it('refuses when the contact carries no external id to answer', async () => {
    const { sql } = replySql({ ...CHANNEL_ROW, contactExternalId: null });
    await expect(
      replyToConversation(sql, {
        conversationId: 'c1',
        organizationId: 'o1',
        content: 'Credited.',
        actor: ACTOR,
      }),
    ).rejects.toMatchObject({
      code: 'customer_reference_not_found',
      status: 409,
    });
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('still refuses a conversation with no connector at all', async () => {
    const { sql } = replySql({ ...CHANNEL_ROW, connectorName: null });
    await expect(
      replyToConversation(sql, {
        conversationId: 'c1',
        organizationId: 'o1',
        content: 'Credited.',
        actor: ACTOR,
      }),
    ).rejects.toMatchObject({ code: 'conversation_connector_missing' });
  });
});

/**
 * WHICH instance a reply goes back to.
 *
 * A conversation records its connector, and the send lane used to call that
 * connector without naming a credential — which resolves to the organization's
 * DEFAULT one for the slug. On email the mailbox travels in the thread, so the
 * reply still reaches the right person. An external channel's destination lives
 * only on its credential, so an org running two products through one Inbox
 * would deliver one product's customer reply to the other product's server.
 */
describe('replyToConversation names the credential it arrived on', () => {
  it('sends through the credential stamped on the conversation', async () => {
    const { sql } = replySql(CHANNEL_ROW);
    await replyToConversation(sql, {
      conversationId: 'c1',
      organizationId: 'o1',
      content: 'Credited.',
      actor: ACTOR,
    });
    expect(jobPayload()).toMatchObject({ credentialRef: 'cred_product_a' });
  });

  it('keeps two products on one connector apart', async () => {
    for (const credentialId of ['cred_product_a', 'cred_product_b']) {
      const { sql } = replySql({ ...CHANNEL_ROW, credentialId });
      await replyToConversation(sql, {
        conversationId: 'c1',
        organizationId: 'o1',
        content: 'Credited.',
        actor: ACTOR,
      });
      expect(jobPayload()).toMatchObject({ credentialRef: credentialId });
    }
  });

  it('names none for a conversation that carries none, so the default still resolves', async () => {
    const { sql } = replySql(EMAIL_ROW);
    await replyToConversation(sql, {
      conversationId: 'c1',
      organizationId: 'o1',
      content: 'On its way.',
      actor: ACTOR,
    });
    expect(jobPayload()).not.toHaveProperty('credentialRef');
  });

  it('stamps it on the message so a retry cannot fall back to the default', async () => {
    const { sql, statements } = replySql(CHANNEL_ROW);
    await replyToConversation(sql, {
      conversationId: 'c1',
      organizationId: 'o1',
      content: 'Credited.',
      actor: ACTOR,
    });
    const metadata = insertOf(statements)?.values.find(
      (value): value is Record<string, unknown> =>
        typeof value === 'object' && value !== null && 'credentialRef' in value,
    );
    expect(metadata).toMatchObject({ credentialRef: 'cred_product_a' });
  });
});
