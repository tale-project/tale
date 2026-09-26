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
 * version 2 and recording every statement the sync issues. */
function txDouble() {
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
  it('closes the mirror and leaves every mirrored message in place', async () => {
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
