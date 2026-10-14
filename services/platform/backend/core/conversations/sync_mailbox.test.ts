/**
 * The sync orchestrator's contract with the three mail connectors: which
 * cursor it reads, what it asks each provider for, and what it hands the
 * ingest helpers. Dedupe and threading belong to those helpers (see
 * `ingest/create_conversation_from_email.test.ts`); here every connector call
 * is captured so a provider's parameter names cannot drift silently.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import {
  listMailboxMessages,
  querySyncCursor,
  syncMailbox,
} from './sync_mailbox';

/** The ingestedTip the real ingest helpers report — the tip of the window they
 * cover. The sync advances the watermark to this, so the mock must carry it. */
function ingestedTipFor(args: unknown): number | null {
  const emails =
    isRecord(args) && 'emails' in args
      ? (args as { emails: unknown }).emails
      : [];
  return tipOfEmails(normalizeEmails(emails));
}

interface ConnectorCall {
  connector: string;
  action: string;
  input: Record<string, unknown>;
  mode: string;
  credentialRef?: string;
}

type Reply = (call: ConnectorCall) => unknown;

interface HarnessOptions {
  outcome?: { status: 'ok' } | { status: 'error'; message: string };
  /** Active credentials listActiveCredentialsInternal returns (default: the
   * one mailbox `DESK`). */
  credentials?: Array<{
    id: string;
    name: string;
    isDefault: boolean;
    mailSyncInboundSince?: number;
    mailSyncOutboundSince?: number;
  }>;
  /** Credential ids whose connector calls fail — one unreachable mailbox. */
  failCredentials?: Record<string, string>;
  /** Message ids whose `get_message` fails — one message gone since the list. */
  failMessages?: Record<string, string>;
  /** The credential row `resolveCredentialRefInternal` serves the OAuth
   * from-address heal (default: none, so the heal finds nothing to patch). */
  credentialRow?: Record<string, unknown>;
  /**
   * Already-ingested messages, by normalized external id — what
   * `getMessageByExternalId` finds. Lets a test re-fetch a message the org
   * already has, which is what every poll does to the message on the cursor.
   */
  existingMessages?: Record<string, { metadata?: unknown }>;
}

/** The one connected mailbox a test reads unless it names others: its Inbox
 * read up to 5 s, its Sent folder up to 7 s — distinct, so a swapped
 * position shows. */
const DESK = {
  id: 'cred_desk',
  name: 'Desk',
  isDefault: true,
  mailSyncInboundSince: 5000,
  mailSyncOutboundSince: 7000,
};

/** A ctx whose only capability is the nested connector action + credential list. */
function harness(
  reply: Reply,
  options: HarnessOptions = {},
): {
  ctx: ActionCtx;
  calls: ConnectorCall[];
  cursorPatches: Array<Record<string, unknown>>;
  trace: string[];
} {
  const outcome = options.outcome ?? { status: 'ok' };
  const credentials = options.credentials ?? [DESK];
  const failCredentials = options.failCredentials ?? {};
  const failMessages = options.failMessages ?? {};
  const existingMessages = options.existingMessages ?? {};
  const calls: ConnectorCall[] = [];
  const cursorPatches: Array<Record<string, unknown>> = [];
  // Every ctx hop in order — connector calls AND the blob lane, so a test can
  // see whether attachment bytes drain between fetches or pile up after them.
  const trace: string[] = [];
  let stored = 0;
  const runAction = async (
    _ref: unknown,
    args: Record<string, unknown>,
  ): Promise<unknown> => {
    // `storeOrgBlob` rides the same runAction seam but is not a connector call.
    if (args.bytes !== undefined) {
      stored += 1;
      trace.push(`store:${String(args.contentType)}`);
      return `storage-${stored}`;
    }
    const call: ConnectorCall = {
      connector: String(args.connector),
      action: String(args.action),
      input: isRecord(args.input) ? args.input : {},
      mode: String(args.mode),
      ...(typeof args.credentialRef === 'string'
        ? { credentialRef: args.credentialRef }
        : {}),
    };
    calls.push(call);
    trace.push(
      call.action === 'get_message'
        ? `get:${String(call.input.uid ?? call.input.messageId)}`
        : call.action,
    );
    if (outcome.status === 'error') return outcome;
    const failure =
      call.credentialRef !== undefined
        ? failCredentials[call.credentialRef]
        : undefined;
    if (failure !== undefined) return { status: 'error', message: failure };
    const gone =
      call.action === 'get_message'
        ? failMessages[String(call.input.uid ?? call.input.messageId)]
        : undefined;
    if (gone !== undefined) return { status: 'error', message: gone };
    return { status: 'ok', output: reply(call) };
  };
  const runQuery = async (
    ref: unknown,
    args?: Record<string, unknown>,
  ): Promise<unknown> => {
    // `getMessageByExternalId` shares this seam with the credential list.
    if (args !== undefined && typeof args.externalMessageId === 'string') {
      return existingMessages[args.externalMessageId] ?? null;
    }
    // The OAuth from-address heal reads one credential row by ref.
    if (functionRefName(ref).endsWith('resolveCredentialRefInternal')) {
      return options.credentialRow ?? null;
    }
    return credentials;
  };
  const runMutation = async (
    _ref: unknown,
    args: Record<string, unknown>,
  ): Promise<null> => {
    // `saveFileMetadata` shares this seam with the watermark patch.
    if (args.storageId === undefined) cursorPatches.push(args);
    return null;
  };
  return {
    ctx: { runAction, runQuery, runMutation } as unknown as ActionCtx,
    calls,
    cursorPatches,
    trace,
  };
}

/** Each provider names the Sent folder its own way. */
function wantsSent(input: Record<string, unknown>): boolean {
  return (
    input.mailbox === 'sent' ||
    input.labelIds === 'SENT' ||
    input.folder === 'sentitems'
  );
}

/** Envelopes in, one body per envelope out — the shape all three providers share. */
function mailbox(inbox: unknown[], sent: unknown[] = []): Reply {
  return (call) => {
    if (call.action === 'list_messages') {
      return { messages: wantsSent(call.input) ? sent : inbox };
    }
    const id = call.input.uid ?? call.input.messageId;
    const body = { messageId: `<body-${String(id)}@example.com>` };
    return call.connector === 'imap-smtp'
      ? { uid: String(id), email: body }
      : { message: body, attachments: [] };
  };
}

const INGESTED = {
  created: true,
  processedCount: 1,
  skippedCount: 0,
  conversationIds: ['conv_1'],
};

function inputsFor(calls: ConnectorCall[], action: string): unknown[] {
  return calls.filter((call) => call.action === action).map((c) => c.input);
}

beforeEach(() => {
  createConversationFromEmail
    .mockReset()
    .mockImplementation((_ctx: unknown, args: unknown) =>
      Promise.resolve({ ...INGESTED, ingestedTip: ingestedTipFor(args) }),
    );
  createConversationFromSentEmail
    .mockReset()
    .mockImplementation((_ctx: unknown, args: unknown) =>
      Promise.resolve({
        ...INGESTED,
        created: false,
        ingestedTip: ingestedTipFor(args),
      }),
    );
  resolveConnectorAccountEmail
    .mockReset()
    .mockResolvedValue('desk@example.com');
  // Inbound cursor at 5s, outbound at 7s — distinct so a swapped cursor shows.
  queryLatestMessageByDeliveryState.mockReset().mockResolvedValue({
    message: { externalMessageId: '<in@x>', deliveredAt: 5000 },
  });
  queryLatestOutboundMessageForEmailSync.mockReset().mockResolvedValue({
    message: { externalMessageId: '<out@x>', sentAt: 7000 },
  });
});

describe('syncMailbox over IMAP', () => {
  it('lists each folder after its own position and reads both in one order', async () => {
    const { ctx, calls, cursorPatches } = harness(
      mailbox(
        [{ uid: '11', receivedAt: 6000 }],
        [{ uid: 99, receivedAt: 8000 }],
      ),
    );

    const result = await syncMailbox(ctx, {
      organizationId: 'org',
      connectorSlug: 'imap-smtp',
      limit: 25,
      includeSent: true,
      mode: 'live',
    });

    // One more than the pass reads, to tell whether more is waiting; the
    // email the Inbox received first is read first, whichever folder holds it.
    expect(calls.map((call) => [call.action, call.input])).toEqual([
      ['list_messages', { limit: 26, after: 7000, mailbox: 'sent' }],
      ['list_messages', { limit: 26, after: 5000 }],
      ['get_message', { uid: '11' }],
      ['get_message', { uid: '99', mailbox: 'sent' }],
    ]);
    expect(calls.every((call) => call.mode === 'live')).toBe(true);

    expect(createConversationFromEmail).toHaveBeenCalledWith(ctx, {
      organizationId: 'org',
      connectorName: 'imap-smtp',
      accountEmail: 'desk@example.com',
      status: 'open',
      credentialId: 'cred_desk',
      emails: [{ messageId: '<body-11@example.com>' }],
    });
    // Each folder's position moves to the arrival of the email it read.
    expect(cursorPatches).toEqual([
      {
        organizationId: 'org',
        credentialId: 'cred_desk',
        mailSyncInboundSince: 6000,
        mailSyncOutboundSince: 8000,
      },
    ]);
    expect(createConversationFromSentEmail).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        emails: [{ messageId: '<body-99@example.com>' }],
      }),
    );
    expect(result).toEqual({
      listed: 2,
      inbound: INGESTED,
      sent: { ...INGESTED, created: false },
      mailboxes: [
        {
          mailbox: 'Desk',
          ok: true,
          listed: 2,
          fetched: 2,
          ingested: 2,
          duplicates: 0,
          skipped: 0,
          vanished: 0,
          capped: false,
          resumeFrom: {
            inbox: new Date(6000).toISOString(),
            sent: new Date(8000).toISOString(),
          },
        },
      ],
    });
  });

  it('starts a first pass at its window and skips the Sent folder when asked', async () => {
    const now = Date.parse('2026-10-14T12:00:00.000Z');
    vi.useFakeTimers({ now, toFake: ['Date'] });
    try {
      const { ctx, calls } = harness(
        mailbox([{ uid: '1', receivedAt: now - 60_000 }]),
        { credentials: [{ id: 'cred_desk', name: 'Desk', isDefault: true }] },
      );

      const result = await syncMailbox(ctx, {
        organizationId: 'org',
        connectorSlug: 'imap-smtp',
        limit: 10,
        includeSent: false,
        mode: 'live',
        backfillDays: 3,
      });

      expect(inputsFor(calls, 'list_messages')).toEqual([
        { limit: 11, after: now - 3 * 86_400_000 },
      ]);
      expect(createConversationFromSentEmail).not.toHaveBeenCalled();
      expect(result.sent).toBeUndefined();
      expect(queryLatestOutboundMessageForEmailSync).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves out an envelope with no UID rather than fetching a bad message', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const { ctx, calls } = harness(
        mailbox([
          { subject: 'no uid', receivedAt: 6000 },
          { uid: 7, receivedAt: 6500 },
        ]),
      );

      const result = await syncMailbox(ctx, {
        organizationId: 'org',
        connectorSlug: 'imap-smtp',
        limit: 25,
        includeSent: false,
        mode: 'live',
      });

      expect(inputsFor(calls, 'get_message')).toEqual([{ uid: '7' }]);
      // Only the addressable envelope is listed for the pass and ingested.
      expect(result.listed).toBe(1);
      expect(createConversationFromEmail).toHaveBeenCalledWith(
        ctx,
        expect.objectContaining({
          emails: [{ messageId: '<body-7@example.com>' }],
        }),
      );
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('carries no id or arrival time'),
      );
    } finally {
      warn.mockRestore();
    }
  });
});

describe('syncMailbox over Gmail', () => {
  it('searches each folder by label from the second its position falls in', async () => {
    const { ctx, calls } = harness(
      mailbox([{ id: 'g1', threadId: 't1' }], [{ id: 'g2', threadId: 't1' }]),
    );

    await syncMailbox(ctx, {
      organizationId: 'org',
      connectorSlug: 'gmail',
      limit: 50,
      includeSent: true,
      mode: 'live',
    });

    // INBOX and SENT are named, never implied: an unlabelled
    // `users.messages.list` answers every folder, and the mailbox's own mail
    // opened conversations with the mailbox as the customer.
    expect(inputsFor(calls, 'list_messages')).toEqual([
      { maxResults: 51, q: 'after:7', labelIds: 'SENT' },
      { maxResults: 51, q: 'after:5', labelIds: 'INBOX' },
    ]);
    expect(inputsFor(calls, 'get_message')).toEqual([
      { messageId: 'g1' },
      { messageId: 'g2' },
    ]);
    expect(createConversationFromEmail).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        connectorName: 'gmail',
        emails: [{ messageId: '<body-g1@example.com>' }],
      }),
    );
  });
});

describe('syncMailbox over Outlook', () => {
  it('addresses each folder by name and filters it by its own date, from the next second', async () => {
    const { ctx, calls } = harness(
      mailbox(
        [{ id: 'o1', receivedDateTime: '1970-01-01T00:00:06Z' }],
        [{ id: 'o2', sentDateTime: '1970-01-01T00:00:08Z' }],
      ),
    );

    await syncMailbox(ctx, {
      organizationId: 'org',
      connectorSlug: 'outlook',
      limit: 25,
      includeSent: true,
      mode: 'live',
    });

    // Graph resolves `sentitems` as a path segment only, and rejects a filter
    // on one date field ordered by another — so each folder is filtered and
    // sorted on its own field, oldest first. Graph keeps whole seconds and a
    // position never splits one, so the listing starts at the next second.
    // The Inbox is a folder too: `/me/messages` spans every folder.
    expect(inputsFor(calls, 'list_messages')).toEqual([
      {
        top: 26,
        folder: 'sentitems',
        orderby: 'sentDateTime asc',
        filter: 'sentDateTime ge 1970-01-01T00:00:08.000Z',
        select: 'id,internetMessageId,receivedDateTime,sentDateTime',
      },
      {
        top: 26,
        folder: 'inbox',
        orderby: 'receivedDateTime asc',
        filter: 'receivedDateTime ge 1970-01-01T00:00:06.000Z',
        select: 'id,internetMessageId,receivedDateTime,sentDateTime',
      },
    ]);
  });
});

describe('syncMailbox attachment handling', () => {
  it('drains each message’s bytes before fetching the next one', async () => {
    // Attachment bytes ride inline as base64. Fetching the whole page first
    // and storing afterwards would hold `limit` messages’ payloads in this
    // action at once; storing per message keeps one body’s bytes resident.
    const reply: Reply = (call) => {
      if (call.action === 'list_messages') {
        return {
          messages: [
            { uid: '1', receivedAt: 6000 },
            { uid: '2', receivedAt: 6001 },
          ],
        };
      }
      const uid = String(call.input.uid);
      return {
        uid,
        email: {
          messageId: `<body-${uid}@example.com>`,
          date: '2025-04-04T00:00:00.000Z',
          attachments: [
            {
              id: `att-${uid}`,
              filename: `file-${uid}.pdf`,
              contentType: 'application/pdf',
              size: 3,
              contentBase64: Buffer.from(`pdf${uid}`).toString('base64'),
            },
          ],
        },
      };
    };
    const { ctx, trace } = harness(reply);

    await syncMailbox(ctx, {
      organizationId: 'org',
      connectorSlug: 'imap-smtp',
      limit: 25,
      includeSent: false,
      mode: 'live',
    });

    expect(trace).toEqual([
      'list_messages',
      'get:1',
      'store:application/pdf',
      'get:2',
      'store:application/pdf',
    ]);
  });

  // Every poll re-fetches at least the message sitting on the cursor: the
  // cursor is derived from that message's own timestamp and compared with `>=`,
  // so it satisfies its own filter forever. Storing is not idempotent — blob
  // keys are `randomUUID()` and `saveFileMetadata` dedupes on `storageId` — so
  // before this, one attachment on that message minted a fresh blob and a fresh
  // `fileMetadata` row on every poll, indefinitely.
  it('stores nothing again when re-fetching a message it already ingested', async () => {
    const reply: Reply = (call) =>
      call.action === 'list_messages'
        ? { messages: [{ uid: '1', receivedAt: 6000 }] }
        : {
            uid: '1',
            email: {
              messageId: '<already@example.com>',
              date: '2025-04-04T00:00:00.000Z',
              attachments: [
                {
                  // A different part handle than the stored one — per-fetch, so
                  // matching cannot rely on it.
                  id: 'part-2.1',
                  filename: 'report.pdf',
                  contentType: 'application/pdf',
                  size: 3,
                  contentBase64: Buffer.from('pdf').toString('base64'),
                },
              ],
            },
          };
    const { ctx, trace } = harness(reply, {
      existingMessages: {
        // Keyed WITHOUT angle brackets: the wire header carries them, the
        // stored id does not, and `normalizeExternalMessageId` strips them on
        // both write and lookup. Keying this by the wire form is how the first
        // draft of this test passed for the wrong reason.
        'already@example.com': {
          metadata: {
            attachments: [
              {
                id: 'part-1.2',
                filename: 'report.pdf',
                contentType: 'application/pdf',
                size: 3,
                storageId: 'storage-existing',
                url: '/storage/storage-existing/report.pdf',
              },
            ],
          },
        },
      },
    });

    await syncMailbox(ctx, {
      organizationId: 'org',
      connectorSlug: 'imap-smtp',
      limit: 25,
      includeSent: false,
      mode: 'live',
    });

    // The body is still fetched (identity only exists after parsing), but no
    // blob is written — no `store:` hop at all.
    expect(trace).toEqual(['list_messages', 'get:1']);
  });

  it('still stores when the already-ingested message has no stored bytes', async () => {
    // A chip from before attachment storage shipped, or a failed
    // materialization: this pass is the chance to fix it, so it must not be
    // mistaken for "already stored".
    const reply: Reply = (call) =>
      call.action === 'list_messages'
        ? { messages: [{ uid: '1', receivedAt: 6000 }] }
        : {
            uid: '1',
            email: {
              messageId: '<metaonly@example.com>',
              date: '2025-04-04T00:00:00.000Z',
              attachments: [
                {
                  id: 'part-2.1',
                  filename: 'report.pdf',
                  contentType: 'application/pdf',
                  size: 3,
                  contentBase64: Buffer.from('pdf').toString('base64'),
                },
              ],
            },
          };
    const { ctx, trace } = harness(reply, {
      existingMessages: {
        'metaonly@example.com': {
          metadata: {
            attachments: [
              {
                id: 'part-1.2',
                filename: 'report.pdf',
                contentType: 'application/pdf',
                size: 3,
              },
            ],
          },
        },
      },
    });

    await syncMailbox(ctx, {
      organizationId: 'org',
      connectorSlug: 'imap-smtp',
      limit: 25,
      includeSent: false,
      mode: 'live',
    });

    expect(trace).toEqual(['list_messages', 'get:1', 'store:application/pdf']);
  });

  it('hands ingest the stored reference, never the wire bytes', async () => {
    const reply: Reply = (call) =>
      call.action === 'list_messages'
        ? { messages: [{ uid: '1', receivedAt: 6000 }] }
        : {
            uid: '1',
            email: {
              messageId: '<body-1@example.com>',
              date: '2025-04-04T00:00:00.000Z',
              attachments: [
                {
                  id: 'cv',
                  filename: 'CV.pdf',
                  contentType: 'application/pdf',
                  size: 3,
                  contentBase64: Buffer.from('pdf').toString('base64'),
                },
              ],
            },
          };
    const { ctx } = harness(reply);

    await syncMailbox(ctx, {
      organizationId: 'org',
      connectorSlug: 'imap-smtp',
      limit: 25,
      includeSent: false,
      mode: 'live',
    });

    const ingested = createConversationFromEmail.mock.calls[0]?.[1] as {
      emails: Array<{
        attachments: Array<Record<string, unknown>>;
      }>;
    };
    const attachment = ingested.emails[0]?.attachments[0];
    expect(attachment).toMatchObject({
      id: 'cv',
      filename: 'CV.pdf',
      storageId: 'storage-1',
    });
    expect(attachment).not.toHaveProperty('contentBase64');
  });
});

/**
 * A raw Gmail `format=full` message with one attachment part. Gmail mints a
 * fresh attachment id on every fetch, so each response names its own.
 */
function gmailMessage(attachmentId: string, size = 3) {
  return {
    id: 'g1',
    payload: {
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'Message-ID', value: '<g1@example.com>' },
        { name: 'From', value: 'Ada <ada@example.com>' },
        { name: 'Date', value: 'Fri, 04 Apr 2025 00:00:00 +0000' },
      ],
      parts: [
        {
          mimeType: 'text/plain',
          body: { data: Buffer.from('See attached').toString('base64url') },
        },
        {
          mimeType: 'application/pdf',
          filename: 'report.pdf',
          headers: [],
          body: { attachmentId, size },
        },
      ],
    },
  };
}

/** One Gmail envelope; the plain fetch lists the part, and `withBytes`
 *  answers the fetch that asks for the attachments. */
function gmailMailbox(withBytes: (call: ConnectorCall) => unknown): Reply {
  return (call) => {
    if (call.action === 'list_messages') {
      return { messages: [{ id: 'g1', threadId: 't1' }] };
    }
    if (call.input.includeAttachments !== true) {
      return { message: gmailMessage('att-first-fetch'), attachments: [] };
    }
    return withBytes(call);
  };
}

function ingestedAttachments(): unknown {
  const ingested = createConversationFromEmail.mock.calls[0]?.[1] as {
    emails: Array<{ attachments?: unknown }>;
  };
  return ingested.emails[0]?.attachments;
}

async function syncOnce(ctx: ActionCtx, connectorSlug: string): Promise<void> {
  await syncMailbox(ctx, {
    organizationId: 'org',
    connectorSlug,
    limit: 25,
    includeSent: false,
    mode: 'live',
  });
}

describe('syncMailbox connector-stored attachments (Gmail, Outlook)', () => {
  it('asks Gmail for the bytes of a new message and ingests the stored reference', async () => {
    const { ctx, calls } = harness(
      gmailMailbox(() => ({
        message: gmailMessage('att-second-fetch'),
        attachments: [
          {
            id: 'att-second-fetch',
            filename: 'report.pdf',
            contentType: 'application/pdf',
            size: 3,
            fileId: 's3:org/report',
          },
        ],
      })),
    );

    await syncOnce(ctx, 'gmail');

    expect(inputsFor(calls, 'get_message')).toEqual([
      { messageId: 'g1' },
      { messageId: 'g1', includeAttachments: true },
    ]);
    // The reference matches the part of the SAME response — the first fetch's
    // attachment id is already stale.
    expect(ingestedAttachments()).toEqual([
      {
        id: 'att-second-fetch',
        filename: 'report.pdf',
        contentType: 'application/pdf',
        size: 3,
        storageId: 's3:org/report',
      },
    ]);
  });

  // The cursor message is re-fetched on every poll; asking again would store
  // another copy of every attachment each time.
  it('keeps the stored references of a message already ingested', async () => {
    const stored = {
      id: 'att-old',
      filename: 'report.pdf',
      contentType: 'application/pdf',
      size: 3,
      storageId: 's3:org/report',
    };
    const { ctx, calls } = harness(
      gmailMailbox(() => {
        throw new Error('must not ask for the bytes again');
      }),
      {
        existingMessages: {
          'g1@example.com': { metadata: { attachments: [stored] } },
        },
      },
    );

    await syncOnce(ctx, 'gmail');

    expect(inputsFor(calls, 'get_message')).toEqual([{ messageId: 'g1' }]);
    expect(ingestedAttachments()).toEqual([stored]);
  });

  it('asks again for a message ingested before its attachments were stored', async () => {
    const { ctx, calls } = harness(
      gmailMailbox(() => ({
        message: gmailMessage('att-second-fetch'),
        attachments: [
          {
            id: 'att-second-fetch',
            filename: 'report.pdf',
            contentType: 'application/pdf',
            size: 3,
            fileId: 's3:org/report',
          },
        ],
      })),
      {
        existingMessages: {
          'g1@example.com': {
            metadata: {
              attachments: [
                {
                  id: 'att-old',
                  filename: 'report.pdf',
                  contentType: 'application/pdf',
                  size: 3,
                },
              ],
            },
          },
        },
      },
    );

    await syncOnce(ctx, 'gmail');

    expect(inputsFor(calls, 'get_message')).toEqual([
      { messageId: 'g1' },
      { messageId: 'g1', includeAttachments: true },
    ]);
    expect(ingestedAttachments()).toEqual([
      expect.objectContaining({ storageId: 's3:org/report' }),
    ]);
  });

  it('records a part the connector could not carry as truncated', async () => {
    const { ctx } = harness(
      gmailMailbox(() => ({
        message: gmailMessage('att-second-fetch', 9_000_000),
        attachments: [
          {
            id: 'att-second-fetch',
            filename: 'report.pdf',
            contentType: 'application/pdf',
            size: 9_000_000,
            truncated: true,
          },
        ],
      })),
    );

    await syncOnce(ctx, 'gmail');

    expect(ingestedAttachments()).toEqual([
      {
        id: 'att-second-fetch',
        filename: 'report.pdf',
        contentType: 'application/pdf',
        size: 9_000_000,
        truncated: true,
      },
    ]);
  });

  it('still ingests the mail with metadata-only chips when the download fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { ctx } = harness(
      gmailMailbox(() => {
        throw new Error('vendor unavailable');
      }),
    );

    await syncOnce(ctx, 'gmail');

    expect(ingestedAttachments()).toEqual([
      {
        id: 'att-first-fetch',
        filename: 'report.pdf',
        contentType: 'application/pdf',
        size: 3,
      },
    ]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('attachments not stored'),
    );
    warn.mockRestore();
  });

  it('takes Outlook attachments from the connector, the only place Graph lists them', async () => {
    const outlookMessage = {
      id: 'o1',
      internetMessageId: '<o1@example.com>',
      hasAttachments: true,
      from: { emailAddress: { name: 'Ada', address: 'ada@example.com' } },
      receivedDateTime: '2025-04-04T00:00:00Z',
      body: { contentType: 'text', content: 'See attached' },
    };
    const { ctx, calls } = harness((call) => {
      if (call.action === 'list_messages') {
        return {
          messages: [{ id: 'o1', receivedDateTime: '1970-01-01T00:00:06Z' }],
        };
      }
      if (call.input.includeAttachments !== true) {
        return { message: outlookMessage, attachments: [] };
      }
      return {
        message: outlookMessage,
        attachments: [
          {
            id: 'o-att',
            name: 'invoice.pdf',
            contentType: 'application/pdf',
            size: 5,
            fileId: 's3:org/invoice',
            contentId: 'logo',
          },
        ],
      };
    });

    await syncOnce(ctx, 'outlook');

    expect(inputsFor(calls, 'get_message')).toEqual([
      { messageId: 'o1' },
      { messageId: 'o1', includeAttachments: true },
    ]);
    expect(ingestedAttachments()).toEqual([
      {
        id: 'o-att',
        filename: 'invoice.pdf',
        contentType: 'application/pdf',
        size: 5,
        contentId: 'logo',
        storageId: 's3:org/invoice',
      },
    ]);
  });
});

describe('syncMailbox over multiple credentials', () => {
  const NOW = Date.parse('2026-10-14T12:00:00.000Z');
  const DAY = 86_400_000;

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** One IMAP body per UID, dated by its sender. */
  function imapBody(uid: string, date = '2025-01-01T00:00:00.000Z') {
    return {
      uid,
      email: { messageId: `<body-${uid}@example.com>`, date },
    };
  }

  it('reads each active mailbox from its own position, a new one from its window [CONV-R23]', async () => {
    const reply: Reply = (call) => {
      if (call.action === 'list_messages') {
        return call.credentialRef === 'cred_primary'
          ? { messages: [{ uid: 'primary-1', receivedAt: NOW - 1000 }] }
          : { messages: [{ uid: 'secondary-1', receivedAt: NOW - 2 * DAY }] };
      }
      return imapBody(String(call.input.uid));
    };
    const { ctx, calls, cursorPatches } = harness(reply, {
      credentials: [
        {
          id: 'cred_primary',
          name: 'Primary',
          isDefault: true,
          // Already synced — keep walking from its position.
          mailSyncInboundSince: NOW - 3_600_000,
        },
        // Never synced — must NOT inherit Primary's position.
        { id: 'cred_secondary', name: 'Secondary', isDefault: false },
      ],
    });

    const result = await syncMailbox(ctx, {
      organizationId: 'org',
      connectorSlug: 'imap-smtp',
      limit: 25,
      includeSent: false,
      mode: 'live',
    });

    expect(
      calls
        .filter((call) => call.action === 'list_messages')
        .map((call) => [call.credentialRef, call.input]),
    ).toEqual([
      ['cred_primary', { limit: 26, after: NOW - 3_600_000 }],
      // No position: the first pass reads back seven days.
      ['cred_secondary', { limit: 26, after: NOW - 7 * DAY }],
    ]);
    expect(resolveConnectorAccountEmail).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ credentialRef: 'cred_primary' }),
    );
    expect(resolveConnectorAccountEmail).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ credentialRef: 'cred_secondary' }),
    );
    expect(result.listed).toBe(2);
    expect(result.inbound.processedCount).toBe(2);
    expect(result.inbound.conversationIds).toEqual(['conv_1']);
    // The Inbox's newest message is not consulted once credentials exist.
    expect(queryLatestMessageByDeliveryState).not.toHaveBeenCalled();
    expect(cursorPatches).toEqual([
      {
        organizationId: 'org',
        credentialId: 'cred_primary',
        mailSyncInboundSince: NOW - 1000,
      },
      {
        organizationId: 'org',
        credentialId: 'cred_secondary',
        mailSyncInboundSince: NOW - 2 * DAY,
      },
    ]);
  });

  it('keeps a Gmail position on Gmail’s clock, never the date a sender wrote [CONV-R17]', async () => {
    const internal: Record<string, number> = {
      g1: NOW - 20 * 60_000,
      g2: NOW - 10 * 60_000,
    };
    const reply: Reply = (call) => {
      if (call.action === 'list_messages') {
        // Newest first, ids only: Gmail lists no instant.
        return { messages: [{ id: 'g2' }, { id: 'g1', threadId: 't1' }] };
      }
      const id = String(call.input.messageId);
      return {
        message: {
          id,
          // Epoch ms as a string, as Gmail sends it.
          internalDate: String(internal[id]),
          payload: {
            mimeType: 'text/plain',
            headers: [
              { name: 'Message-ID', value: `<${id}@example.com>` },
              { name: 'From', value: 'Ada <ada@example.com>' },
              {
                name: 'Date',
                // A sender whose clock runs years ahead.
                value:
                  id === 'g2'
                    ? 'Tue, 01 Jan 2030 00:00:00 +0000'
                    : 'Wed, 14 Oct 2026 11:40:00 +0000',
              },
            ],
          },
        },
        attachments: [],
      };
    };
    const { ctx, cursorPatches } = harness(reply, {
      credentials: [
        {
          id: 'cred_gmail',
          name: 'Gmail',
          isDefault: true,
          mailSyncInboundSince: NOW - DAY,
        },
      ],
    });

    await syncMailbox(ctx, {
      organizationId: 'org',
      connectorSlug: 'gmail',
      limit: 25,
      includeSent: false,
      mode: 'live',
    });

    expect(cursorPatches).toEqual([
      {
        organizationId: 'org',
        credentialId: 'cred_gmail',
        mailSyncInboundSince: NOW - 10 * 60_000,
        // Gmail lists the position's own second again: what was read in it
        // is kept with the position, left out of the next listing.
        mailSyncEdges: { inbox: { at: NOW - 10 * 60_000, ids: ['g2'] } },
      },
    ]);
  });

  it('holds the position before an email the Inbox could not store [CONV-R17]', async () => {
    createConversationFromEmail
      .mockReset()
      .mockImplementationOnce((_ctx: unknown, args: unknown) =>
        Promise.resolve({ ...INGESTED, ingestedTip: ingestedTipFor(args) }),
      )
      .mockRejectedValueOnce(new Error('database unavailable'));
    const reply: Reply = (call) =>
      call.action === 'list_messages'
        ? {
            messages: [
              { uid: '1', receivedAt: NOW - 3000 },
              { uid: '2', receivedAt: NOW - 2000 },
              { uid: '3', receivedAt: NOW - 1000 },
            ],
          }
        : imapBody(String(call.input.uid));
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      const { ctx, calls, cursorPatches } = harness(reply, {
        credentials: [
          {
            id: 'cred_imap',
            name: 'Desk',
            isDefault: true,
            mailSyncInboundSince: NOW - DAY,
          },
        ],
      });

      await expect(
        syncMailbox(ctx, {
          organizationId: 'org',
          connectorSlug: 'imap-smtp',
          limit: 25,
          includeSent: false,
          mode: 'live',
        }),
      ).rejects.toThrow(
        /every imap-smtp mailbox failed \(Desk: database unavailable\)/,
      );
      // The pass stopped at the second email: the third was never read, and
      // the position stands at the first, so the next pass reads the second.
      expect(inputsFor(calls, 'get_message')).toEqual([
        { uid: '1' },
        { uid: '2' },
      ]);
      expect(cursorPatches).toEqual([
        {
          organizationId: 'org',
          credentialId: 'cred_imap',
          mailSyncInboundSince: NOW - 3000,
        },
      ]);
    } finally {
      error.mockRestore();
    }
  });

  it('keeps the Sent position apart from the Inbox one', async () => {
    const reply: Reply = (call) => {
      if (call.action === 'list_messages') {
        return {
          messages: wantsSent(call.input)
            ? [{ uid: '90', receivedAt: NOW - 1000 }]
            : [{ uid: '10', receivedAt: NOW - 2000 }],
        };
      }
      return imapBody(String(call.input.uid));
    };
    const { ctx, cursorPatches } = harness(reply, {
      credentials: [
        {
          id: 'cred_imap',
          name: 'Desk',
          isDefault: true,
          mailSyncInboundSince: NOW - DAY,
          mailSyncOutboundSince: NOW - DAY,
        },
      ],
    });

    await syncMailbox(ctx, {
      organizationId: 'org',
      connectorSlug: 'imap-smtp',
      limit: 25,
      includeSent: true,
      mode: 'live',
    });

    expect(cursorPatches).toEqual([
      {
        organizationId: 'org',
        credentialId: 'cred_imap',
        mailSyncInboundSince: NOW - 2000,
        mailSyncOutboundSince: NOW - 1000,
      },
    ]);
  });

  it('keeps syncing the other mailboxes when one credential fails [CONV-R21]', async () => {
    // A single expired password must not starve every mailbox behind it in
    // the fan-out — otherwise one bad row silently stops the whole org's mail.
    const reply: Reply = (call) =>
      call.action === 'list_messages'
        ? { messages: [{ uid: '5', receivedAt: NOW - 1000 }] }
        : imapBody('5', '2025-05-05T00:00:00.000Z');
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      const { ctx, calls, cursorPatches } = harness(reply, {
        credentials: [
          // Default sorts first, so the failure happens BEFORE the good one.
          {
            id: 'cred_bad',
            name: 'Broken',
            isDefault: true,
            mailSyncInboundSince: NOW - DAY,
          },
          {
            id: 'cred_good',
            name: 'Working',
            isDefault: false,
            mailSyncInboundSince: NOW - DAY,
          },
        ],
        failCredentials: { cred_bad: 'authentication expired' },
      });

      const result = await syncMailbox(ctx, {
        organizationId: 'org',
        connectorSlug: 'imap-smtp',
        limit: 25,
        includeSent: false,
        mode: 'live',
      });

      expect(
        calls
          .filter((call) => call.action === 'list_messages')
          .map((call) => call.credentialRef),
      ).toEqual(['cred_bad', 'cred_good']);
      expect(result.inbound.processedCount).toBe(1);
      expect(result.inbound.reason).toContain('Broken');
      expect(result.inbound.reason).toContain('authentication expired');
      expect(result.mailboxes).toEqual([
        expect.objectContaining({
          mailbox: 'Broken',
          ok: false,
          error: expect.stringContaining('authentication expired'),
        }),
        expect.objectContaining({ mailbox: 'Working', ok: true, ingested: 1 }),
      ]);
      // Only the mailbox that succeeded moves its position.
      expect(cursorPatches).toEqual([
        {
          organizationId: 'org',
          credentialId: 'cred_good',
          mailSyncInboundSince: NOW - 1000,
        },
      ]);
    } finally {
      error.mockRestore();
    }
  });

  it('throws when every credential fails, rather than reporting a quiet zero [CONV-R21]', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      const { ctx } = harness(mailbox([{ uid: '1', receivedAt: NOW - 1000 }]), {
        credentials: [
          { id: 'cred_a', name: 'Alpha', isDefault: true },
          { id: 'cred_b', name: 'Beta', isDefault: false },
        ],
        failCredentials: {
          cred_a: 'host unreachable',
          cred_b: 'login denied',
        },
      });

      await expect(
        syncMailbox(ctx, {
          organizationId: 'org',
          connectorSlug: 'imap-smtp',
          limit: 25,
          includeSent: false,
          mode: 'live',
        }),
      ).rejects.toThrow(/every imap-smtp mailbox failed/);
    } finally {
      error.mockRestore();
    }
  });

  it('skips disabled credentials by only receiving the active list', async () => {
    // listActiveCredentialsInternal already filters to status=active; the
    // sync host must not invent a pass for anything outside that list.
    const { ctx, calls } = harness(
      mailbox([{ uid: '1', receivedAt: NOW - 1000 }]),
      { credentials: [{ id: 'cred_only', name: 'Only', isDefault: true }] },
    );

    await syncMailbox(ctx, {
      organizationId: 'org',
      connectorSlug: 'imap-smtp',
      limit: 10,
      includeSent: false,
      mode: 'live',
    });

    expect(
      calls.filter((call) => call.action === 'list_messages'),
    ).toHaveLength(1);
    expect(calls[0]?.credentialRef).toBe('cred_only');
    // No position yet: a first pass from its seven-day window.
    expect(calls[0]?.input).toEqual({ limit: 11, after: NOW - 7 * DAY });
  });
});

describe('listMailboxMessages', () => {
  it('fans out the inbox dialect across every active credential', async () => {
    const reply: Reply = (call) => {
      if (call.action !== 'list_messages') return {};
      return {
        messages: [
          {
            uid: '7',
            subject: `from-${call.credentialRef}`,
            from: 'a@example.com',
            sentAt: 1000,
          },
        ],
      };
    };
    const { ctx, calls } = harness(reply, {
      credentials: [
        { id: 'cred_a', name: 'Alpha', isDefault: true },
        { id: 'cred_b', name: 'Beta', isDefault: false },
      ],
    });

    const result = await listMailboxMessages(ctx, {
      organizationId: 'org',
      connectorSlug: 'imap-smtp',
      limit: 10,
      mode: 'live',
    });

    expect(calls.map((call) => [call.credentialRef, call.input])).toEqual([
      ['cred_a', { limit: 10, mailbox: 'INBOX' }],
      ['cred_b', { limit: 10, mailbox: 'INBOX' }],
    ]);
    // IMAP UIDs are scoped so two mailboxes cannot collide in the digest.
    expect(result.messages).toEqual([
      expect.objectContaining({
        id: 'Alpha:7',
        credentialName: 'Alpha',
        subject: 'from-cred_a',
      }),
      expect.objectContaining({
        id: 'Beta:7',
        credentialName: 'Beta',
        subject: 'from-cred_b',
      }),
    ]);
  });

  it('still returns a digest when one of the mailboxes is unreachable', async () => {
    const { ctx } = harness(
      (call) =>
        call.action === 'list_messages'
          ? { messages: [{ uid: '7', subject: 'hi' }] }
          : {},
      {
        credentials: [
          { id: 'cred_a', name: 'Alpha', isDefault: true },
          { id: 'cred_b', name: 'Beta', isDefault: false },
        ],
        failCredentials: { cred_a: 'host unreachable' },
      },
    );

    const result = await listMailboxMessages(ctx, {
      organizationId: 'org',
      connectorSlug: 'imap-smtp',
      limit: 10,
      mode: 'live',
    });

    expect(result.messages).toEqual([
      expect.objectContaining({ id: 'Beta:7', credentialName: 'Beta' }),
    ]);
  });

  it('throws when no mailbox could be listed at all', async () => {
    const { ctx } = harness(mailbox([]), {
      credentials: [{ id: 'cred_a', name: 'Alpha', isDefault: true }],
      failCredentials: { cred_a: 'host unreachable' },
    });

    await expect(
      listMailboxMessages(ctx, {
        organizationId: 'org',
        connectorSlug: 'imap-smtp',
        limit: 10,
        mode: 'live',
      }),
    ).rejects.toThrow(/every imap-smtp mailbox failed/);
  });

  it('reads Outlook envelopes off the listing alone', async () => {
    const { ctx, calls } = harness(
      mailbox([
        {
          id: 'o1',
          subject: 'hi',
          from: { emailAddress: { address: 'a@example.com' } },
          receivedDateTime: '2026-10-01T08:00:00Z',
        },
      ]),
    );

    const result = await listMailboxMessages(ctx, {
      organizationId: 'org',
      connectorSlug: 'outlook',
      limit: 5,
      mode: 'live',
    });

    expect(calls.map((call) => call.action)).toEqual(['list_messages']);
    expect(result.messages).toEqual([
      expect.objectContaining({ id: 'o1', subject: 'hi' }),
    ]);
  });

  // Gmail's `users.messages.list` answers bare ids — the envelope is one
  // metadata fetch away. Before the fetch landed, every digest row read
  // `subject: ''`, `from: ''`, `receivedAt: ''` for a live Gmail inbox.
  const GMAIL_DATE = 'Wed, 15 Nov 2023 10:13:20 +0000';

  /** The Gmail dialect: a list of ids, then the raw API message per id. */
  function gmailInbox(ids: string[]): Reply {
    return (call) => {
      if (call.action === 'list_messages') {
        return {
          messages: ids.map((id) => ({ id, threadId: `t-${id}` })),
          nextPageToken: '',
        };
      }
      const id = String(call.input.messageId);
      return {
        message: {
          id,
          threadId: `t-${id}`,
          labelIds: ['INBOX', 'UNREAD'],
          snippet: `Snippet of ${id}`,
          internalDate: '1700043200000',
          payload: {
            mimeType: 'text/plain',
            headers: [
              { name: 'Subject', value: `Subject of ${id}` },
              { name: 'From', value: `Alice <alice-${id}@example.com>` },
              { name: 'Date', value: GMAIL_DATE },
              { name: 'Message-ID', value: `<${id}@mail.example.com>` },
            ],
          },
        },
        attachments: [],
      };
    };
  }

  it('reads Gmail envelopes with one metadata fetch per listed id', async () => {
    const { ctx, calls } = harness(gmailInbox(['g1', 'g2']), {
      credentials: [],
    });

    const result = await listMailboxMessages(ctx, {
      organizationId: 'org',
      connectorSlug: 'gmail',
      limit: 5,
      mode: 'live',
    });

    expect(inputsFor(calls, 'list_messages')).toEqual([
      { maxResults: 5, q: 'in:inbox' },
    ]);
    // Headers and snippet only: no body, no attachment bytes.
    expect(inputsFor(calls, 'get_message')).toEqual([
      { messageId: 'g1', format: 'metadata' },
      { messageId: 'g2', format: 'metadata' },
    ]);
    expect(result.messages).toEqual([
      {
        id: 'g1',
        threadId: 't-g1',
        subject: 'Subject of g1',
        from: 'alice-g1@example.com',
        sentAt: Date.parse(GMAIL_DATE),
        snippet: 'Snippet of g1',
      },
      {
        id: 'g2',
        threadId: 't-g2',
        subject: 'Subject of g2',
        from: 'alice-g2@example.com',
        sentAt: Date.parse(GMAIL_DATE),
        snippet: 'Snippet of g2',
      },
    ]);
  });

  it('fetches Gmail envelopes with the credential that listed them', async () => {
    const { ctx, calls } = harness(gmailInbox(['g1']), {
      credentials: [
        { id: 'cred_a', name: 'Alpha', isDefault: true },
        { id: 'cred_b', name: 'Beta', isDefault: false },
      ],
    });

    const result = await listMailboxMessages(ctx, {
      organizationId: 'org',
      connectorSlug: 'gmail',
      limit: 5,
      mode: 'live',
    });

    expect(calls.map((call) => [call.credentialRef, call.action])).toEqual([
      ['cred_a', 'list_messages'],
      ['cred_a', 'get_message'],
      ['cred_b', 'list_messages'],
      ['cred_b', 'get_message'],
    ]);
    expect(result.messages).toEqual([
      expect.objectContaining({
        id: 'g1',
        credentialName: 'Alpha',
        subject: 'Subject of g1',
      }),
      expect.objectContaining({
        id: 'g1',
        credentialName: 'Beta',
        subject: 'Subject of g1',
      }),
    ]);
  });

  it('skips a Gmail message gone between the list and the fetch', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const { ctx } = harness(gmailInbox(['g1', 'g2', 'g3']), {
        failMessages: { g2: 'Gmail get_message failed (404)' },
      });

      const result = await listMailboxMessages(ctx, {
        organizationId: 'org',
        connectorSlug: 'gmail',
        limit: 5,
        mode: 'live',
      });

      expect(result.messages.map((row) => row.id)).toEqual(['g1', 'g3']);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('gmail message g2 skipped'),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('fails a Gmail mailbox when every envelope fetch fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const { ctx } = harness(gmailInbox(['g1', 'g2']), {
        failMessages: { g1: 'invalid_grant', g2: 'invalid_grant' },
      });

      await expect(
        listMailboxMessages(ctx, {
          organizationId: 'org',
          connectorSlug: 'gmail',
          limit: 5,
          mode: 'live',
        }),
      ).rejects.toThrow(/every gmail message fetch failed/);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("syncMailbox learns an OAuth mailbox's own address", () => {
  /**
   * Gmail and Outlook credentials carry no login to mirror, so the ingest
   * had no account address: every root message counted as the customer's,
   * and a thread the mailbox itself started opened with the mailbox as the
   * contact and every direction inverted. The first pass now asks the
   * provider (`get_profile`), keeps the answer on `config.fromAddress`, and
   * hands it to the ingest as `accountEmail`.
   */
  it('asks Gmail who the mailbox is once, keeps it on the credential and hands it to the ingest', async () => {
    resolveConnectorAccountEmail.mockResolvedValue(undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const inbox = mailbox([{ id: 'g1', threadId: 't1' }]);
      const { ctx, calls, cursorPatches } = harness(
        (call) =>
          call.action === 'get_profile'
            ? { emailAddress: 'Desk@Example.com' }
            : inbox(call),
        {
          credentials: [{ id: 'cred_g', name: 'Gmail', isDefault: true }],
          credentialRow: { _id: 'cred_g', config: { label: 'Support' } },
        },
      );

      await syncMailbox(ctx, {
        organizationId: 'org',
        connectorSlug: 'gmail',
        limit: 25,
        includeSent: false,
        mode: 'live',
      });

      // The profile is read with the credential that lists, before the list.
      expect(calls.map((call) => [call.action, call.credentialRef])).toEqual([
        ['get_profile', 'cred_g'],
        ['list_messages', 'cred_g'],
        ['get_message', 'cred_g'],
      ]);
      expect(cursorPatches).toContainEqual({
        organizationId: 'org',
        credentialId: 'cred_g',
        config: { label: 'Support', fromAddress: 'Desk@Example.com' },
      });
      expect(createConversationFromEmail).toHaveBeenCalledWith(
        ctx,
        expect.objectContaining({
          connectorName: 'gmail',
          accountEmail: 'Desk@Example.com',
        }),
      );
      expect(info).toHaveBeenCalledWith(
        expect.stringContaining('learned the gmail mailbox address'),
      );
    } finally {
      info.mockRestore();
    }
  });

  it('runs the pass as before when Outlook cannot say who the mailbox is', async () => {
    resolveConnectorAccountEmail.mockResolvedValue(undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const inbox = mailbox([
        { id: 'o1', receivedDateTime: new Date(Date.now()).toISOString() },
      ]);
      const { ctx, calls, cursorPatches } = harness(
        (call) => {
          if (call.action === 'get_profile') {
            throw new Error('Outlook get_profile failed (403)');
          }
          return inbox(call);
        },
        {
          credentials: [{ id: 'cred_o', name: 'Outlook', isDefault: true }],
          credentialRow: { _id: 'cred_o', config: {} },
        },
      );

      await syncMailbox(ctx, {
        organizationId: 'org',
        connectorSlug: 'outlook',
        limit: 25,
        includeSent: false,
        mode: 'live',
      });

      expect(calls.map((call) => call.action)).toEqual([
        'get_profile',
        'list_messages',
        'get_message',
      ]);
      expect(cursorPatches.some((patch) => 'config' in patch)).toBe(false);
      expect(createConversationFromEmail).toHaveBeenCalledWith(
        ctx,
        expect.not.objectContaining({ accountEmail: expect.anything() }),
      );
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('outlook mailbox address heal failed'),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('does not ask again once the public config resolves the address', async () => {
    const { ctx, calls } = harness(mailbox([{ id: 'g1', threadId: 't1' }]), {
      credentials: [{ id: 'cred_g', name: 'Gmail', isDefault: true }],
    });

    await syncMailbox(ctx, {
      organizationId: 'org',
      connectorSlug: 'gmail',
      limit: 25,
      includeSent: false,
      mode: 'live',
    });

    expect(calls.map((call) => call.action)).not.toContain('get_profile');
  });
});

describe('syncMailbox guards', () => {
  it('refuses a connector that is not a mailbox', async () => {
    const { ctx, calls } = harness(mailbox([]));

    await expect(
      syncMailbox(ctx, {
        organizationId: 'org',
        connectorSlug: 'github',
        limit: 25,
        includeSent: false,
        mode: 'live',
      }),
    ).rejects.toThrow(/unsupported connector "github"/);
    expect(calls).toEqual([]);
  });

  it('surfaces a failing connector call instead of ingesting nothing quietly', async () => {
    const { ctx } = harness(mailbox([]), {
      outcome: {
        status: 'error',
        message: 'authentication expired',
      },
    });

    await expect(
      syncMailbox(ctx, {
        organizationId: 'org',
        connectorSlug: 'imap-smtp',
        limit: 25,
        includeSent: true,
        mode: 'live',
      }),
    ).rejects.toThrow(
      /imap-smtp\.list_messages failed \(authentication expired\)/,
    );
    expect(createConversationFromEmail).not.toHaveBeenCalled();
  });
});

describe('querySyncCursor', () => {
  it('reads the delivered inbound message for the inbound cursor', async () => {
    const { ctx } = harness(mailbox([]));

    const cursor = await querySyncCursor(ctx, {
      organizationId: 'org',
      connectorSlug: 'gmail',
      direction: 'inbound',
    });

    expect(queryLatestMessageByDeliveryState).toHaveBeenCalledWith(ctx, {
      organizationId: 'org',
      channel: 'email',
      direction: 'inbound',
      deliveryState: 'delivered',
      connectorName: 'gmail',
    });
    expect(cursor).toEqual({ since: 5000, messageId: '<in@x>' });
  });

  it('falls back to the row creation time when no delivery stamp was kept', async () => {
    queryLatestMessageByDeliveryState.mockResolvedValue({
      message: { externalMessageId: '<old@x>', _creationTime: 1234 },
    });
    const { ctx } = harness(mailbox([]));

    expect(
      await querySyncCursor(ctx, {
        organizationId: 'org',
        connectorSlug: 'gmail',
        direction: 'inbound',
      }),
    ).toEqual({ since: 1234, messageId: '<old@x>' });
  });

  it('reads nothing to sync from an empty mailbox history', async () => {
    queryLatestOutboundMessageForEmailSync.mockResolvedValue({ message: null });
    const { ctx } = harness(mailbox([]));

    expect(
      await querySyncCursor(ctx, {
        organizationId: 'org',
        connectorSlug: 'imap-smtp',
        direction: 'outbound',
      }),
    ).toEqual({ since: null, messageId: null });
  });
});
