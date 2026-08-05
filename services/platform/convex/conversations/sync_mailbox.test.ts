/**
 * The sync orchestrator's contract with the three mail connectors: which
 * cursor it reads, what it asks each provider for, and what it hands the
 * ingest helpers. Dedupe and threading belong to those helpers (see
 * `ingest/create_conversation_from_email.test.ts`); here every connector call
 * is captured so a provider's parameter names cannot drift silently.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isRecord } from '../../lib/utils/type-utils';
import type { ActionCtx } from '../_generated/server';

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

import { querySyncCursor, syncMailbox } from './sync_mailbox';

interface ConnectorCall {
  connector: string;
  action: string;
  input: Record<string, unknown>;
  mode: string;
}

type Reply = (call: ConnectorCall) => unknown;

/** A ctx whose only capability is the nested connector action + blob lane. */
function harness(
  reply: Reply,
  outcome: { status: 'ok' } | { status: 'error'; message: string } = {
    status: 'ok',
  },
): { ctx: ActionCtx; calls: ConnectorCall[]; trace: string[] } {
  const calls: ConnectorCall[] = [];
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
    };
    calls.push(call);
    trace.push(
      call.action === 'get_message'
        ? `get:${String(call.input.uid ?? call.input.messageId)}`
        : call.action,
    );
    if (outcome.status === 'error') return outcome;
    return { status: 'ok', output: reply(call) };
  };
  // `saveFileMetadata` is the only mutation the sync path makes here.
  const runMutation = async (): Promise<null> => null;
  return {
    ctx: { runAction, runMutation } as unknown as ActionCtx,
    calls,
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
    const { ctx, calls } = harness(mailbox([{ uid: '11' }], [{ uid: 99 }]));

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

  it('hands ingest the stored reference, never the wire bytes', async () => {
    const reply: Reply = (call) =>
      call.action === 'list_messages'
        ? { messages: [{ uid: '1' }] }
        : {
            uid: '1',
            email: {
              messageId: '<body-1@example.com>',
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
      status: 'error',
      message: 'authentication expired',
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
