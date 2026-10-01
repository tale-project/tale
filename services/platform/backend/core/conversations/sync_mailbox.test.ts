/**
 * The sync orchestrator's contract with the three mail connectors: which
 * cursor it reads, what it asks each provider for, and what it hands the
 * ingest helpers. Dedupe and threading belong to those helpers (see
 * `ingest/create_conversation_from_email.test.ts`); here every connector call
 * is captured so a provider's parameter names cannot drift silently.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  /** Active credentials listActiveCredentialsInternal returns (default: none). */
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
  const credentials = options.credentials ?? [];
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
  it('walks both folders from their own cursor and ingests the fetched bodies', async () => {
    const { ctx, calls, cursorPatches } = harness(
      mailbox([{ uid: '11' }], [{ uid: 99 }]),
    );

    const result = await syncMailbox(ctx, {
      organizationId: 'org',
      connectorSlug: 'imap-smtp',
      limit: 25,
      includeSent: true,
      mode: 'live',
    });

    expect(calls.map((call) => [call.action, call.input])).toEqual([
      ['list_messages', { limit: 25, since: 5000 }],
      ['get_message', { uid: '11' }],
      ['list_messages', { limit: 25, since: 7000, mailbox: 'sent' }],
      ['get_message', { uid: '99', mailbox: 'sent' }],
    ]);
    expect(calls.every((call) => call.mode === 'live')).toBe(true);

    expect(createConversationFromEmail).toHaveBeenCalledWith(ctx, {
      organizationId: 'org',
      connectorName: 'imap-smtp',
      accountEmail: 'desk@example.com',
      status: 'open',
      emails: [{ messageId: '<body-11@example.com>' }],
    });
    // No credential rows: nothing to stamp a per-mailbox watermark onto.
    expect(cursorPatches).toEqual([]);
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
    });
  });

  it('omits the cursor entirely on a first pass and skips the Sent folder when asked', async () => {
    queryLatestMessageByDeliveryState.mockResolvedValue({ message: null });
    const { ctx, calls } = harness(mailbox([{ uid: '1' }]));

    const result = await syncMailbox(ctx, {
      organizationId: 'org',
      connectorSlug: 'imap-smtp',
      limit: 10,
      includeSent: false,
      mode: 'live',
    });

    expect(inputsFor(calls, 'list_messages')).toEqual([{ limit: 10 }]);
    expect(createConversationFromSentEmail).not.toHaveBeenCalled();
    expect(result.sent).toBeUndefined();
    expect(queryLatestOutboundMessageForEmailSync).not.toHaveBeenCalled();
  });

  it('skips an envelope with no UID rather than fetching a bad message', async () => {
    const { ctx, calls } = harness(
      mailbox([{ subject: 'no uid' }, { uid: 7 }]),
    );

    const result = await syncMailbox(ctx, {
      organizationId: 'org',
      connectorSlug: 'imap-smtp',
      limit: 25,
      includeSent: false,
      mode: 'live',
    });

    expect(inputsFor(calls, 'get_message')).toEqual([{ uid: '7' }]);
    // Both envelopes were listed; only the addressable one reached ingest.
    expect(result.listed).toBe(2);
    expect(createConversationFromEmail).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        emails: [{ messageId: '<body-7@example.com>' }],
      }),
    );
  });
});

describe('syncMailbox over Gmail', () => {
  it('turns the cursor into an epoch-second search and reads each folder by label', async () => {
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

    // INBOX is named, never implied: an unlabelled `users.messages.list`
    // answers Sent too, and the mailbox's own mail opened conversations with
    // the mailbox as the customer.
    expect(inputsFor(calls, 'list_messages')).toEqual([
      { maxResults: 50, q: 'after:5', labelIds: 'INBOX' },
      { maxResults: 50, q: 'after:7', labelIds: 'SENT' },
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
  it('addresses each folder by name and filters Sent Items by sentDateTime', async () => {
    const { ctx, calls } = harness(mailbox([{ id: 'o1' }], [{ id: 'o2' }]));

    await syncMailbox(ctx, {
      organizationId: 'org',
      connectorSlug: 'outlook',
      limit: 25,
      includeSent: true,
      mode: 'live',
    });

    // Graph resolves `sentitems` as a path segment only, and rejects a filter
    // on one date field ordered by another — so the folder rides `folder` while
    // the cursor and the sort both switch to sentDateTime. Both folders sort
    // ASC so a backlog drains forward from the watermark.
    // The Inbox is a folder too: `/me/messages` spans every folder, Sent
    // Items included — the same hole as Gmail's unlabelled listing.
    expect(inputsFor(calls, 'list_messages')).toEqual([
      {
        top: 25,
        folder: 'inbox',
        orderby: 'receivedDateTime asc',
        filter: 'receivedDateTime ge 1970-01-01T00:00:05.000Z',
      },
      {
        top: 25,
        folder: 'sentitems',
        orderby: 'sentDateTime asc',
        filter: 'sentDateTime ge 1970-01-01T00:00:07.000Z',
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
        return { messages: [{ uid: '1' }, { uid: '2' }] };
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
        ? { messages: [{ uid: '1' }] }
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
        ? { messages: [{ uid: '1' }] }
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
        ? { messages: [{ uid: '1' }] }
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
      if (call.action === 'list_messages') return { messages: [{ id: 'o1' }] };
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
  it('fans out each active credential from its own watermark (null = first tail)', async () => {
    const reply: Reply = (call) => {
      if (call.action === 'list_messages') {
        const uid =
          call.credentialRef === 'cred_primary' ? 'primary-1' : 'secondary-1';
        const sentAt = call.credentialRef === 'cred_primary' ? 9000 : 4000;
        return {
          messages: [{ uid, sentAt }],
        };
      }
      const id = String(call.input.uid);
      // The watermark comes from the BODY's date, so the body carries one.
      const date = id === 'primary-1' ? 9000 : 4000;
      return {
        uid: id,
        email: {
          messageId: `<body-${id}@example.com>`,
          date: new Date(date).toISOString(),
        },
      };
    };
    const { ctx, calls, cursorPatches } = harness(reply, {
      credentials: [
        {
          id: 'cred_primary',
          name: 'Primary',
          isDefault: true,
          // Already synced once — keep walking from its watermark.
          mailSyncInboundSince: 8000,
        },
        {
          id: 'cred_secondary',
          name: 'Secondary',
          isDefault: false,
          // Never synced — must NOT inherit Primary's Inbox tip.
        },
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
      ['cred_primary', { limit: 25, since: 8000 }],
      // No `since` — first pass reads the newest `limit` from Secondary.
      ['cred_secondary', { limit: 25 }],
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
    expect(result.inbound.conversationIds).toEqual(['conv_1', 'conv_1']);
    // Shared message-table cursor is not consulted once credentials exist.
    expect(queryLatestMessageByDeliveryState).not.toHaveBeenCalled();
    expect(cursorPatches).toEqual([
      {
        organizationId: 'org',
        credentialId: 'cred_primary',
        mailSyncInboundSince: 9000,
      },
      {
        organizationId: 'org',
        credentialId: 'cred_secondary',
        mailSyncInboundSince: 4000,
      },
    ]);
  });

  it('advances a Gmail watermark, whose envelopes carry no timestamp at all', async () => {
    // Gmail's list_messages returns `{ id, threadId }` and Graph returns
    // `receivedDateTime` — neither has the `sentAt` IMAP envelopes carry. A
    // watermark read off the envelope would stay unset here forever and
    // re-fetch the same newest `limit` bodies on every scheduled pass.
    const reply: Reply = (call) =>
      call.action === 'list_messages'
        ? { messages: [{ id: 'g1', threadId: 't1' }, { id: 'g2' }] }
        : {
            message: {
              messageId: `<${String(call.input.messageId)}@example.com>`,
              date:
                call.input.messageId === 'g2'
                  ? '2025-03-04T10:00:00.000Z'
                  : '2025-03-01T10:00:00.000Z',
            },
            attachments: [],
          };
    const { ctx, cursorPatches } = harness(reply, {
      credentials: [{ id: 'cred_gmail', name: 'Gmail', isDefault: true }],
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
        // The NEWEST of the two bodies, not the first one fetched.
        mailSyncInboundSince: Date.parse('2025-03-04T10:00:00.000Z'),
      },
    ]);
  });

  it("reads Gmail's epoch-ms internalDate string as a timestamp", async () => {
    // `internalDate` is the fallback when a message carries no Date header;
    // it is epoch ms as a STRING, which `new Date(...)` cannot parse.
    const reply: Reply = (call) =>
      call.action === 'list_messages'
        ? { messages: [{ id: 'g1' }] }
        : { message: { messageId: '<g1@example.com>', date: '1700000000000' } };
    const { ctx, cursorPatches } = harness(reply, {
      credentials: [{ id: 'cred_gmail', name: 'Gmail', isDefault: true }],
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
        mailSyncInboundSince: 1700000000000,
      },
    ]);
  });

  it('advances the watermark only to what ingest COVERED, never past a fetched-but-unpersisted message', async () => {
    // The permanent-loss bug: the pass fetched more than it ingested, yet the
    // watermark jumped to the newest FETCHED body — stepping over the surplus
    // forever. Here g_new is fetched but NOT ingested (a truncated page), so the
    // watermark must stop at the ingested tip and leave g_new re-fetchable.
    const ingestedTip = Date.parse('2025-05-02T00:00:00.000Z');
    const fetchedTip = Date.parse('2025-05-09T00:00:00.000Z');
    createConversationFromEmail
      .mockReset()
      .mockResolvedValue({ ...INGESTED, ingestedTip });
    const reply: Reply = (call) =>
      call.action === 'list_messages'
        ? { messages: [{ id: 'g_old' }, { id: 'g_new' }] }
        : {
            message: {
              messageId: `<${String(call.input.messageId)}@example.com>`,
              date:
                call.input.messageId === 'g_new'
                  ? '2025-05-09T00:00:00.000Z'
                  : '2025-05-01T00:00:00.000Z',
            },
            attachments: [],
          };
    const { ctx, cursorPatches } = harness(reply, {
      credentials: [{ id: 'cred_gmail', name: 'Gmail', isDefault: true }],
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
        mailSyncInboundSince: ingestedTip,
      },
    ]);
    // The newest FETCHED message is strictly beyond the new watermark, so it is
    // re-listed next pass rather than skipped.
    const patched = cursorPatches[0]?.mailSyncInboundSince;
    expect(typeof patched === 'number' && patched < fetchedTip).toBe(true);
  });

  it('tracks the Sent watermark separately from the Inbox one', async () => {
    const reply: Reply = (call) => {
      if (call.action === 'list_messages') {
        return {
          messages: wantsSent(call.input) ? [{ uid: '90' }] : [{ uid: '10' }],
        };
      }
      const uid = String(call.input.uid);
      return {
        uid,
        email: {
          messageId: `<body-${uid}@example.com>`,
          date:
            uid === '90'
              ? '2025-02-02T00:00:00.000Z'
              : '2025-01-01T00:00:00.000Z',
        },
      };
    };
    const { ctx, cursorPatches } = harness(reply, {
      credentials: [{ id: 'cred_imap', name: 'Desk', isDefault: true }],
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
        mailSyncInboundSince: Date.parse('2025-01-01T00:00:00.000Z'),
        mailSyncOutboundSince: Date.parse('2025-02-02T00:00:00.000Z'),
      },
    ]);
  });

  it('keeps syncing the other mailboxes when one credential fails', async () => {
    // A single expired password must not starve every mailbox behind it in
    // the fan-out — otherwise one bad row silently stops the whole org's mail.
    const reply: Reply = (call) =>
      call.action === 'list_messages'
        ? { messages: [{ uid: '5' }] }
        : {
            uid: '5',
            email: {
              messageId: '<body-5@example.com>',
              date: '2025-05-05T00:00:00.000Z',
            },
          };
    const { ctx, calls, cursorPatches } = harness(reply, {
      credentials: [
        // Default sorts first, so the failure happens BEFORE the good mailbox.
        { id: 'cred_bad', name: 'Broken', isDefault: true },
        { id: 'cred_good', name: 'Working', isDefault: false },
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
    // Only the mailbox that succeeded moves its watermark.
    expect(cursorPatches).toEqual([
      {
        organizationId: 'org',
        credentialId: 'cred_good',
        mailSyncInboundSince: Date.parse('2025-05-05T00:00:00.000Z'),
      },
    ]);
  });

  it('throws when every credential fails, rather than reporting a quiet zero', async () => {
    const { ctx } = harness(mailbox([{ uid: '1' }]), {
      credentials: [
        { id: 'cred_a', name: 'Alpha', isDefault: true },
        { id: 'cred_b', name: 'Beta', isDefault: false },
      ],
      failCredentials: { cred_a: 'host unreachable', cred_b: 'login denied' },
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
  });

  it('skips disabled credentials by only receiving the active list', async () => {
    // listActiveCredentialsInternal already filters to status=active; the
    // sync host must not invent a pass for anything outside that list.
    const { ctx, calls } = harness(mailbox([{ uid: '1', sentAt: 100 }]), {
      credentials: [{ id: 'cred_only', name: 'Only', isDefault: true }],
    });

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
    // No watermark yet → first-pass tail (no since).
    expect(calls[0]?.input).toEqual({ limit: 10 });
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
    const { ctx, calls } = harness(gmailInbox(['g1', 'g2']));

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
      const inbox = mailbox([{ id: 'o1' }]);
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
