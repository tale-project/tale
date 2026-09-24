/**
 * The Inbox filter for one mailbox must list exactly the threads the Inbox
 * names as that mailbox — the ones `resolveThreadCredentials` places on it.
 *
 * The resolver decides in TypeScript for the threads it is handed; a keyset
 * page and a count cannot hand every row to it, so the filter repeats the rule
 * in SQL. These tests pin that repetition: the recorded-credential subquery is
 * ONE fragment every statement shares, the filter sits in the statement that
 * pages, and answer 2's address is bound only when the resolver would match
 * it. The rule itself is proven on real Postgres (`checkInboxMailboxFilter`).
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../auth/membership.ts', () => ({
  getUserTeamIds: vi.fn(async () => []),
  findOrganizationMember: vi.fn(async () => null),
}));
vi.mock('../files/service.ts', () => ({
  getFileUrl: vi.fn(async () => ''),
  statOrgBlob: vi.fn(async () => ({ size: 0 })),
}));
vi.mock('../../realtime/outbox.ts', () => ({
  emitHintInTx: vi.fn(async () => undefined),
}));

import {
  countConversationsByStatus,
  countUnreadConversations,
  listConversationsPage,
} from './service.ts';
import {
  newestRecordedCredential,
  recordedCredentialSql,
  resolveMailboxFilter,
  resolveThreadCredentials,
} from './thread-mailbox.ts';

const FRAGMENT = Symbol('fragment');
interface Fragment {
  [FRAGMENT]: true;
  text: string;
  values: unknown[];
}

function isFragment(value: unknown): value is Fragment {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { [FRAGMENT]?: true })[FRAGMENT] === true
  );
}

/**
 * A `sql` stand-in that inlines nested fragments the way postgres.js does and
 * answers each statement through `answer`.
 */
function recordingSql(answer: (text: string) => unknown[] = () => []) {
  const statements: { text: string; values: unknown[] }[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = '';
    const flat: unknown[] = [];
    strings.forEach((part, index) => {
      text += part;
      if (index >= values.length) return;
      const value = values[index];
      if (isFragment(value)) {
        text += value.text;
        flat.push(...value.values);
      } else {
        text += '?';
        flat.push(value);
      }
    });
    text = text.replace(/\s+/g, ' ').trim();
    statements.push({ text, values: flat });
    const fragment: Fragment = { [FRAGMENT]: true, text, values: flat };
    return Object.assign(Promise.resolve(answer(text)), fragment);
  };
  const sql = Object.assign(tag, {
    unsafe: (text: string) => text,
    json: (value: unknown) => value,
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
  return { sql: sql as unknown as Sql, statements };
}

const ORG = 'o1';
const ADMIN = { organizationId: ORG, userId: 'u-admin', role: 'admin' };
const MAILBOX_READ = 'FROM app.connector_credentials';

function mailbox(
  id: string,
  status: string,
  fromAddress?: string,
): Record<string, unknown> {
  return {
    id,
    connectorSlug: 'imap-smtp',
    status,
    config: fromAddress === undefined ? {} : { fromAddress },
  };
}

/** The recorded-credential subquery as every statement must carry it. */
function recordedText(): string {
  const { sql, statements } = recordingSql();
  void recordedCredentialSql(sql);
  const text = statements[0]?.text;
  if (!text) throw new Error('the fragment recorded no text');
  return text;
}

/** The page or count statement: the one that reads `app.conversations`
 *  itself, not the credential lookup. */
function conversationsRead(statements: { text: string; values: unknown[] }[]) {
  const found = statements.find((s) =>
    / FROM app\.conversations (WHERE|GROUP)/.test(s.text),
  );
  if (!found) throw new Error('no conversations statement was issued');
  return found;
}

const GENERAL = mailbox('cred-general', 'active', 'hello@support.test');
const withMailboxes = (text: string) =>
  text.includes(MAILBOX_READ) ? [GENERAL] : [];

beforeEach(() => vi.clearAllMocks());

describe('the mailbox filter repeats the resolver', () => {
  it('shares ONE recorded-credential subquery across the resolver and every door', async () => {
    const recorded = recordedText();

    const resolver = recordingSql();
    await resolveThreadCredentials(resolver.sql, ORG, [
      {
        id: 'c1',
        channel: 'email',
        connectorName: 'imap-smtp',
        direction: 'inbound',
        metadata: null,
      },
    ]);
    const list = recordingSql(withMailboxes);
    await listConversationsPage(list.sql, ADMIN, {
      credentialId: 'cred-general',
      cursor: null,
      limit: 25,
    });
    const byStatus = recordingSql(withMailboxes);
    await countConversationsByStatus(byStatus.sql, ADMIN, {
      credentialId: 'cred-general',
    });
    const unread = recordingSql((text) =>
      text.includes(MAILBOX_READ) ? [GENERAL] : [{ count: '0' }],
    );
    await countUnreadConversations(unread.sql, ADMIN, {
      credentialId: 'cred-general',
    });

    expect(
      resolver.statements.some((s) =>
        s.text.includes(`${recorded} AS "credentialId"`),
      ),
    ).toBe(true);
    for (const statements of [
      list.statements,
      byStatus.statements,
      unread.statements,
    ]) {
      expect(conversationsRead(statements).text).toContain(recorded);
    }
  });

  it('filters in the statement that pages, so a page cannot run short', async () => {
    const { sql, statements } = recordingSql(withMailboxes);
    await listConversationsPage(sql, ADMIN, {
      credentialId: 'cred-general',
      cursor: null,
      limit: 25,
    });

    const { text, values } = conversationsRead(statements);
    expect(text).toMatch(/ORDER BY .* LIMIT \?$/);
    expect(text).toContain('AND conversations.connector_name = ?');
    expect(text).toContain("AND conversations.channel IS DISTINCT FROM 'api'");
    expect(values).toEqual(
      expect.arrayContaining([
        'imap-smtp',
        'cred-general',
        'hello@support.test',
      ]),
    );
  });

  it('lists and counts nothing for a mailbox the organization does not have', async () => {
    const list = recordingSql();
    await expect(
      listConversationsPage(list.sql, ADMIN, {
        credentialId: 'cred-elsewhere',
        cursor: null,
        limit: 25,
      }),
    ).resolves.toEqual({
      page: [],
      items: [],
      isDone: true,
      continueCursor: '',
    });
    const counts = recordingSql();
    await expect(
      countConversationsByStatus(counts.sql, ADMIN, {
        credentialId: 'cred-elsewhere',
      }),
    ).resolves.toEqual({});

    // Only the credential lookup read a table, scoped to the organization.
    for (const statements of [list.statements, counts.statements]) {
      const reads = statements.filter((s) => s.text.includes(' FROM '));
      expect(reads.map((s) => s.text.includes(MAILBOX_READ))).toEqual([true]);
      expect(reads[0]?.values).toEqual([ORG, 'cred-elsewhere', ORG]);
    }
  });
});

describe('resolveMailboxFilter binds the address only where answer 2 would match', () => {
  async function resolve(rows: Record<string, unknown>[]) {
    const { sql } = recordingSql((text) =>
      text.includes(MAILBOX_READ) ? rows : [],
    );
    return resolveMailboxFilter(sql, ORG, 'cred-general');
  }

  it('binds an active mailbox’s own address, normalized', async () => {
    await expect(
      resolve([mailbox('cred-general', 'active', ' Hello@Support.test ')]),
    ).resolves.toEqual({
      id: 'cred-general',
      connectorSlug: 'imap-smtp',
      address: 'hello@support.test',
    });
  });

  it('binds none for an inactive mailbox: answer 2 never matches one', async () => {
    await expect(
      resolve([mailbox('cred-general', 'disabled', 'hello@support.test')]),
    ).resolves.toMatchObject({ address: null });
  });

  it('binds none when another active mailbox claims the same address', async () => {
    await expect(
      resolve([
        mailbox('cred-general', 'active', 'hello@support.test'),
        mailbox('cred-twin', 'active', 'HELLO@support.test '),
      ]),
    ).resolves.toMatchObject({ address: null });
  });

  it('still binds it when only an inactive mailbox shares the address', async () => {
    await expect(
      resolve([
        mailbox('cred-general', 'active', 'hello@support.test'),
        mailbox('cred-old', 'disabled', 'hello@support.test'),
      ]),
    ).resolves.toMatchObject({ address: 'hello@support.test' });
  });

  it('binds none for a mailbox without an address', async () => {
    await expect(
      resolve([mailbox('cred-general', 'active')]),
    ).resolves.toMatchObject({ address: null });
  });

  it('answers null for a mailbox the organization does not have', async () => {
    await expect(
      resolve([mailbox('cred-other', 'active', 'x@support.test')]),
    ).resolves.toBeNull();
  });
});

describe('newestRecordedCredential (answer 1 for a held thread)', () => {
  const inbound = (credentialId: string | null) => ({
    direction: 'inbound' as const,
    credentialId,
  });
  const outbound = (credentialId: string | null) => ({
    direction: 'outbound' as const,
    credentialId,
  });

  it.each([
    ['the newest inbound stamp', [inbound('a'), inbound('b')], 'b'],
    [
      'an inbound stamp over a newer outbound one',
      [inbound('a'), outbound('b')],
      'a',
    ],
    [
      'an outbound stamp when no inbound one exists',
      [outbound('a'), inbound(null)],
      'a',
    ],
    [
      'the newest outbound stamp among several',
      [outbound('a'), outbound('b')],
      'b',
    ],
    [
      'nothing when no message recorded one',
      [inbound(null), outbound(null)],
      undefined,
    ],
  ])('takes %s', (_case, messages, expected) => {
    expect(newestRecordedCredential(messages)).toBe(expected);
  });
});
