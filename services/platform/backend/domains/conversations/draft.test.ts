/**
 * The input contract for a drafted reply.
 *
 * Everything past these guards is one INSERT against app.approvals and is
 * covered by the integration check, which has a database. These run first and
 * touch none, so they belong here: a caller that sends an empty or oversized
 * body must be refused before a transaction is opened.
 */

import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import { draftReplyToConversation } from './draft.ts';

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
