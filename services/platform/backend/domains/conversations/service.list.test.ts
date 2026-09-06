/**
 * The Inbox doors read in batches, whatever the page or thread size. The
 * list door used to batch the page's contacts and previews and then
 * re-project every row through the detail path — three more queries per row,
 * up to 300 on a 100-row page. The detail door read the whole thread twice
 * (once for the raw rows it answers, once inside the projection).
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getFileUrl, statOrgBlob } = vi.hoisted(() => ({
  getFileUrl: vi.fn(async () => 'https://blob.example.test/get?sig=abc'),
  statOrgBlob: vi.fn(async () => ({ size: 3 })),
}));

vi.mock('../files/service.ts', () => ({ getFileUrl, statOrgBlob }));
vi.mock('../../realtime/outbox.ts', () => ({
  emitHintInTx: vi.fn(async () => undefined),
}));

import {
  listConversationsPage,
  projectConversationForView,
} from './service.ts';
import type { ConversationMessageRow, ConversationRow } from './service.ts';

/** A `sql` stand-in that records every statement and answers by table. */
function recordingSql(answer: (text: string) => unknown[]) {
  const statements: { text: string; values: unknown[] }[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    return Promise.resolve(answer(text));
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

function conversation(id: string, contactId: string | null): ConversationRow {
  return {
    id,
    organizationId: ORG,
    contactId,
    assigneeUserId: null,
    assigneeTeamId: null,
    externalMessageId: null,
    subject: `Subject ${id}`,
    status: 'open',
    priority: null,
    type: null,
    channel: 'email',
    direction: 'inbound',
    connectorName: 'imap-smtp',
    lastMessageAt: 1_000,
    metadata: { unread_count: 1 },
    lifecycleStatus: null,
    statusChangedAt: null,
    createdAt: 900,
  };
}

function message(
  id: string,
  conversationId: string,
  content: string,
  metadata: Record<string, unknown> | null = null,
): ConversationMessageRow {
  return {
    id,
    organizationId: ORG,
    conversationId,
    channel: 'email',
    direction: 'inbound',
    externalMessageId: null,
    deliveryState: 'delivered',
    retryCount: null,
    connectorName: 'imap-smtp',
    content,
    sentAt: 1_000,
    deliveredAt: null,
    metadata,
    createdAt: 1_000,
  };
}

const CONTACTS = [
  {
    id: 'ct-1',
    name: 'Carla',
    email: 'carla@ext.test',
    locale: 'de',
    source: 'email',
    createdAt: 100,
  },
  {
    id: 'ct-2',
    name: null,
    email: 'bob@ext.test',
    locale: null,
    source: null,
    createdAt: 200,
  },
];

describe('listConversationsPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('projects the page from four batched reads, none per row', async () => {
    const rows = [
      conversation('c1', 'ct-1'),
      conversation('c2', 'ct-2'),
      conversation('c3', null),
    ];
    const { sql, statements } = recordingSql((text) => {
      if (text.includes('FROM app.conversations ')) return rows;
      if (text.includes('FROM app.contacts')) return CONTACTS;
      if (text.includes('FROM app.conversation_messages')) {
        return [
          message('m1', 'c1', 'x'.repeat(500)),
          message('m2', 'c2', 'Question from Bob.'),
        ];
      }
      if (text.includes('FROM app.approvals')) {
        return [{ conversationId: 'c2', id: 'ap-1', metadata: { k: 'v' } }];
      }
      throw new Error(`unexpected statement: ${text}`);
    });

    const result = await listConversationsPage(sql, ADMIN, {
      cursor: null,
      limit: 25,
    });

    // rows, contacts, newest messages, pending approvals — and nothing else,
    // whatever the page size.
    expect(
      statements.map((s) => s.text.split(' FROM ')[1]?.split(' ')[0]),
    ).toEqual([
      'app.conversations',
      'app.contacts',
      'app.conversation_messages',
      'app.approvals',
    ]);
    // Every batch is keyed on the whole page, org-scoped where a row is
    // org-owned.
    const contacts = statements[1];
    expect(contacts?.values).toEqual([['ct-1', 'ct-2'], ORG]);
    const approvals = statements[3];
    expect(approvals?.values).toEqual([ORG, ['c1', 'c2', 'c3']]);

    expect(result.page.map((row) => row.contact?.email ?? null)).toEqual([
      'carla@ext.test',
      'bob@ext.test',
      null,
    ]);
    expect(result.page[0]?.lastMessagePreview).toHaveLength(200);
    expect(result.page.map((row) => row.unread)).toEqual([true, true, true]);

    // The projected items ARE the shared Inbox shape, built from the same
    // batches: contact, newest message, pending approval.
    expect(result.items).toHaveLength(3);
    expect(result.items[0]).toMatchObject({
      _id: 'c1',
      senderName: 'Carla',
      contact: expect.objectContaining({ email: 'carla@ext.test' }),
      message_count: 1,
    });
    expect(result.items[1]).toMatchObject({
      _id: 'c2',
      pendingApproval: { id: 'ap-1', metadata: { k: 'v' } },
      lastMessagePreview: 'Question from Bob.',
    });
    expect(result.items[0]).not.toHaveProperty('pendingApproval');
    expect(result.items[2]).toMatchObject({ _id: 'c3', message_count: 0 });
  });

  it('skips the contact and message batches for an empty page', async () => {
    const { sql, statements } = recordingSql(() => []);
    const result = await listConversationsPage(sql, ADMIN, {
      cursor: null,
      limit: 25,
    });
    expect(statements).toHaveLength(1);
    expect(result).toEqual({
      page: [],
      items: [],
      isDone: true,
      continueCursor: '',
    });
  });
});

describe('projectConversationForView', () => {
  beforeEach(() => vi.clearAllMocks());

  it('projects the thread it is handed — no second read — and presigns only the projected copy', async () => {
    const attachment = { id: 'a1', filename: 'CV.pdf', storageId: 's3:o1/cv' };
    const thread = [
      message('m1', 'c1', 'hello', { attachments: [attachment] }),
      message('m2', 'c1', 'world'),
    ];
    const { sql, statements } = recordingSql((text) => {
      if (text.includes('FROM app.contacts')) return [CONTACTS[0]];
      if (text.includes('FROM app.approvals')) return [];
      throw new Error(`unexpected statement: ${text}`);
    });

    const item = await projectConversationForView(
      sql,
      conversation('c1', 'ct-1'),
      thread,
    );

    expect(
      statements.some((s) => s.text.includes('FROM app.conversation_messages')),
    ).toBe(false);
    expect(
      statements.map((s) => s.text.split(' FROM ')[1]?.split(' ')[0]),
    ).toEqual(['app.contacts', 'app.approvals']);
    expect(item).toMatchObject({
      _id: 'c1',
      senderName: 'Carla',
      message_count: 2,
    });
    expect(getFileUrl).toHaveBeenCalledWith(
      sql,
      { organizationId: ORG },
      's3:o1/cv',
    );
    // The caller's rows are answered raw alongside the item: untouched.
    expect(thread[0]?.metadata).toEqual({ attachments: [attachment] });
  });
});
