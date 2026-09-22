/**
 * The input contract for a drafted reply.
 *
 * Everything past these guards is one INSERT against app.approvals and is
 * covered by the integration check, which has a database. These run first and
 * touch none, so they belong here: a caller that sends an empty or oversized
 * body must be refused before a transaction is opened.
 */

import type { Sql, TransactionSql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import { completePendingDraftInTx, draftReplyToConversation } from './draft.ts';

function sqlThatMustNotRun(): Sql {
  const begin = vi.fn(() => {
    throw new Error('a refused draft must not open a transaction');
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only `begin` is reachable from the guards under test
  return { begin } as unknown as Sql;
}

const BASE = {
  organizationId: 'org_1',
  conversationId: 'conv_1',
};

describe('draftReplyToConversation', () => {
  it('refuses an empty body before opening a transaction', async () => {
    await expect(
      draftReplyToConversation(sqlThatMustNotRun(), {
        ...BASE,
        emailBody: '',
      }),
    ).rejects.toMatchObject({ code: 'draft_empty', status: 400 });
  });

  it('refuses a body that is only whitespace', async () => {
    await expect(
      draftReplyToConversation(sqlThatMustNotRun(), {
        ...BASE,
        emailBody: '   \n\t ',
      }),
    ).rejects.toMatchObject({ code: 'draft_empty' });
  });

  it('refuses a body past the cap', async () => {
    await expect(
      draftReplyToConversation(sqlThatMustNotRun(), {
        ...BASE,
        emailBody: 'x'.repeat(25_001),
      }),
    ).rejects.toMatchObject({ code: 'draft_too_long', status: 400 });
  });

  it('accepts a body at the cap once trimmed', async () => {
    const begin = vi.fn(() =>
      Promise.resolve({ approvalId: 'a', created: true }),
    );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only `begin` is reachable here
    const sql = { begin } as unknown as Sql;

    await draftReplyToConversation(sql, {
      ...BASE,
      emailBody: `  ${'x'.repeat(25_000)}  `,
    });

    expect(begin).toHaveBeenCalledOnce();
  });
});

/** A transaction double that answers the pending read and records the write. */
function txDouble(
  pending: { id: string; metadata: Record<string, unknown> }[],
) {
  const statements: { text: string; values: unknown[] }[] = [];
  const tx = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?').replace(/\s+/g, ' ').trim();
      statements.push({ text, values });
      return Promise.resolve(text.startsWith('SELECT') ? pending : []);
    },
    { json: (value: unknown) => ({ json: value }) },
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { tx: tx as unknown as TransactionSql, statements };
}

describe('completePendingDraftInTx', () => {
  // The API lane used to skip this: a sent and acknowledged reply left the
  // draft pending, so the composer re-offered it on every reload (CONV-F13).
  it('completes the pending draft with the send receipt', async () => {
    const { tx, statements } = txDouble([
      { id: 'appr_1', metadata: { emailBody: 'draft', source: 'crm' } },
    ]);
    await expect(
      completePendingDraftInTx(tx, {
        conversationId: 'conv_1',
        actorUserId: 'user_1',
        sentAt: 1_700_000_000_000,
        receipt: {
          sentContent: 'final',
          deliveryMessageId: 'msg_9',
          sentTo: undefined,
        },
      }),
    ).resolves.toEqual({ approvalId: 'appr_1' });
    const update = statements.find((s) => s.text.startsWith('UPDATE'));
    expect(update?.text).toContain("status = 'completed'");
    expect(update?.values).toEqual([
      'user_1',
      1_700_000_000_000,
      {
        json: {
          emailBody: 'draft',
          source: 'crm',
          sentContent: 'final',
          deliveryMessageId: 'msg_9',
          sentAt: 1_700_000_000_000,
        },
      },
      'appr_1',
    ]);
  });

  it('is a no-op when nothing is pending', async () => {
    const { tx, statements } = txDouble([]);
    await expect(
      completePendingDraftInTx(tx, {
        conversationId: 'conv_1',
        actorUserId: 'user_1',
        sentAt: 1,
        receipt: { sentContent: 'x' },
      }),
    ).resolves.toBeNull();
    expect(statements.filter((s) => s.text.startsWith('UPDATE'))).toEqual([]);
  });
});
