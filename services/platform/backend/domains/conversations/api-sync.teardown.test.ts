// @vitest-environment node

/**
 * A `deleted: true` snapshot closes the mirror and nothing else. The
 * reference promises "Closing preserves the conversation and messages in
 * the Inbox"; the reconcile loop used to run over the teardown's empty
 * message list and hard-delete every receipted message, so the Closed tab
 * read "No messages yet" one step after showing the transcript.
 */

import type { Sql, TransactionSql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

const { transactSerializable, emitHintInTx } = vi.hoisted(() => ({
  transactSerializable: vi.fn(),
  emitHintInTx: vi.fn(async () => undefined),
}));
vi.mock('@tale/shared/db/serializable', () => ({ transactSerializable }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx }));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));

import { apiSnapshotSchema, synchronizeConversation } from './api-sync.ts';

interface Statement {
  text: string;
  values: unknown[];
}

/** A transaction double answering the binding read with a live mirror at
 * version 2 (or that mirror as `binding` changes it) and recording every
 * statement the sync issues. */
function txDouble(
  binding: { ownerUserId?: string; sourceDeleted?: boolean } = {},
) {
  const statements: Statement[] = [];
  const tag = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.includes('FROM app.conversation_api_bindings')) {
      return Promise.resolve([
        {
          conversationId: 'conv-1',
          ownerUserId: 'user-1',
          externalContactId: 'crm:contact-1',
          version: '2',
          hash: 'h2',
          sourceDeleted: false,
          ...binding,
        },
      ]);
    }
    return Promise.resolve([]);
  };
  const tx = Object.assign(tag, {
    unsafe: (text: string) => text,
    json: (value: unknown) => value,
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js transaction tag
  return { tx: tx as unknown as TransactionSql, statements };
}

// The pre-transaction read (known attachment sizes) answers nothing.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
const sql = (() => Promise.resolve([])) as unknown as Sql;

const viewer = { organizationId: 'org-1', userId: 'user-1', role: 'admin' };

const teardown = apiSnapshotSchema.parse({
  source: 'crm',
  externalId: 'thread-1',
  externalContactId: 'crm:contact-1',
  version: 3,
  subject: 'Order 4711',
  status: 'closed',
  deleted: true,
  messages: [],
});

describe('a deleted snapshot', () => {
  it('closes the mirror and leaves every mirrored message in place [CONV-R15]', async () => {
    const { tx, statements } = txDouble();
    transactSerializable.mockImplementation(
      async (_sql: Sql, run: (tx: TransactionSql) => Promise<unknown>) =>
        run(tx),
    );

    await expect(
      synchronizeConversation(sql, viewer, teardown),
    ).resolves.toEqual({ conversationId: 'conv-1', applied: true });

    // No message row is read, written or deleted.
    expect(
      statements.some((s) => s.text.includes('app.conversation_messages')),
    ).toBe(false);
    expect(statements.some((s) => s.text.startsWith('DELETE'))).toBe(false);
    // The conversation is closed and the binding records the teardown.
    expect(
      statements.some((s) =>
        s.text.startsWith("UPDATE app.conversations SET status = 'closed'"),
      ),
    ).toBe(true);
    const binding = statements.find((s) =>
      s.text.startsWith(
        'UPDATE app.conversation_api_bindings SET snapshot_version',
      ),
    );
    expect(binding?.text).toContain('source_deleted = true');
    expect(binding?.values[0]).toBe(3);
    expect(emitHintInTx).toHaveBeenCalledTimes(1);
  });
});

/** The next content the source sends for the same conversation. */
const content = apiSnapshotSchema.parse({
  source: 'crm',
  externalId: 'thread-1',
  externalContactId: 'crm:contact-1',
  version: 3,
  subject: 'Order 4711',
  status: 'open',
  messages: [
    {
      externalId: 'm-9',
      content: 'One more thing.',
      isCustomer: true,
      authorName: 'Carla',
      createdAt: 1_789_230_000_000,
    },
  ],
});

/** Runs the sync on `tx` and answers what it refused with. */
function refusal(tx: TransactionSql, snapshot: typeof content) {
  transactSerializable.mockImplementation(
    async (_sql: Sql, run: (tx: TransactionSql) => Promise<unknown>) => run(tx),
  );
  return synchronizeConversation(sql, viewer, snapshot).then(
    () => undefined,
    (error: unknown) => error,
  );
}

const wrote = (statements: Statement[]) =>
  statements.some((s) => /^(INSERT|UPDATE|DELETE)/.test(s.text));

describe('a mirror its source closed', () => {
  it('takes no more content and stays closed [CONV-R15]', async () => {
    const { tx, statements } = txDouble({ sourceDeleted: true });

    expect(await refusal(tx, content)).toMatchObject({
      name: 'ConversationError',
      code: 'CONVERSATION_CLOSED',
      status: 409,
    });
    // Nothing reopened it and no message landed.
    expect(wrote(statements)).toBe(false);
  });
});

describe('a mirror another API key user created', () => {
  it.each([
    ['a content snapshot', content],
    ['a teardown', teardown],
  ])('refuses %s and changes nothing [CONV-R14]', async (_kind, snapshot) => {
    const { tx, statements } = txDouble({ ownerUserId: 'user-2' });

    expect(await refusal(tx, snapshot)).toMatchObject({
      name: 'ConversationError',
      code: 'INTEGRATION_NOT_OWNED',
      status: 403,
    });
    expect(wrote(statements)).toBe(false);
  });
});
