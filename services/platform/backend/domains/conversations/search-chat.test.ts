/**
 * The chat assistant's conversation search must stay bounded as the address
 * book grows. Mail ingest mints a contact per correspondent, and the contact
 * leg used to load EVERY contact in the org on every query and match in JS;
 * it now prefilters in SQL (a superset of what the reused matcher keeps) and
 * reads a recency-bounded candidate set, like the other two legs.
 */

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { searchConversationsForChat } from './search-chat.ts';

/** A `sql` stand-in scripted per query, in call order, recording each
 * statement's text and parameter values. */
function scriptedSql(script: unknown[][]) {
  const statements: { text: string; values: unknown[] }[] = [];
  let index = 0;
  const tag = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    statements.push({
      text: strings.join('?').replace(/\s+/g, ' ').trim(),
      values,
    });
    const rows = script[index] ?? [];
    index += 1;
    return Promise.resolve(rows);
  };
  const double = Object.assign(tag, { unsafe: (text: string) => text });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
  return { sql: double as unknown as Sql, statements };
}

const CONVERSATION = {
  _id: 'conv_1',
  subject: 'Invoice question',
  status: 'open',
  channel: 'email',
  lastMessageAt: 1_000,
  assigneeUserId: 'user_1',
  assigneeTeamId: null,
  contactId: 'contact_anna',
};

describe('searchConversationsForChat — the contact leg', () => {
  it('prefilters contacts in SQL, bounded and newest-first, then confirms with the matcher', async () => {
    const { sql, statements } = scriptedSql([
      [{ role: 'member' }], // the caller's membership
      [
        { _id: 'contact_anna', name: 'Anna Lee', email: 'anna@ext.test' },
        // Prefilter superset: "brianna" contains "anna" mid-word, which the
        // 'any' matcher (word-start or better) drops again.
        { _id: 'contact_bri', name: 'Brianna Ext', email: 'b@ext.test' },
      ],
      [], // the message-body pre-pass
      [
        CONVERSATION,
        { ...CONVERSATION, _id: 'conv_2', contactId: 'contact_bri' },
      ],
    ]);

    const result = await searchConversationsForChat(sql, {
      organizationId: 'org_1',
      userId: 'user_1',
      term: 'what did anna from acme_corp say about the 50% discount',
      limit: 10,
    });

    const contactQuery = statements[1];
    expect(contactQuery?.text).toContain('FROM app.contacts');
    expect(contactQuery?.text).toContain('ILIKE ANY(');
    expect(contactQuery?.text).toContain('ORDER BY created_at_ms DESC');
    expect(contactQuery?.text).toContain('LIMIT');
    // Function words never reach SQL; `_` and `%` are escaped so they match
    // themselves rather than any character / any run of characters.
    const patterns = contactQuery?.values.find((value) => Array.isArray(value));
    expect(patterns).toEqual(
      expect.arrayContaining(['%anna%', '%acme\\_corp%', '%50\\%%']),
    );
    expect(patterns).not.toEqual(
      expect.arrayContaining(['%what%', '%the%', '%about%']),
    );
    expect(contactQuery?.values).toContain(500);

    // Only the word-start hit survives the matcher, so only its conversation
    // is answered by the contact leg.
    expect(result.conversations.map((hit) => hit._id)).toEqual(['conv_1']);
  });

  it('reads no contacts at all for a question made only of function words', async () => {
    const { sql, statements } = scriptedSql([
      [{ role: 'admin' }],
      [], // body pre-pass
      [], // conversation scan
    ]);
    await searchConversationsForChat(sql, {
      organizationId: 'org_1',
      userId: 'user_1',
      term: 'what do we have',
      limit: 10,
    });
    expect(
      statements.some((statement) => statement.text.includes('app.contacts')),
    ).toBe(false);
  });
});
