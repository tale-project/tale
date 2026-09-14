/**
 * Closing a conversation keeps its resolution record, whichever door closes
 * it. The app's single close/reopen/spam buttons PATCH `{status}`; that door
 * used to write none of the stamps the bulk verbs write (the closed banner
 * showed undated) and to REPLACE metadata wholesale, so a one-key patch wiped
 * `unread_count` and routing state. PATCH and bulk now share one stamp table
 * and metadata is merged.
 *
 * The same door raises `conversation.closed`. The event type has been in the
 * platform vocabulary since the automation bus shipped, and nothing raised it:
 * an org whose trigger listens for a closed conversation got silence.
 */

import type { TransactionSql } from 'postgres';
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

import { emitEvent } from '../events/emit.ts';
import {
  ConversationError,
  closesConversation,
  statusChangeStamps,
  updateConversation,
} from './service.ts';

beforeEach(() => {
  vi.mocked(emitEvent).mockClear();
});

const ORG = 'org_1';
const STORED_METADATA = {
  unread_count: 2,
  to: [{ address: 'support@door.test' }],
  routing: 'desk',
};

/** A transaction double: answers the SELECT with `row`, records the UPDATE's
 * parameters (json/unsafe are identity so the metadata object is inspectable).
 * `status` is the row's status BEFORE the patch — what decides whether this
 * write is the close transition. */
function txDouble(
  row: { id: string; metadata: unknown; status?: string } | null,
) {
  const statements: { text: string; values: unknown[] }[] = [];
  const tag = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    statements.push({
      text: strings.join('?').replace(/\s+/g, ' ').trim(),
      values,
    });
    return Promise.resolve(
      statements.length === 1 ? (row === null ? [] : [row]) : [],
    );
  };
  const tx = Object.assign(tag, {
    unsafe: (text: string) => text,
    json: (value: unknown) => value,
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js transaction tag
  return { tx: tx as unknown as TransactionSql, statements };
}

function updateParams(statements: { text: string; values: unknown[] }[]) {
  const update = statements.find((s) => s.text.startsWith('UPDATE'));
  if (!update) throw new Error('no UPDATE issued');
  // contact_id, subject, status, status_changed_at_ms, priority, type,
  // metadata, id — in the statement's column order.
  const [, , status, statusChangedAt, , , metadata] = update.values;
  return { status, statusChangedAt, metadata };
}

describe('statusChangeStamps (shared by PATCH and bulk)', () => {
  const now = Date.UTC(2026, 8, 3, 12);

  it('closed stamps who resolved it and when', () => {
    expect(statusChangeStamps('closed', 'user_a', now)).toEqual({
      resolved_at: new Date(now).toISOString(),
      resolved_by: 'user_a',
    });
  });

  it('spam stamps when it was flagged', () => {
    expect(statusChangeStamps('spam', 'user_a', now)).toEqual({
      marked_spam_at: new Date(now).toISOString(),
    });
  });

  it('open and archived stamp nothing', () => {
    expect(statusChangeStamps('open', 'user_a', now)).toEqual({});
    expect(statusChangeStamps('archived', 'user_a', now)).toEqual({});
  });
});

describe('updateConversation (the PATCH door)', () => {
  const actor = { userId: 'user_admin' };

  it('closing stamps the resolution record AND keeps the stored metadata', async () => {
    const { tx, statements } = txDouble({
      id: 'c1',
      metadata: STORED_METADATA,
      status: 'open',
    });
    await updateConversation(tx, ORG, 'c1', { status: 'closed' }, actor);
    const { status, statusChangedAt, metadata } = updateParams(statements);
    expect(status).toBe('closed');
    expect(typeof statusChangedAt).toBe('number');
    expect(metadata).toMatchObject({
      ...STORED_METADATA,
      resolved_by: 'user_admin',
    });
    expect(typeof (metadata as Record<string, unknown>).resolved_at).toBe(
      'string',
    );
  });

  it('marking spam stamps marked_spam_at and keeps unread state', async () => {
    const { tx, statements } = txDouble({
      id: 'c1',
      metadata: STORED_METADATA,
      status: 'open',
    });
    await updateConversation(tx, ORG, 'c1', { status: 'spam' }, actor);
    const { metadata } = updateParams(statements);
    expect(metadata).toMatchObject({ unread_count: 2 });
    expect(typeof (metadata as Record<string, unknown>).marked_spam_at).toBe(
      'string',
    );
  });

  it('a metadata patch MERGES onto the stored object instead of replacing it', async () => {
    const { tx, statements } = txDouble({
      id: 'c1',
      metadata: STORED_METADATA,
      status: 'open',
    });
    await updateConversation(
      tx,
      ORG,
      'c1',
      { metadata: { priority_note: 'VIP' } },
      actor,
    );
    const { status, metadata } = updateParams(statements);
    expect(status).toBe('status'); // untouched column passthrough
    expect(metadata).toEqual({ ...STORED_METADATA, priority_note: 'VIP' });
  });

  it('a patch with neither status nor metadata leaves metadata untouched', async () => {
    const { tx, statements } = txDouble({
      id: 'c1',
      metadata: STORED_METADATA,
      status: 'open',
    });
    await updateConversation(tx, ORG, 'c1', { subject: 'Renamed' }, actor);
    const { metadata, statusChangedAt } = updateParams(statements);
    expect(metadata).toBe('metadata');
    expect(statusChangedAt).toBe('status_changed_at_ms');
  });

  it('reopening keeps the record and stamps nothing new', async () => {
    const stored = {
      ...STORED_METADATA,
      resolved_at: '2026-09-01T00:00:00.000Z',
      resolved_by: 'user_x',
    };
    const { tx, statements } = txDouble({
      id: 'c1',
      metadata: stored,
      status: 'closed',
    });
    await updateConversation(tx, ORG, 'c1', { status: 'open' }, actor);
    const { status, metadata } = updateParams(statements);
    expect(status).toBe('open');
    // No stamps to write and no metadata patch → the column is left alone.
    expect(metadata).toBe('metadata');
  });

  /** A double that answers the conversation read with `row` and the contact
   * lookup with `contactRows`, recording every statement. */
  function contactTxDouble(contactRows: { id: string }[]) {
    const statements: { text: string; values: unknown[] }[] = [];
    const tag = (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<unknown[]> => {
      const text = strings.join('?').replace(/\s+/g, ' ').trim();
      statements.push({ text, values });
      if (text.startsWith('SELECT id, metadata, status, channel')) {
        return Promise.resolve([
          { id: 'c1', metadata: STORED_METADATA, status: 'open' },
        ]);
      }
      if (text.startsWith('SELECT id FROM app.contacts')) {
        return Promise.resolve(contactRows);
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

  it('refuses a contactId the org does not own (opaque 404, nothing written)', async () => {
    const { tx, statements } = contactTxDouble([]);
    await expect(
      updateConversation(tx, ORG, 'c1', { contactId: 'ct_foreign' }, actor),
    ).rejects.toMatchObject({
      code: 'contact_not_found',
      status: 404,
    } satisfies Partial<ConversationError>);
    const lookup = statements.find((s) =>
      s.text.startsWith('SELECT id FROM app.contacts'),
    );
    // The lookup is scoped to the caller's org, not just the id.
    expect(lookup?.text).toContain('org_id = ?');
    expect(lookup?.values).toEqual(['ct_foreign', ORG]);
    expect(statements.some((s) => s.text.startsWith('UPDATE'))).toBe(false);
  });

  it('re-points to a contact the org owns', async () => {
    const { tx, statements } = contactTxDouble([{ id: 'ct_ours' }]);
    await updateConversation(tx, ORG, 'c1', { contactId: 'ct_ours' }, actor);
    const update = statements.find((s) => s.text.startsWith('UPDATE'));
    expect(update?.values[0]).toBe('ct_ours');
  });

  it('answers the opaque 404 for a row outside the org', async () => {
    const { tx, statements } = txDouble(null);
    await expect(
      updateConversation(tx, ORG, 'c1', { status: 'closed' }, actor),
    ).rejects.toMatchObject({
      code: 'conversation_not_found',
      status: 404,
    } satisfies Partial<ConversationError>);
    expect(statements.some((s) => s.text.startsWith('UPDATE'))).toBe(false);
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it('raises conversation.closed when the patch closes an open conversation', async () => {
    const { tx } = txDouble({
      id: 'c1',
      metadata: STORED_METADATA,
      status: 'open',
    });
    await updateConversation(tx, ORG, 'c1', { status: 'closed' }, actor);
    expect(emitEvent).toHaveBeenCalledTimes(1);
    expect(emitEvent).toHaveBeenCalledWith(tx, {
      organizationId: ORG,
      eventType: 'conversation.closed',
      eventData: { conversationId: 'c1', closedBy: 'user_admin' },
    });
  });

  it('raises nothing when an already-closed conversation is closed again', async () => {
    const { tx } = txDouble({
      id: 'c1',
      metadata: STORED_METADATA,
      status: 'closed',
    });
    await updateConversation(tx, ORG, 'c1', { status: 'closed' }, actor);
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it('raises nothing for spam, archive, reopen, or a patch that skips status', async () => {
    for (const status of ['spam', 'archived', 'open'] as const) {
      const { tx } = txDouble({
        id: 'c1',
        metadata: STORED_METADATA,
        status: 'open',
      });
      await updateConversation(tx, ORG, 'c1', { status }, actor);
    }
    const { tx } = txDouble({
      id: 'c1',
      metadata: STORED_METADATA,
      status: 'open',
    });
    await updateConversation(tx, ORG, 'c1', { subject: 'Renamed' }, actor);
    expect(emitEvent).not.toHaveBeenCalled();
  });
});

describe('closesConversation (the transition the event fires on)', () => {
  it('is true only for a write that moves a non-closed row to closed', () => {
    expect(closesConversation('open', 'closed')).toBe(true);
    expect(closesConversation('spam', 'closed')).toBe(true);
    expect(closesConversation('archived', 'closed')).toBe(true);
    expect(closesConversation(null, 'closed')).toBe(true);
  });

  it('is false when the row is already closed or the status is untouched', () => {
    expect(closesConversation('closed', 'closed')).toBe(false);
    expect(closesConversation('open', undefined)).toBe(false);
    expect(closesConversation('closed', undefined)).toBe(false);
    expect(closesConversation('open', 'spam')).toBe(false);
  });
});
