/**
 * The sync orchestrator's contract with the three mail connectors: which
 * cursor it reads, what it asks each provider for, and what it hands the
 * ingest helpers. Dedupe and threading belong to those helpers (see
 * `ingest/create_conversation_from_email.test.ts`); here every connector call
 * is captured so a provider's parameter names cannot drift silently.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import {
  listMailboxMessages,
  querySyncCursor,
  syncMailbox,
} from './sync_mailbox';

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
    return { status: 'ok', output: reply(call) };
  };
  const runQuery = async (
    _ref: unknown,
    args?: Record<string, unknown>,
  ): Promise<unknown> => {
    // `getMessageByExternalId` shares this seam with the credential list.
    if (args !== undefined && typeof args.externalMessageId === 'string') {
      return existingMessages[args.externalMessageId] ?? null;
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
  createConversationFromEmail.mockReset().mockResolvedValue(INGESTED);
  createConversationFromSentEmail
    .mockReset()
    .mockResolvedValue({ ...INGESTED, created: false });
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
  it('turns the cursor into an epoch-second search and reads Sent by label', async () => {
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

    expect(inputsFor(calls, 'list_messages')).toEqual([
      { maxResults: 50, q: 'after:5' },
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
  it('addresses Sent Items as a folder and filters it by sentDateTime', async () => {
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
    // the cursor and the sort both switch to sentDateTime.
    expect(inputsFor(calls, 'list_messages')).toEqual([
      { top: 25, filter: 'receivedDateTime ge 1970-01-01T00:00:05.000Z' },
      {
        top: 25,
        folder: 'sentitems',
        orderby: 'sentDateTime desc',
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

  it('uses the Gmail inbox query when no credentials are configured yet', async () => {
    const { ctx, calls } = harness(mailbox([{ id: 'g1', subject: 'hi' }]));

    const result = await listMailboxMessages(ctx, {
      organizationId: 'org',
      connectorSlug: 'gmail',
      limit: 5,
      mode: 'live',
    });

    expect(inputsFor(calls, 'list_messages')).toEqual([
      { maxResults: 5, q: 'in:inbox' },
    ]);
    expect(result.messages).toEqual([
      expect.objectContaining({ id: 'g1', subject: 'hi' }),
    ]);
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
