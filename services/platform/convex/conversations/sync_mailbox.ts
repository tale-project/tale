'use node';

/**
 * One-shot mailbox → Inbox sync for the `conversation.sync_mailbox` native.
 *
 * Lists new envelopes from the mail connector, fetches each body, and runs the
 * conversation ingest helpers (Message-ID idempotency + threading). The cursor
 * is the latest delivered/sent conversation message for that connector — IMAP
 * has no push, so scheduled packs call this on a timer.
 */

import type {
  ConversationIngestResult,
  ConversationSyncCursor,
  ConversationSyncResult,
} from '../../lib/connectors/natives/platform-conversations';
import { isRecord } from '../../lib/utils/type-utils';
import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import { createConversationFromEmail } from './ingest/create_conversation_from_email';
import { createConversationFromSentEmail } from './ingest/create_conversation_from_sent_email';
import { materializeEmailAttachments } from './ingest/materialize_email_attachments';
import { queryLatestMessageByDeliveryState } from './ingest/query_latest_message_by_delivery_state';
import { queryLatestOutboundMessageForEmailSync } from './ingest/query_latest_outbound_message_for_sync';
import { resolveConnectorAccountEmail } from './ingest/resolve_connector_account_email';

const EMAIL_CONNECTORS = new Set(['gmail', 'outlook', 'imap-smtp']);

function ingestResult(
  result: Awaited<ReturnType<typeof createConversationFromEmail>>,
): ConversationIngestResult {
  const conversationIds = Array.isArray(result.conversationIds)
    ? result.conversationIds.map(String)
    : result.conversationId
      ? [String(result.conversationId)]
      : [];
  return {
    created: result.created,
    processedCount:
      typeof result.processedCount === 'number' ? result.processedCount : 0,
    skippedCount:
      typeof result.skippedCount === 'number' ? result.skippedCount : 0,
    conversationIds,
    ...(typeof result.reason === 'string' ? { reason: result.reason } : {}),
  };
}

function cursorFromMessage(
  message:
    | {
        externalMessageId?: string;
        deliveredAt?: number;
        sentAt?: number;
        _creationTime?: number;
      }
    | null
    | undefined,
): ConversationSyncCursor {
  if (!message) return { since: null, messageId: null };
  const since =
    message.deliveredAt ?? message.sentAt ?? message._creationTime ?? null;
  return {
    since: typeof since === 'number' ? since : null,
    messageId:
      typeof message.externalMessageId === 'string'
        ? message.externalMessageId
        : null,
  };
}

/**
 * Nested mail connector calls go through the Convex action so live yaml-js /
 * native backends get the real credential resolver and sandbox wiring.
 */
async function runMailAction(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    connectorSlug: string;
    action: string;
    input: Record<string, unknown>;
    mode: 'mock' | 'live';
  },
): Promise<unknown> {
  const result = await ctx.runAction(
    internal.connectors.execute_action.runConnectorAction,
    {
      organizationId: args.organizationId,
      connector: args.connectorSlug,
      action: args.action,
      input: args.input,
      mode: args.mode,
      caller: {
        kind: 'system',
        reason: `conversation.sync_mailbox:${args.action}`,
      },
    },
  );
  if (result.status !== 'ok') {
    throw new Error(
      `conversation.sync_mailbox: ${args.connectorSlug}.${args.action} failed (${result.message})`,
    );
  }
  return result.output;
}

function listedMessages(output: unknown): Array<Record<string, unknown>> {
  if (!isRecord(output)) return [];
  const messages = output.messages;
  if (!Array.isArray(messages)) return [];
  return messages.filter(isRecord);
}

function unwrapFetchedMessage(output: unknown): unknown {
  if (!isRecord(output)) return output;
  if ('email' in output) return output.email;
  if ('message' in output) return output.message;
  return output;
}

/** One body, or `null` when the envelope carries no id to fetch it by. */
async function fetchOneBody(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    connectorSlug: string;
    summary: Record<string, unknown>;
    mode: 'mock' | 'live';
  },
): Promise<{ email: unknown } | null> {
  const { summary } = args;
  if (args.connectorSlug === 'imap-smtp') {
    const uid =
      typeof summary.uid === 'string'
        ? summary.uid
        : typeof summary.uid === 'number'
          ? String(summary.uid)
          : null;
    if (!uid) return null;
    const mailbox =
      typeof summary.mailbox === 'string' ? summary.mailbox : undefined;
    const output = await runMailAction(ctx, {
      organizationId: args.organizationId,
      connectorSlug: 'imap-smtp',
      action: 'get_message',
      input: {
        uid,
        ...(mailbox !== undefined ? { mailbox } : {}),
      },
      mode: args.mode,
    });
    return { email: unwrapFetchedMessage(output) };
  }

  const messageId =
    typeof summary.id === 'string'
      ? summary.id
      : typeof summary.messageId === 'string'
        ? summary.messageId
        : null;
  if (!messageId) return null;
  const output = await runMailAction(ctx, {
    organizationId: args.organizationId,
    connectorSlug: args.connectorSlug,
    action: 'get_message',
    input: { messageId },
    mode: args.mode,
  });
  return { email: unwrapFetchedMessage(output) };
}

/**
 * Fetch each body and drain its attachment bytes into blob storage BEFORE
 * fetching the next one. Fetching the whole page first would hold every
 * message's base64 payload in this action at once — `limit` (25 by default)
 * times the connector's per-attachment cap of resident string, enough to
 * exhaust the action. Materializing per message keeps at most one body's bytes
 * live; what accumulates is the small `storageId` + `url` form.
 */
async function fetchBodies(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    connectorSlug: string;
    summaries: Array<Record<string, unknown>>;
    mode: 'mock' | 'live';
  },
): Promise<unknown[]> {
  const emails: unknown[] = [];
  for (const summary of args.summaries) {
    const fetched = await fetchOneBody(ctx, {
      organizationId: args.organizationId,
      connectorSlug: args.connectorSlug,
      summary,
      mode: args.mode,
    });
    if (fetched === null) continue;
    const [materialized] = await materializeEmailAttachments(ctx, {
      organizationId: args.organizationId,
      source: args.connectorSlug,
      emails: [fetched.email],
    });
    emails.push(materialized);
  }
  return emails;
}

async function listFolder(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    connectorSlug: string;
    since: number | null;
    limit: number;
    mailbox?: 'inbox' | 'sent';
    mode: 'mock' | 'live';
  },
): Promise<Array<Record<string, unknown>>> {
  const input: Record<string, unknown> = {};
  if (args.connectorSlug === 'gmail') {
    input.maxResults = args.limit;
    if (args.since !== null) {
      input.q = `after:${Math.floor(args.since / 1000)}`;
    }
    if (args.mailbox === 'sent') {
      input.labelIds = 'SENT';
    }
  } else if (args.connectorSlug === 'outlook') {
    input.top = args.limit;
    // Graph stamps Sent Items with `sentDateTime` and the Inbox with
    // `receivedDateTime`; it rejects a $filter on one ordered by the other, so
    // the cursor field and the sort follow the folder.
    const dateField =
      args.mailbox === 'sent' ? 'sentDateTime' : 'receivedDateTime';
    if (args.mailbox === 'sent') {
      input.folder = 'sentitems';
      input.orderby = `${dateField} desc`;
    }
    if (args.since !== null) {
      input.filter = `${dateField} ge ${new Date(args.since).toISOString()}`;
    }
  } else {
    input.limit = args.limit;
    if (args.since !== null) input.since = args.since;
    if (args.mailbox === 'sent') input.mailbox = 'sent';
  }

  const output = await runMailAction(ctx, {
    organizationId: args.organizationId,
    connectorSlug: args.connectorSlug,
    action: 'list_messages',
    input,
    mode: args.mode,
  });
  const listed = listedMessages(output);
  if (args.mailbox === 'sent') {
    return listed.map((row) => ({ ...row, mailbox: 'sent' }));
  }
  return listed;
}

export async function querySyncCursor(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    connectorSlug: string;
    direction: 'inbound' | 'outbound';
  },
): Promise<ConversationSyncCursor> {
  if (args.direction === 'outbound') {
    return cursorFromMessage(
      (
        await queryLatestOutboundMessageForEmailSync(ctx, {
          organizationId: args.organizationId,
          channel: 'email',
          connectorName: args.connectorSlug,
        })
      ).message,
    );
  }
  return cursorFromMessage(
    (
      await queryLatestMessageByDeliveryState(ctx, {
        organizationId: args.organizationId,
        channel: 'email',
        direction: 'inbound',
        deliveryState: 'delivered',
        connectorName: args.connectorSlug,
      })
    ).message,
  );
}

export async function ingestEmails(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    connectorSlug: string;
    emails: unknown;
    accountEmail?: string;
    status?: 'open' | 'closed' | 'archived' | 'spam';
  },
): Promise<ConversationIngestResult> {
  return ingestResult(
    await createConversationFromEmail(ctx, {
      organizationId: args.organizationId,
      emails: args.emails,
      connectorName: args.connectorSlug,
      ...(args.accountEmail !== undefined
        ? { accountEmail: args.accountEmail }
        : {}),
      ...(args.status !== undefined ? { status: args.status } : {}),
    }),
  );
}

export async function ingestSentEmails(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    connectorSlug: string;
    emails: unknown;
    accountEmail?: string;
    status?: 'open' | 'closed' | 'archived' | 'spam';
  },
): Promise<ConversationIngestResult> {
  return ingestResult(
    await createConversationFromSentEmail(ctx, {
      organizationId: args.organizationId,
      emails: args.emails,
      connectorName: args.connectorSlug,
      ...(args.accountEmail !== undefined
        ? { accountEmail: args.accountEmail }
        : {}),
      ...(args.status !== undefined ? { status: args.status } : {}),
    }),
  );
}

export async function syncMailbox(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    connectorSlug: string;
    limit: number;
    includeSent: boolean;
    mode: 'mock' | 'live';
  },
): Promise<ConversationSyncResult> {
  if (!EMAIL_CONNECTORS.has(args.connectorSlug)) {
    throw new Error(
      `conversation.sync_mailbox: unsupported connector "${args.connectorSlug}"`,
    );
  }

  const accountEmail = await resolveConnectorAccountEmail(ctx, {
    organizationId: args.organizationId,
    connectorName: args.connectorSlug,
  });

  const inboundCursor = await querySyncCursor(ctx, {
    organizationId: args.organizationId,
    connectorSlug: args.connectorSlug,
    direction: 'inbound',
  });

  const inboundListed = await listFolder(ctx, {
    organizationId: args.organizationId,
    connectorSlug: args.connectorSlug,
    since: inboundCursor.since,
    limit: args.limit,
    mode: args.mode,
  });
  const inboundEmails = await fetchBodies(ctx, {
    organizationId: args.organizationId,
    connectorSlug: args.connectorSlug,
    summaries: inboundListed,
    mode: args.mode,
  });
  const inbound = await ingestEmails(ctx, {
    organizationId: args.organizationId,
    connectorSlug: args.connectorSlug,
    emails: inboundEmails,
    status: 'open',
    ...(accountEmail !== undefined ? { accountEmail } : {}),
  });

  let listed = inboundListed.length;
  let sent: ConversationIngestResult | undefined;

  if (args.includeSent) {
    const sentCursor = await querySyncCursor(ctx, {
      organizationId: args.organizationId,
      connectorSlug: args.connectorSlug,
      direction: 'outbound',
    });
    const sentListed = await listFolder(ctx, {
      organizationId: args.organizationId,
      connectorSlug: args.connectorSlug,
      since: sentCursor.since,
      limit: args.limit,
      mailbox: 'sent',
      mode: args.mode,
    });
    listed += sentListed.length;
    const sentEmails = await fetchBodies(ctx, {
      organizationId: args.organizationId,
      connectorSlug: args.connectorSlug,
      summaries: sentListed,
      mode: args.mode,
    });
    sent = await ingestSentEmails(ctx, {
      organizationId: args.organizationId,
      connectorSlug: args.connectorSlug,
      emails: sentEmails,
      status: 'open',
      ...(accountEmail !== undefined ? { accountEmail } : {}),
    });
  }

  return {
    listed,
    inbound,
    ...(sent !== undefined ? { sent } : {}),
  };
}
