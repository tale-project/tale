/**
 * The mailbox sync across passes, against provider fakes that keep each
 * provider's own listing contract: Gmail lists newest first on its own
 * arrival clock and pages with a token, Graph filters and orders by the
 * folder's own date, IMAP answers the native's window oldest first. The
 * ingest double stores each Message-ID once, the way the real ingest does
 * (`CONV-R6`), and remembers the order things were stored in.
 *
 * What is asked here is what a person relies on: every email reaches the
 * Inbox once and oldest first, whatever the backlog, the provider's failures
 * or the sender's clock — and each pass says what it did.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NativeConnectorContext } from '../../../lib/connectors/dispatcher';
import { platformConversationNatives } from '../../../lib/connectors/natives/platform-conversations';
import { functionRefName } from '../../../lib/shared/handlers/function-refs';
import { isRecord } from '../../../lib/utils/type-utils';
import type { ActionCtx } from '../lib/ctx';

const {
  createConversationFromEmail,
  createConversationFromSentEmail,
  queryLatestMessageByDeliveryState,
  queryLatestOutboundMessageForEmailSync,
  resolveConnectorAccountEmail,
} = vi.hoisted(() => ({
  createConversationFromEmail: vi.fn(),
  createConversationFromSentEmail: vi.fn(),
  queryLatestMessageByDeliveryState: vi.fn(),
  queryLatestOutboundMessageForEmailSync: vi.fn(),
  resolveConnectorAccountEmail: vi.fn(),
}));

vi.mock('./ingest/create_conversation_from_email', () => ({
  createConversationFromEmail,
}));
vi.mock('./ingest/create_conversation_from_sent_email', () => ({
  createConversationFromSentEmail,
}));
vi.mock('./ingest/query_latest_message_by_delivery_state', () => ({
  queryLatestMessageByDeliveryState,
}));
vi.mock('./ingest/query_latest_outbound_message_for_sync', () => ({
  queryLatestOutboundMessageForEmailSync,
}));
vi.mock('./ingest/resolve_connector_account_email', () => ({
  resolveConnectorAccountEmail,
}));

import { tipOfEmails } from './ingest/email_epoch';
import { normalizeEmails } from './ingest/normalize_email';
import { normalizeExternalMessageId } from './ingest/normalize_external_message_id';
import { syncMailbox } from './sync_mailbox';

// ------------------------------------------------------------- the Inbox

/** The Inbox the ingest double fills: one entry per Message-ID. */
let stored: Array<{ messageId: string; folder: 'inbox' | 'sent' }> = [];

/** The ingest helpers' contract, reduced to identity: a Message-ID is stored
 * once, a second read counts as already stored, an email without one is
 * skipped. */
function ingestDouble(folder: 'inbox' | 'sent') {
  return (_ctx: unknown, args: { emails: unknown }) => {
    const emails = normalizeEmails(args.emails);
    let processedCount = 0;
    let skippedCount = 0;
    let alreadyStoredCount = 0;
    let created = false;
    for (const email of emails) {
      const id = normalizeExternalMessageId(email.messageId);
      if (id === undefined) {
        skippedCount += 1;
        continue;
      }
      processedCount += 1;
      if (stored.some((entry) => entry.messageId === id)) {
        alreadyStoredCount += 1;
        continue;
      }
      stored.push({ messageId: id, folder });
      created = true;
    }
    return Promise.resolve({
      created,
      processedCount,
      skippedCount,
      alreadyStoredCount,
      conversationIds: processedCount > 0 ? ['conv_1'] : [],
      ingestedTip: tipOfEmails(emails),
    });
  };
}

function storedIds(): string[] {
  return stored.map((entry) => entry.messageId);
}

// ------------------------------------------------------------- the world

interface ConnectorCall {
  connector: string;
  action: string;
  input: Record<string, unknown>;
  credentialRef?: string;
}

/** A string input as the provider reads it; anything else reads as empty. */
function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** A provider answers a connector call, or throws the way a live body does. */
type Provider = (call: ConnectorCall) => unknown;

interface CredentialRow {
  id: string;
  name: string;
  isDefault: boolean;
  mailSyncInboundSince?: number;
  mailSyncOutboundSince?: number;
  mailSyncEdges?: unknown;
}

/** A ctx over one provider and the credential rows, whose watermark patches
 * land on the rows the way the real table keeps them. */
function world(provider: Provider, credentials: CredentialRow[]) {
  const rows = credentials.map((row) => ({ ...row }));
  const calls: ConnectorCall[] = [];
  const runAction = async (
    _ref: unknown,
    args: Record<string, unknown>,
  ): Promise<unknown> => {
    if (args.bytes !== undefined) return 'storage-1';
    const call: ConnectorCall = {
      connector: String(args.connector),
      action: String(args.action),
      input: isRecord(args.input) ? args.input : {},
      ...(typeof args.credentialRef === 'string'
        ? { credentialRef: args.credentialRef }
        : {}),
    };
    calls.push(call);
    return { status: 'ok', output: await provider(call) };
  };
  const runQuery = async (
    ref: unknown,
    args?: Record<string, unknown>,
  ): Promise<unknown> => {
    // The Inbox's record of an email, by the id it is stored under.
    if (args !== undefined && typeof args.externalMessageId === 'string') {
      const id = args.externalMessageId;
      return stored.some((entry) => entry.messageId === id)
        ? {
            _id: `msg:${id}`,
            conversationId: 'conv_1',
            organizationId: 'org',
            direction: 'outbound',
            deliveryState: 'sent',
          }
        : null;
    }
    if (functionRefName(ref).endsWith('resolveCredentialRefInternal')) {
      return null;
    }
    return rows.map((row) => ({ ...row }));
  };
  const runMutation = async (
    _ref: unknown,
    args: Record<string, unknown>,
  ): Promise<null> => {
    // A record renamed to the email's Message-ID.
    if (
      typeof args.messageId === 'string' &&
      typeof args.externalMessageId === 'string'
    ) {
      const entry = stored.find(
        (candidate) => `msg:${candidate.messageId}` === args.messageId,
      );
      if (entry !== undefined) entry.messageId = args.externalMessageId;
      return null;
    }
    const row = rows.find((candidate) => candidate.id === args.credentialId);
    if (row !== undefined) {
      if (typeof args.mailSyncInboundSince === 'number') {
        row.mailSyncInboundSince = args.mailSyncInboundSince;
      }
      if (typeof args.mailSyncOutboundSince === 'number') {
        row.mailSyncOutboundSince = args.mailSyncOutboundSince;
      }
      if (args.mailSyncEdges !== undefined) {
        row.mailSyncEdges = args.mailSyncEdges;
      }
    }
    return null;
  };
  return {
    ctx: { runAction, runQuery, runMutation } as unknown as ActionCtx,
    rows,
    calls,
  };
}

type SyncArgs = Parameters<typeof syncMailbox>[1];
type SyncResult = Awaited<ReturnType<typeof syncMailbox>>;

interface Receipt {
  mailbox: string;
  ok: boolean;
  listed: number;
  fetched: number;
  ingested: number;
  duplicates: number;
  skipped: number;
  vanished: number;
  capped: boolean;
  rateLimited?: true;
  retryAfter?: string;
  error?: string;
  resumeFrom?: { inbox?: string; sent?: string };
}

function receiptsOf(result: SyncResult): Receipt[] {
  const value: unknown = Reflect.get(result, 'mailboxes');
  return Array.isArray(value) ? (value as Receipt[]) : [];
}

/** Pass after pass until one stores nothing and says nothing is waiting. */
async function drain(
  ctx: ActionCtx,
  args: SyncArgs,
  maxPasses = 40,
): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  for (let pass = 0; pass < maxPasses; pass++) {
    const before = stored.length;
    const result = await syncMailbox(ctx, args);
    results.push(result);
    const waiting = receiptsOf(result).some((receipt) => receipt.capped);
    if (stored.length === before && !waiting) break;
  }
  return results;
}

const NOW = Date.parse('2026-10-14T12:00:00.000Z');
const MINUTE = 60_000;
const DAY = 86_400_000;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function passArgs(
  connectorSlug: string,
  extra: Record<string, unknown> = {},
): SyncArgs {
  return {
    organizationId: 'org',
    connectorSlug,
    limit: 25,
    includeSent: false,
    mode: 'live',
    ...extra,
  } as SyncArgs;
}

// --------------------------------------------------------------- Gmail

interface GmailMail {
  id: string;
  label: 'INBOX' | 'SENT';
  /** Gmail's own arrival clock, epoch ms. */
  internalDate: number;
  /** The sender's `Date` header, when it says something else. */
  dateHeader?: string;
  from?: string;
  to?: string;
  inReplyTo?: string;
  /** No Message-ID header at all (a malformed message). */
  noMessageId?: boolean;
}

function rawGmail(mail: GmailMail): Record<string, unknown> {
  const headers = [
    { name: 'From', value: mail.from ?? 'Hannah <hannah@customer.test>' },
    { name: 'To', value: mail.to ?? 'desk@example.com' },
    { name: 'Subject', value: `Mail ${mail.id}` },
    {
      name: 'Date',
      value: mail.dateHeader ?? new Date(mail.internalDate).toUTCString(),
    },
    ...(mail.noMessageId === true
      ? []
      : [{ name: 'Message-ID', value: `<${mail.id}@mail.test>` }]),
    ...(mail.inReplyTo !== undefined
      ? [{ name: 'In-Reply-To', value: `<${mail.inReplyTo}@mail.test>` }]
      : []),
  ];
  return {
    // A message without the header falls back to Gmail's own id; the
    // double then has nothing to key it on, as for a real one.
    id: mail.noMessageId === true ? '' : mail.id,
    threadId: `t-${mail.id}`,
    labelIds: [mail.label],
    internalDate: String(mail.internalDate),
    payload: {
      mimeType: 'text/plain',
      headers,
      body: { data: Buffer.from(`Body of ${mail.id}`).toString('base64url') },
    },
  };
}

/**
 * `users.messages.list` and `.get` as Gmail answers them: the search's
 * `after:`/`before:` read Gmail's arrival clock in whole seconds (`after:`
 * strictly later), the list is newest first, `maxResults` pages and a
 * `nextPageToken` continues. `failures` makes one message's read throw.
 */
function gmail(
  mails: GmailMail[],
  failures: Record<string, string> = {},
  options: { pageSize?: number } = {},
): Provider {
  return (call) => {
    if (call.action === 'list_messages') {
      const q = typeof call.input.q === 'string' ? call.input.q : '';
      const after = /after:(\d+)/.exec(q);
      const before = /before:(\d+)/.exec(q);
      const labels = text(call.input.labelIds)
        .split(',')
        .map((label) => label.trim())
        .filter((label) => label !== '');
      const matching = mails
        .filter((mail) => labels.length === 0 || labels.includes(mail.label))
        .filter(
          (mail) =>
            after === null || mail.internalDate > Number(after[1]) * 1000,
        )
        .filter(
          (mail) =>
            before === null || mail.internalDate < Number(before[1]) * 1000,
        )
        .sort((a, b) => b.internalDate - a.internalDate);
      // Gmail may answer a page shorter than asked, and say so with a token.
      const max = Math.min(
        Number(call.input.maxResults) || 25,
        500,
        options.pageSize ?? 500,
      );
      const offset = Number(call.input.pageToken ?? 0) || 0;
      const page = matching.slice(offset, offset + max);
      return {
        messages: page.map((mail) => ({
          id: mail.id,
          threadId: `t-${mail.id}`,
        })),
        nextPageToken:
          offset + max < matching.length ? String(offset + max) : '',
      };
    }
    if (call.action === 'get_message') {
      const id = String(call.input.messageId);
      const failure = failures[id];
      if (failure !== undefined) throw new Error(failure);
      const mail = mails.find((candidate) => candidate.id === id);
      if (mail === undefined) {
        throw new Error(
          'the live gmail.get_message call failed: Gmail get_message failed (404): Requested entity was not found.',
        );
      }
      return { message: rawGmail(mail), attachments: [] };
    }
    if (call.action === 'get_profile') return {};
    throw new Error(`gmail fake: no ${call.action}`);
  };
}

function gmailInbox(count: number, from: number, step = MINUTE): GmailMail[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `g${String(i + 1).padStart(4, '0')}`,
    label: 'INBOX' as const,
    internalDate: from + (i + 1) * step,
  }));
}

// -------------------------------------------------------------- Outlook

interface OutlookMail {
  id: string;
  folder: 'inbox' | 'sentitems';
  /** Graph's whole-second stamps. */
  receivedDateTime: string;
  sentDateTime: string;
  from?: string;
  to?: string;
  inReplyTo?: string;
}

function rawOutlook(mail: OutlookMail): Record<string, unknown> {
  return {
    id: mail.id,
    internetMessageId: `<${mail.id}@mail.test>`,
    internetMessageHeaders:
      mail.inReplyTo !== undefined
        ? [{ name: 'In-Reply-To', value: `<${mail.inReplyTo}@mail.test>` }]
        : [],
    subject: `Mail ${mail.id}`,
    from: {
      emailAddress: { address: mail.from ?? 'hannah@customer.test' },
    },
    toRecipients: [
      { emailAddress: { address: mail.to ?? 'desk@example.com' } },
    ],
    receivedDateTime: mail.receivedDateTime,
    sentDateTime: mail.sentDateTime,
    body: { contentType: 'text', content: `Body of ${mail.id}` },
  };
}

/** Graph's `/mailFolders/{folder}/messages`: `$filter` on a date field with
 * `ge`/`gt`, `$orderby` that field, `$top`, `$skip`. */
function outlook(
  mails: OutlookMail[],
  failures: Record<string, string> = {},
): Provider {
  return (call) => {
    if (call.action === 'list_messages') {
      const failure = failures['list_messages'];
      if (failure !== undefined) throw new Error(failure);
      const folder = text(call.input.folder);
      const filter = /(receivedDateTime|sentDateTime) (ge|gt) (\S+)/.exec(
        text(call.input.filter),
      );
      const order = /(receivedDateTime|sentDateTime) (asc|desc)/.exec(
        text(call.input.orderby) || 'receivedDateTime desc',
      );
      const field = (order?.[1] ?? 'receivedDateTime') as
        | 'receivedDateTime'
        | 'sentDateTime';
      const descending = order?.[2] !== 'asc';
      const matching = mails
        .filter((mail) => folder === '' || mail.folder === folder)
        .filter((mail) => {
          if (filter === null) return true;
          const at = Date.parse(mail[filter[1] as 'receivedDateTime']);
          const bound = Date.parse(filter[3] ?? '');
          return filter[2] === 'ge' ? at >= bound : at > bound;
        })
        .sort((a, b) => {
          const delta = Date.parse(a[field]) - Date.parse(b[field]);
          return descending ? -delta : delta;
        });
      const top = Math.min(Number(call.input.top) || 25, 1000);
      const skip = Number(call.input.skip ?? 0) || 0;
      return {
        messages: matching.slice(skip, skip + top).map((mail) => ({
          id: mail.id,
          internetMessageId: `<${mail.id}@mail.test>`,
          receivedDateTime: mail.receivedDateTime,
          sentDateTime: mail.sentDateTime,
        })),
        nextLink: '',
      };
    }
    if (call.action === 'get_message') {
      const id = String(call.input.messageId);
      const failure = failures[id];
      if (failure !== undefined) throw new Error(failure);
      const mail = mails.find((candidate) => candidate.id === id);
      if (mail === undefined) {
        throw new Error(
          `the live outlook.get_message call failed: Outlook get_message failed: message ${id} not found.`,
        );
      }
      return { message: rawOutlook(mail), attachments: [] };
    }
    if (call.action === 'get_profile') return {};
    throw new Error(`outlook fake: no ${call.action}`);
  };
}

// ----------------------------------------------------------------- IMAP

interface ImapMail {
  uid: number;
  folder: 'inbox' | 'sent';
  /** The server's arrival time (INTERNALDATE), epoch ms. */
  receivedAt: number;
  /** The sender's Date header, when it says something else. */
  date?: number;
  from?: string;
  to?: string;
  inReplyTo?: string;
}

/**
 * `imap-smtp.list_messages` / `get_message` as the native answers them:
 * `after` reads the server's arrival time strictly later; without it, the
 * newest `limit` of the folder (the tail); `since` is the legacy cursor on
 * the sender's date. Oldest first.
 */
function imap(
  mails: ImapMail[],
  failures: Record<string, string> = {},
): Provider {
  return (call) => {
    const folder = call.input.mailbox === 'sent' ? 'sent' : 'inbox';
    if (call.action === 'list_messages') {
      const limit = Math.min(Math.max(1, Number(call.input.limit) || 25), 1000);
      const after =
        typeof call.input.after === 'number' ? call.input.after : undefined;
      const since =
        typeof call.input.since === 'number' ? call.input.since : undefined;
      const inFolder = mails
        .filter((mail) => mail.folder === folder)
        .sort((a, b) => a.receivedAt - b.receivedAt || a.uid - b.uid);
      let rows: ImapMail[];
      if (after !== undefined) {
        rows = inFolder
          .filter((mail) => mail.receivedAt > after)
          .slice(0, limit);
      } else if (since !== undefined) {
        rows = inFolder
          .filter((mail) => (mail.date ?? mail.receivedAt) >= since)
          .slice(0, limit);
      } else {
        rows = inFolder.slice(-limit);
      }
      return {
        messages: rows.map((mail) => ({
          uid: String(mail.uid),
          from: mail.from ?? 'hannah@customer.test',
          subject: `Mail ${mail.uid}`,
          sentAt: mail.date ?? mail.receivedAt,
          receivedAt: mail.receivedAt,
        })),
      };
    }
    if (call.action === 'get_message') {
      const uid = Number(call.input.uid);
      const key = `${folder}:${uid}`;
      const failure = failures[key];
      if (failure !== undefined) throw new Error(failure);
      const mail = mails.find(
        (candidate) => candidate.uid === uid && candidate.folder === folder,
      );
      if (mail === undefined) {
        throw new Error(
          `the live imap-smtp.get_message call failed: no message with UID ${uid} in the requested mailbox`,
        );
      }
      const messageId = `<${folder}-${uid}@mail.test>`;
      return {
        uid: String(uid),
        email: {
          uid,
          messageId,
          from: [{ address: mail.from ?? 'hannah@customer.test' }],
          to: [{ address: mail.to ?? 'desk@example.com' }],
          cc: [],
          subject: `Mail ${uid}`,
          date: iso(mail.date ?? mail.receivedAt),
          flags: [],
          headers: {
            'message-id': messageId,
            ...(mail.inReplyTo !== undefined && {
              'in-reply-to': `<${mail.inReplyTo}@mail.test>`,
            }),
          },
        },
      };
    }
    throw new Error(`imap fake: no ${call.action}`);
  };
}

function imapInbox(count: number, from: number, step = MINUTE): ImapMail[] {
  return Array.from({ length: count }, (_, i) => ({
    uid: i + 1,
    folder: 'inbox' as const,
    receivedAt: from + (i + 1) * step,
  }));
}

// ----------------------------------------------------------------- setup

beforeEach(() => {
  stored = [];
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  createConversationFromEmail
    .mockReset()
    .mockImplementation(ingestDouble('inbox'));
  createConversationFromSentEmail
    .mockReset()
    .mockImplementation(ingestDouble('sent'));
  resolveConnectorAccountEmail
    .mockReset()
    .mockResolvedValue('desk@example.com');
  queryLatestMessageByDeliveryState
    .mockReset()
    .mockResolvedValue({ message: null });
  queryLatestOutboundMessageForEmailSync
    .mockReset()
    .mockResolvedValue({ message: null });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const SUPPORT: CredentialRow = {
  id: 'cred_support',
  name: 'Support',
  isDefault: true,
};

// ------------------------------------------------------------ the drain

describe('a backlog drains oldest first and skips nothing [CONV-R17]', () => {
  it('reads a Gmail backlog larger than one pass, oldest first, each email once', async () => {
    const position = NOW - 2 * DAY;
    const mails = gmailInbox(60, position);
    const { ctx, rows } = world(gmail(mails), [
      { ...SUPPORT, mailSyncInboundSince: position },
    ]);

    await drain(ctx, passArgs('gmail'));

    expect(storedIds()).toEqual(mails.map((mail) => `${mail.id}@mail.test`));
    // The position stands on Gmail's own clock, at the newest email read.
    expect(rows[0]?.mailSyncInboundSince).toBe(mails.at(-1)?.internalDate);
  });

  it('pages through a Gmail backlog bigger than a listing page', async () => {
    const position = NOW - 10 * DAY;
    const mails = gmailInbox(700, position, 10 * MINUTE);
    const { ctx } = world(gmail(mails), [
      { ...SUPPORT, mailSyncInboundSince: position },
    ]);

    await drain(ctx, passArgs('gmail', { limit: 100 }), 60);

    expect(storedIds()).toEqual(mails.map((mail) => `${mail.id}@mail.test`));
  });

  it('keeps reading Gmail after an email whose sender dated it years ahead', async () => {
    const position = NOW - DAY;
    const mails: GmailMail[] = [
      {
        id: 'g-future',
        label: 'INBOX',
        internalDate: NOW - 20 * MINUTE,
        dateHeader: 'Tue, 01 Jan 2030 00:00:00 +0000',
      },
      { id: 'g-next', label: 'INBOX', internalDate: NOW - 10 * MINUTE },
    ];
    const provider = gmail(mails);
    const { ctx, rows } = world(provider, [
      { ...SUPPORT, mailSyncInboundSince: position },
    ]);

    await syncMailbox(ctx, passArgs('gmail'));
    mails.push({ id: 'g-later', label: 'INBOX', internalDate: NOW - MINUTE });
    await syncMailbox(ctx, passArgs('gmail'));

    expect(storedIds()).toEqual([
      'g-future@mail.test',
      'g-next@mail.test',
      'g-later@mail.test',
    ]);
    expect(rows[0]?.mailSyncInboundSince).toBe(NOW - MINUTE);
  });

  it('reads on past a Gmail second fuller than a pass, after emails already read in the position’s own second', async () => {
    const second = Math.floor((NOW - DAY) / 1000);
    // Two emails of the position's own second were read on an earlier pass.
    const read: GmailMail[] = [
      { id: 'g-read-1', label: 'INBOX', internalDate: second * 1000 + 100 },
      { id: 'g-read-2', label: 'INBOX', internalDate: second * 1000 + 500 },
    ];
    for (const mail of read) {
      stored.push({ messageId: `${mail.id}@mail.test`, folder: 'inbox' });
    }
    // A later second holds more than a pass minus those two, so every window
    // that reaches it is too full and every one that stops short holds only
    // the two read already.
    const burst: GmailMail[] = Array.from({ length: 9 }, (_, i) => ({
      id: `g-burst-${i + 1}`,
      label: 'INBOX',
      internalDate: (second + 3) * 1000 + 10 * i,
    }));
    const later = gmailInbox(5, (second + 5) * 1000);
    const { ctx } = world(gmail([...read, ...burst, ...later]), [
      { ...SUPPORT, mailSyncInboundSince: second * 1000 + 500 },
    ]);

    await drain(ctx, passArgs('gmail', { limit: 10 }));

    expect(storedIds()).toEqual(
      [...read, ...burst, ...later].map((mail) => `${mail.id}@mail.test`),
    );
  });

  it('reads on past a Gmail second fuller than a pass, pass after pass', async () => {
    const second = Math.floor((NOW - DAY) / 1000) + 60;
    const burst: GmailMail[] = Array.from({ length: 15 }, (_, i) => ({
      id: `g-burst-${i + 1}`,
      label: 'INBOX',
      internalDate: second * 1000 + i,
    }));
    const later = gmailInbox(3, (second + 60) * 1000);
    const { ctx } = world(gmail([...burst, ...later]), [
      { ...SUPPORT, mailSyncInboundSince: NOW - DAY },
    ]);

    await drain(ctx, passArgs('gmail', { limit: 10 }));

    expect(storedIds()).toEqual(
      [...burst, ...later].map((mail) => `${mail.id}@mail.test`),
    );
  });

  it('follows Gmail’s page token, never taking a short page for the whole window', async () => {
    const position = NOW - DAY;
    const mails = gmailInbox(10, position);
    const { ctx } = world(gmail(mails, {}, { pageSize: 3 }), [
      { ...SUPPORT, mailSyncInboundSince: position },
    ]);

    await drain(ctx, passArgs('gmail'));

    expect(storedIds()).toEqual(mails.map((mail) => `${mail.id}@mail.test`));
  });

  it('reads an Outlook backlog oldest first, each email once', async () => {
    const position = NOW - DAY;
    const mails: OutlookMail[] = Array.from({ length: 40 }, (_, i) => ({
      id: `o${i + 1}`,
      folder: 'inbox',
      receivedDateTime: iso(position + (i + 1) * MINUTE),
      sentDateTime: iso(position + (i + 1) * MINUTE - 5_000),
    }));
    const { ctx } = world(outlook(mails), [
      { ...SUPPORT, mailSyncInboundSince: position },
    ]);

    await drain(ctx, passArgs('outlook'));

    expect(storedIds()).toEqual(mails.map((mail) => `${mail.id}@mail.test`));
  });

  it('never stops between two Outlook emails of the same second', async () => {
    const position = NOW - DAY;
    const second = position + 10 * MINUTE;
    const mails: OutlookMail[] = [
      {
        id: 'o1',
        folder: 'inbox',
        receivedDateTime: iso(position + MINUTE),
        sentDateTime: iso(position + MINUTE),
      },
      {
        id: 'o2',
        folder: 'inbox',
        receivedDateTime: iso(second),
        sentDateTime: iso(second),
      },
      {
        id: 'o3',
        folder: 'inbox',
        receivedDateTime: iso(second),
        sentDateTime: iso(second),
      },
      {
        id: 'o4',
        folder: 'inbox',
        receivedDateTime: iso(second),
        sentDateTime: iso(second),
      },
      {
        id: 'o5',
        folder: 'inbox',
        receivedDateTime: iso(second + 1000),
        sentDateTime: iso(second + 1000),
      },
    ];
    const { ctx } = world(outlook(mails), [
      { ...SUPPORT, mailSyncInboundSince: position },
    ]);

    await drain(ctx, passArgs('outlook', { limit: 2 }));

    expect([...storedIds()].sort()).toEqual(
      mails.map((mail) => `${mail.id}@mail.test`).sort(),
    );
    expect(stored).toHaveLength(5);
  });

  it('reads a burst of more email than one pass in a single Outlook second whole', async () => {
    const position = NOW - DAY;
    const second = iso(position + 10 * MINUTE);
    const mails: OutlookMail[] = [
      ...Array.from({ length: 7 }, (_, i) => ({
        id: `o-burst-${i + 1}`,
        folder: 'inbox' as const,
        receivedDateTime: second,
        sentDateTime: second,
      })),
      {
        id: 'o-after',
        folder: 'inbox',
        receivedDateTime: iso(position + 11 * MINUTE),
        sentDateTime: iso(position + 11 * MINUTE),
      },
    ];
    const { ctx, rows } = world(outlook(mails), [
      { ...SUPPORT, mailSyncInboundSince: position },
    ]);

    const first = await syncMailbox(ctx, passArgs('outlook', { limit: 3 }));

    // The second cannot be split, so the pass reads it whole, past its limit.
    expect(stored).toHaveLength(7);
    expect(receiptsOf(first)[0]).toMatchObject({ capped: true, ingested: 7 });
    expect(rows[0]?.mailSyncInboundSince).toBe(Date.parse(second));
    await drain(ctx, passArgs('outlook', { limit: 3 }));
    expect(stored).toHaveLength(8);
    expect(storedIds().at(-1)).toBe('o-after@mail.test');
  });

  it('spends a bounded number of listings per pass on a large Gmail backlog', async () => {
    const position = NOW - 7 * DAY;
    const mails = gmailInbox(3000, position, 3 * MINUTE);
    const { ctx, calls } = world(gmail(mails), [
      { ...SUPPORT, mailSyncInboundSince: position },
    ]);

    await syncMailbox(ctx, passArgs('gmail', { limit: 50 }));

    const listings = calls.filter((call) => call.action === 'list_messages');
    expect(listings.length).toBeLessThanOrEqual(33);
    expect(stored.length).toBeGreaterThanOrEqual(25);
    expect(stored.length).toBeLessThanOrEqual(50);
    // The oldest of the backlog, without a gap.
    expect(storedIds()).toEqual(
      mails.slice(0, stored.length).map((mail) => `${mail.id}@mail.test`),
    );
  });

  it('reads an IMAP backlog on the server clock, oldest first', async () => {
    const position = NOW - DAY;
    const mails = imapInbox(40, position);
    // One sender's clock runs a week behind: its Date header sits before the
    // position, but the server took the email in after it.
    const late = mails[30];
    if (late !== undefined) late.date = position - 7 * DAY;
    const { ctx } = world(imap(mails), [
      { ...SUPPORT, mailSyncInboundSince: position },
    ]);

    await drain(ctx, passArgs('imap-smtp'));

    expect(storedIds()).toEqual(
      mails.map((mail) => `inbox-${mail.uid}@mail.test`),
    );
  });

  it('reads at most the limit per pass, Inbox and Sent together', async () => {
    const position = NOW - DAY;
    const mails: ImapMail[] = [
      ...imapInbox(30, position),
      ...imapInbox(30, position + 30_000).map((mail): ImapMail => ({
        uid: mail.uid + 500,
        folder: 'sent',
        receivedAt: mail.receivedAt,
      })),
    ];
    const { ctx } = world(imap(mails), [
      {
        ...SUPPORT,
        mailSyncInboundSince: position,
        mailSyncOutboundSince: position,
      },
    ]);

    const first = await syncMailbox(
      ctx,
      passArgs('imap-smtp', { includeSent: true }),
    );

    expect(stored).toHaveLength(25);
    expect(receiptsOf(first)[0]).toMatchObject({ capped: true });
  });
});

// --------------------------------------------------------- the first pass

describe("a mailbox's first pass reads back a bounded window [CONV-R18]", () => {
  it('reads the last seven days of a new Gmail mailbox, oldest first, over several passes', async () => {
    const old: GmailMail = {
      id: 'g-old',
      label: 'INBOX',
      internalDate: NOW - 10 * DAY,
    };
    const recent = gmailInbox(30, NOW - 3 * DAY, 60 * MINUTE);
    const { ctx } = world(gmail([old, ...recent]), [{ ...SUPPORT }]);

    await drain(ctx, passArgs('gmail', { backfillDays: 7 }));

    expect(storedIds()).toEqual(recent.map((mail) => `${mail.id}@mail.test`));
  });

  it('reads the window of a new Outlook mailbox, not the whole history', async () => {
    const mails: OutlookMail[] = [
      {
        id: 'o-month',
        folder: 'inbox',
        receivedDateTime: iso(NOW - 30 * DAY),
        sentDateTime: iso(NOW - 30 * DAY),
      },
      {
        id: 'o-day',
        folder: 'inbox',
        receivedDateTime: iso(NOW - DAY),
        sentDateTime: iso(NOW - DAY),
      },
    ];
    const { ctx } = world(outlook(mails), [{ ...SUPPORT }]);

    await drain(ctx, passArgs('outlook', { backfillDays: 7 }));

    expect(storedIds()).toEqual(['o-day@mail.test']);
  });

  it('reads all of the window of a new IMAP mailbox, not only its newest page', async () => {
    const mails = imapInbox(40, NOW - 3 * DAY, 60 * MINUTE);
    const { ctx } = world(imap(mails), [{ ...SUPPORT }]);

    await drain(ctx, passArgs('imap-smtp', { backfillDays: 7 }));

    expect(storedIds()).toEqual(
      mails.map((mail) => `inbox-${mail.uid}@mail.test`),
    );
  });

  it('reads back seven days when nothing says otherwise', async () => {
    const mails: GmailMail[] = [
      { id: 'g-8d', label: 'INBOX', internalDate: NOW - 8 * DAY },
      { id: 'g-6d', label: 'INBOX', internalDate: NOW - 6 * DAY },
    ];
    const { ctx } = world(gmail(mails), [{ ...SUPPORT }]);

    await drain(ctx, passArgs('gmail'));

    expect(storedIds()).toEqual(['g-6d@mail.test']);
  });

  it('with no days to read back, takes only mail that arrives after the first pass', async () => {
    const mails: GmailMail[] = [
      { id: 'g-before', label: 'INBOX', internalDate: NOW - 5 * MINUTE },
    ];
    const { ctx, rows } = world(gmail(mails), [{ ...SUPPORT }]);

    await syncMailbox(ctx, passArgs('gmail', { backfillDays: 0 }));
    // The start is kept even though the pass found nothing, so the window
    // does not slide forward past mail that arrives between passes.
    expect(rows[0]?.mailSyncInboundSince).toBe(NOW);
    mails.push({ id: 'g-after', label: 'INBOX', internalDate: NOW + MINUTE });
    vi.setSystemTime(NOW + 5 * MINUTE);
    await syncMailbox(ctx, passArgs('gmail', { backfillDays: 0 }));

    expect(storedIds()).toEqual(['g-after@mail.test']);
  });

  it('treats a position in the future as none, and reads back the window', async () => {
    const mails = gmailInbox(3, NOW - 2 * DAY, 60 * MINUTE);
    const { ctx, rows } = world(gmail(mails), [
      // Left by a sync that trusted a sender's Date header.
      { ...SUPPORT, mailSyncInboundSince: Date.parse('2030-01-01T00:00:00Z') },
    ]);

    await drain(ctx, passArgs('gmail', { backfillDays: 7 }));

    expect(storedIds()).toEqual(mails.map((mail) => `${mail.id}@mail.test`));
    expect(rows[0]?.mailSyncInboundSince).toBe(mails.at(-1)?.internalDate);
  });
});

// -------------------------------------------------------------- Sent mail

describe('the sync reads the Sent folder so a thread holds both sides [CONV-R19]', () => {
  it('reads Sent for every provider unless the automation turns it off', async () => {
    const syncMailboxStore = vi.fn().mockResolvedValue({
      listed: 0,
      inbound: {
        created: false,
        processedCount: 0,
        skippedCount: 0,
        conversationIds: [],
      },
      mailboxes: [],
    });
    const natives = platformConversationNatives({
      syncMailbox: syncMailboxStore,
    } as unknown as Parameters<typeof platformConversationNatives>[0]);
    const native = natives['conversation.sync_mailbox'];
    const ctx = { organizationId: 'org' } as unknown as NativeConnectorContext;

    for (const connectorSlug of ['gmail', 'outlook', 'imap-smtp']) {
      await native?.({ connectorSlug }, ctx);
    }
    await native?.({ connectorSlug: 'gmail', includeSent: false }, ctx);

    expect(
      syncMailboxStore.mock.calls.map(
        (call) => (call[0] as { includeSent: boolean }).includeSent,
      ),
    ).toEqual([true, true, true, false]);
  });

  it('stores what the mailbox sent before the answer to it, in the order they happened', async () => {
    const position = NOW - DAY;
    const mails: OutlookMail[] = [
      {
        id: 'o-noah',
        folder: 'sentitems',
        receivedDateTime: iso(NOW - 30 * MINUTE),
        sentDateTime: iso(NOW - 30 * MINUTE),
        from: 'desk@example.com',
        to: 'hannah@customer.test',
      },
      {
        id: 'o-hannah',
        folder: 'inbox',
        receivedDateTime: iso(NOW - 20 * MINUTE),
        sentDateTime: iso(NOW - 20 * MINUTE),
        inReplyTo: 'o-noah',
      },
    ];
    const { ctx, rows } = world(outlook(mails), [
      {
        ...SUPPORT,
        mailSyncInboundSince: position,
        mailSyncOutboundSince: position,
      },
    ]);

    await syncMailbox(ctx, passArgs('outlook', { includeSent: true }));

    expect(stored).toEqual([
      { messageId: 'o-noah@mail.test', folder: 'sent' },
      { messageId: 'o-hannah@mail.test', folder: 'inbox' },
    ]);
    expect(rows[0]).toMatchObject({
      mailSyncInboundSince: NOW - 20 * MINUTE,
      mailSyncOutboundSince: NOW - 30 * MINUTE,
    });
  });

  it('reads a Gmail email labelled both Sent and Inbox once', async () => {
    const position = NOW - DAY;
    const note: GmailMail = {
      id: 'g-self',
      label: 'SENT',
      internalDate: NOW - 5 * MINUTE,
      from: 'desk@example.com',
      to: 'desk@example.com',
    };
    const provider = gmail([note]);
    const { ctx, calls } = world(
      (call) => {
        // Gmail answers the same message under both labels.
        if (call.action === 'list_messages') {
          return provider({
            ...call,
            input: { ...call.input, labelIds: 'SENT' },
          });
        }
        return provider(call);
      },
      [
        {
          ...SUPPORT,
          mailSyncInboundSince: position,
          mailSyncOutboundSince: position,
        },
      ],
    );

    const result = await syncMailbox(
      ctx,
      passArgs('gmail', { includeSent: true }),
    );

    expect(stored).toEqual([{ messageId: 'g-self@mail.test', folder: 'sent' }]);
    expect(calls.filter((call) => call.action === 'get_message')).toHaveLength(
      1,
    );
    expect(receiptsOf(result)[0]).toMatchObject({ listed: 1, ingested: 1 });
  });

  it('stores a reply sent from the Inbox once, even when its record kept Gmail’s own id', async () => {
    // The send could not read the reply's Message-ID back from Gmail, so the
    // Inbox recorded it under Gmail's own id.
    stored.push({ messageId: 'g-reply', folder: 'sent' });
    const mails: GmailMail[] = [
      {
        id: 'g-reply',
        label: 'SENT',
        internalDate: NOW - 10 * MINUTE,
        from: 'desk@example.com',
        to: 'hannah@customer.test',
      },
    ];
    const { ctx } = world(gmail(mails), [
      {
        ...SUPPORT,
        mailSyncInboundSince: NOW - DAY,
        mailSyncOutboundSince: NOW - DAY,
      },
    ]);

    const result = await syncMailbox(
      ctx,
      passArgs('gmail', { includeSent: true }),
    );

    expect(stored).toEqual([
      { messageId: 'g-reply@mail.test', folder: 'sent' },
    ]);
    expect(receiptsOf(result)[0]).toMatchObject({ ingested: 0, duplicates: 1 });
  });

  it('reads Gmail Sent and Inbox in one order on Gmail’s clock', async () => {
    const position = NOW - DAY;
    const mails: GmailMail[] = [
      {
        id: 'g-hannah',
        label: 'INBOX',
        internalDate: NOW - 20 * MINUTE,
        inReplyTo: 'g-noah',
      },
      {
        id: 'g-noah',
        label: 'SENT',
        internalDate: NOW - 30 * MINUTE,
        from: 'desk@example.com',
        to: 'hannah@customer.test',
      },
    ];
    const { ctx } = world(gmail(mails), [
      {
        ...SUPPORT,
        mailSyncInboundSince: position,
        mailSyncOutboundSince: position,
      },
    ]);

    await syncMailbox(ctx, passArgs('gmail', { includeSent: true }));

    expect(stored).toEqual([
      { messageId: 'g-noah@mail.test', folder: 'sent' },
      { messageId: 'g-hannah@mail.test', folder: 'inbox' },
    ]);
  });
});

// ------------------------------------------------- slowing down, vanishing

describe('a provider that asks to slow down stops a pass, losing nothing [CONV-R20]', () => {
  it('stops a Gmail pass at the rate limit, keeps what it read and continues next pass', async () => {
    const position = NOW - DAY;
    const mails = gmailInbox(5, position);
    const failures: Record<string, string> = {
      g0003:
        'the live gmail.get_message call failed: Gmail get_message failed (429, retry after 30s): rateLimitExceeded',
    };
    const { ctx } = world(gmail(mails, failures), [
      { ...SUPPORT, mailSyncInboundSince: position },
    ]);

    const first = await syncMailbox(ctx, passArgs('gmail'));
    const receipt = receiptsOf(first)[0];

    expect(storedIds()).toEqual(['g0001@mail.test', 'g0002@mail.test']);
    expect(receipt).toMatchObject({
      mailbox: 'Support',
      ok: true,
      rateLimited: true,
      retryAfter: iso(NOW + 30_000),
    });

    delete failures.g0003;
    await drain(ctx, passArgs('gmail'));
    expect(storedIds()).toEqual(mails.map((mail) => `${mail.id}@mail.test`));
  });

  it('treats a Gmail 403 rateLimitExceeded as a rate limit, not a failure', async () => {
    const position = NOW - DAY;
    const mails = gmailInbox(2, position);
    const { ctx } = world(
      gmail(mails, {
        g0001:
          'the live gmail.get_message call failed: Gmail get_message failed (403): {"error":{"errors":[{"reason":"userRateLimitExceeded"}]}}',
      }),
      [{ ...SUPPORT, mailSyncInboundSince: position }],
    );

    const result = await syncMailbox(ctx, passArgs('gmail'));

    expect(receiptsOf(result)[0]).toMatchObject({
      ok: true,
      rateLimited: true,
    });
    // Gmail named no wait, so the receipt names none.
    expect(receiptsOf(result)[0]?.retryAfter).toBeUndefined();
  });

  it('names the wait Graph asks for and keeps the Outlook position', async () => {
    const position = NOW - DAY;
    const { ctx, rows } = world(
      outlook([], {
        list_messages:
          'the live outlook.list_messages call failed: Outlook list_messages failed: rate limited by Microsoft Graph (retry after 120s) — retry later.',
      }),
      [{ ...SUPPORT, mailSyncInboundSince: position }],
    );

    const result = await syncMailbox(ctx, passArgs('outlook'));

    expect(receiptsOf(result)[0]).toMatchObject({
      ok: true,
      rateLimited: true,
      retryAfter: iso(NOW + 120_000),
    });
    expect(rows[0]?.mailSyncInboundSince).toBe(position);
  });

  it('keeps what an IMAP pass read before the connection dropped', async () => {
    const position = NOW - DAY;
    const mails = imapInbox(4, position);
    const failures: Record<string, string> = {
      'inbox:3':
        'the live imap-smtp.get_message call failed: IMAP connection closed unexpectedly',
    };
    const { ctx, rows } = world(imap(mails, failures), [
      { ...SUPPORT, mailSyncInboundSince: position },
    ]);

    // The only mailbox failed, so the run fails — after keeping its progress.
    await expect(syncMailbox(ctx, passArgs('imap-smtp'))).rejects.toThrow(
      /connection closed/,
    );
    expect(storedIds()).toEqual(['inbox-1@mail.test', 'inbox-2@mail.test']);
    expect(rows[0]?.mailSyncInboundSince).toBe(mails[1]?.receivedAt);

    delete failures['inbox:3'];
    await drain(ctx, passArgs('imap-smtp'));
    expect(storedIds()).toEqual(
      mails.map((mail) => `inbox-${mail.uid}@mail.test`),
    );
  });

  it('skips an email deleted between the listing and the read', async () => {
    const position = NOW - DAY;
    const mails = gmailInbox(3, position);
    const provider = gmail(mails);
    const { ctx } = world(
      (call) => {
        // The second email is listed, then deleted before its read.
        if (call.action === 'get_message' && call.input.messageId === 'g0002') {
          return gmail([])(call);
        }
        return provider(call);
      },
      [{ ...SUPPORT, mailSyncInboundSince: position }],
    );

    const result = await syncMailbox(ctx, passArgs('gmail'));

    expect(storedIds()).toEqual(['g0001@mail.test', 'g0003@mail.test']);
    expect(receiptsOf(result)[0]).toMatchObject({ ok: true, vanished: 1 });
  });
});

describe('a connector with no connected mailbox', () => {
  it('fails, naming the connector, rather than reading with no position to keep [CONV-R23]', async () => {
    const { ctx, calls } = world(imap(imapInbox(2, NOW - DAY)), []);

    await expect(syncMailbox(ctx, passArgs('imap-smtp'))).rejects.toThrow(
      /no active imap-smtp mailbox is connected/,
    );
    expect(calls).toEqual([]);
  });
});

// --------------------------------------------------------- the receipt

describe('every pass says per mailbox what it read, stored and left [CONV-R22]', () => {
  it('counts new, already stored, unstorable and vanished email, and where it resumes', async () => {
    const position = NOW - DAY;
    const mails: GmailMail[] = [
      { id: 'g-new', label: 'INBOX', internalDate: NOW - 40 * MINUTE },
      { id: 'g-known', label: 'INBOX', internalDate: NOW - 30 * MINUTE },
      {
        id: 'g-headless',
        label: 'INBOX',
        internalDate: NOW - 20 * MINUTE,
        noMessageId: true,
      },
      { id: 'g-gone', label: 'INBOX', internalDate: NOW - 10 * MINUTE },
    ];
    stored.push({ messageId: 'g-known@mail.test', folder: 'inbox' });
    const provider = gmail(mails);
    const { ctx } = world(
      (call) =>
        call.action === 'get_message' && call.input.messageId === 'g-gone'
          ? gmail([])(call)
          : provider(call),
      [{ ...SUPPORT, mailSyncInboundSince: position }],
    );

    const result = await syncMailbox(ctx, passArgs('gmail'));

    expect(receiptsOf(result)).toEqual([
      {
        mailbox: 'Support',
        ok: true,
        listed: 4,
        fetched: 3,
        ingested: 1,
        duplicates: 1,
        skipped: 1,
        vanished: 1,
        capped: false,
        resumeFrom: { inbox: iso(NOW - 20 * MINUTE) },
      },
    ]);
  });

  it('says more is waiting when a pass reached its limit', async () => {
    const position = NOW - DAY;
    const { ctx } = world(gmail(gmailInbox(30, position)), [
      { ...SUPPORT, mailSyncInboundSince: position },
    ]);

    const result = await syncMailbox(ctx, passArgs('gmail', { limit: 10 }));

    expect(stored.length).toBeLessThanOrEqual(10);
    expect(stored.length).toBeGreaterThan(0);
    expect(receiptsOf(result)[0]).toMatchObject({ capped: true });
  });
});

// ------------------------------------------------- one mailbox or every one

describe('an automation syncs one named mailbox or every mailbox [CONV-R23]', () => {
  const SALES: CredentialRow = {
    id: 'cred_sales',
    name: 'Sales',
    isDefault: false,
  };

  it('reads only the mailbox it names', async () => {
    const mails = gmailInbox(1, NOW - DAY);
    const { ctx, calls } = world(gmail(mails), [
      { ...SUPPORT, mailSyncInboundSince: NOW - 2 * DAY },
      { ...SALES, mailSyncInboundSince: NOW - 2 * DAY },
    ]);

    const result = await syncMailbox(
      ctx,
      passArgs('gmail', { mailbox: 'Sales' }),
    );

    expect(new Set(calls.map((call) => call.credentialRef))).toEqual(
      new Set(['cred_sales']),
    );
    expect(receiptsOf(result).map((receipt) => receipt.mailbox)).toEqual([
      'Sales',
    ]);
  });

  it('refuses a mailbox name no active connection carries', async () => {
    const { ctx, calls } = world(gmail([]), [{ ...SUPPORT }]);

    await expect(
      syncMailbox(ctx, passArgs('gmail', { mailbox: 'Marketing' })),
    ).rejects.toThrow(/no active gmail mailbox is named "Marketing"/);
    expect(calls).toEqual([]);
  });

  it('reads every active mailbox when it names none', async () => {
    const { ctx } = world(gmail(gmailInbox(1, NOW - DAY)), [
      { ...SUPPORT, mailSyncInboundSince: NOW - 2 * DAY },
      { ...SALES, mailSyncInboundSince: NOW - 2 * DAY },
    ]);

    const result = await syncMailbox(ctx, passArgs('gmail', { mailbox: '' }));

    expect(receiptsOf(result).map((receipt) => receipt.mailbox)).toEqual([
      'Support',
      'Sales',
    ]);
  });
});
