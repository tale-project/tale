/**
 * The bulk status verbs — the Inbox's multi-select close, reopen, spam,
 * archive and unarchive. One transaction covers the whole batch, a row the org
 * does not own is counted as a failure and the rest still flip, and the batch
 * writes ONE audit row.
 *
 * `close` also raises `conversation.closed` per row it actually closes. A
 * selection that is half closed already must not raise the event twice for
 * those rows: a trigger reading it as "a case just ended" would run twice on
 * one case.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../realtime/outbox.ts', () => ({
  emitHintInTx: vi.fn(async () => undefined),
}));
vi.mock('../events/emit.ts', () => ({
  emitEvent: vi.fn(async () => undefined),
}));
vi.mock('./notify-status.ts', () => ({
  notifyChannelStatusInTx: vi.fn(async () => undefined),
}));
vi.mock('../audit_logs/service.ts', () => ({
  createAuditLog: vi.fn(async () => undefined),
}));

import { createAuditLog } from '../audit_logs/service.ts';
import { emitEvent } from '../events/emit.ts';
import { bulkSetConversationStatus } from './service.ts';

interface Statement {
  text: string;
  values: unknown[];
}

const ORG = 'org_1';
const ACTOR = { userId: 'user_admin', email: 'admin@desk.test' };

/**
 * A sql double whose `begin` runs the callback against itself. `statuses` maps
 * a conversation id to its status BEFORE the batch; an id absent from the map
 * answers the read with no row, which is how a foreign row reads.
 */
function recordingSql(statuses: Record<string, string>) {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.startsWith('SELECT metadata, status, channel')) {
      const id = String(values[0]);
      const status = statuses[id];
      return Promise.resolve(
        status === undefined
          ? []
          : [
              {
                metadata: { unread_count: 1 },
                status,
                channel: 'email',
                connectorName: 'imap-smtp',
                credentialId: null,
              },
            ],
      );
    }
    return Promise.resolve([]);
  };
  const sql = Object.assign(tag, {
    unsafe: (text: string) => text,
    json: (value: unknown) => value,
    begin: (fn: (tx: unknown) => Promise<unknown>) => fn(sql),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
  return { sql: sql as unknown as Sql, statements };
}

const updates = (statements: Statement[]) =>
  statements.filter((s) => s.text.startsWith('UPDATE app.conversations'));

const closedEvents = () =>
  vi
    .mocked(emitEvent)
    .mock.calls.filter(([, args]) => args.eventType === 'conversation.closed');

beforeEach(() => {
  vi.mocked(emitEvent).mockClear();
  vi.mocked(createAuditLog).mockClear();
});

describe('bulkSetConversationStatus', () => {
  it('flips every named row and writes one audit row for the batch', async () => {
    const { sql, statements } = recordingSql({ c1: 'open', c2: 'open' });
    const result = await bulkSetConversationStatus(sql, {
      organizationId: ORG,
      conversationIds: ['c1', 'c2'],
      verb: 'archive',
      actor: ACTOR,
    });
    expect(result).toEqual({ successCount: 2, failedCount: 0, errors: [] });
    expect(updates(statements)).toHaveLength(2);
    expect(updates(statements)[0]?.values[0]).toBe('archived');
    expect(createAuditLog).toHaveBeenCalledTimes(1);
    expect(createAuditLog).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({ action: 'bulk_archive_conversations' }),
    );
  });

  it('counts a row the org does not own as a failure and flips the rest', async () => {
    const { sql, statements } = recordingSql({ c1: 'open' });
    const result = await bulkSetConversationStatus(sql, {
      organizationId: ORG,
      conversationIds: ['c1', 'c_foreign'],
      verb: 'close',
      actor: ACTOR,
    });
    expect(result.successCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.errors).toEqual(['Conversation c_foreign not found']);
    expect(updates(statements)).toHaveLength(1);
  });

  it('stamps the resolution record on a close, merged onto stored metadata', async () => {
    const { sql, statements } = recordingSql({ c1: 'open' });
    await bulkSetConversationStatus(sql, {
      organizationId: ORG,
      conversationIds: ['c1'],
      verb: 'close',
      actor: ACTOR,
    });
    const metadata = updates(statements)[0]?.values[2];
    expect(metadata).toMatchObject({
      unread_count: 1,
      resolved_by: 'user_admin',
    });
    expect(typeof (metadata as Record<string, unknown>).resolved_at).toBe(
      'string',
    );
  });

  it('raises conversation.closed once per row the batch actually closes', async () => {
    const { sql } = recordingSql({ c1: 'open', c2: 'closed', c3: 'spam' });
    await bulkSetConversationStatus(sql, {
      organizationId: ORG,
      conversationIds: ['c1', 'c2', 'c3'],
      verb: 'close',
      actor: ACTOR,
    });
    expect(closedEvents()).toHaveLength(2);
    expect(closedEvents().map(([, args]) => args.eventData)).toEqual([
      { conversationId: 'c1', closedBy: 'user_admin' },
      { conversationId: 'c3', closedBy: 'user_admin' },
    ]);
  });

  it('raises nothing for reopen, spam, archive or unarchive', async () => {
    for (const verb of ['reopen', 'spam', 'archive', 'unarchive'] as const) {
      const { sql } = recordingSql({ c1: 'closed' });
      await bulkSetConversationStatus(sql, {
        organizationId: ORG,
        conversationIds: ['c1'],
        verb,
        actor: ACTOR,
      });
    }
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it('raises nothing and audits nothing when every named row is foreign', async () => {
    const { sql, statements } = recordingSql({});
    const result = await bulkSetConversationStatus(sql, {
      organizationId: ORG,
      conversationIds: ['c_foreign'],
      verb: 'close',
      actor: ACTOR,
    });
    expect(result.successCount).toBe(0);
    expect(updates(statements)).toHaveLength(0);
    expect(emitEvent).not.toHaveBeenCalled();
    expect(createAuditLog).not.toHaveBeenCalled();
  });
});
