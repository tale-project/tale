'use node';

/**
 * One-shot mailbox → Inbox sync for the `conversation.sync_mailbox` native.
 *
 * Lists new envelopes from the mail connector, fetches each body, and runs the
 * conversation ingest helpers (Message-ID idempotency + threading). Every
 * *active* credential on the connector is synced with its own watermark on the
 * credential row — a shared Inbox cursor would clip older mail on a mailbox
 * added later. The watermark advances to the newest body the pass actually
 * fetched, and one mailbox failing does not stop the rest. IMAP has no push, so
 * scheduled packs call this on a timer.
 */

import type {
  ConversationIngestResult,
  ConversationSyncCursor,
  ConversationSyncResult,
} from '../../lib/connectors/natives/platform-conversations';
import { isRecord } from '../../lib/utils/type-utils';
import {
  looksLikeEmailAddress,
  withImapFromAddress,
} from '../connector_credentials/imap_from_address';
import { resolveConnectorCredential } from '../connector_credentials/resolve_credential';
import type { ActionCtx } from '../lib/ctx';
import { internal } from '../lib/handler_names';
import type { Id } from '../lib/rows';
import { createConversationFromEmail } from './ingest/create_conversation_from_email';
import { createConversationFromSentEmail } from './ingest/create_conversation_from_sent_email';
import { materializeEmailAttachments } from './ingest/materialize_email_attachments';
import { normalizeEmails } from './ingest/normalize_email';
import { queryLatestMessageByDeliveryState } from './ingest/query_latest_message_by_delivery_state';
import { queryLatestOutboundMessageForEmailSync } from './ingest/query_latest_outbound_message_for_sync';
import { resolveConnectorAccountEmail } from './ingest/resolve_connector_account_email';
import { reuseStoredAttachments } from './ingest/reuse_stored_attachments';

const EMAIL_CONNECTORS = new Set(['gmail', 'outlook', 'imap-smtp']);

interface ActiveMailCredential {
  id: Id<'connectorCredentials'>;
  name: string;
  isDefault: boolean;
  mailSyncInboundSince?: number;
  mailSyncOutboundSince?: number;
}

/**
 * Epoch ms for one fetched email, read the way ingest reads it. Gmail hands
 * back `internalDate` (epoch ms as a STRING) when the message carries no `Date`
 * header, which `new Date(...)` cannot parse — hence the numeric branch.
 */
function emailSentAt(date: unknown): number | null {
  if (typeof date === 'number') {
    return Number.isFinite(date) ? date : null;
  }
  if (typeof date !== 'string' || date.trim() === '') return null;
  const parsed = new Date(date).getTime();
  if (Number.isFinite(parsed)) return parsed;
  const epoch = Number(date);
  return Number.isFinite(epoch) ? epoch : null;
}

/**
 * Highest send time among the bodies a pass actually fetched — that mailbox's
 * next watermark. Read from the NORMALIZED emails, not the listed envelopes:
 * only IMAP envelopes carry `sentAt` (Gmail lists `{id, threadId}`, Graph lists
 * `receivedDateTime`), so an envelope-derived tip would leave Gmail and Outlook
 * watermarks unset forever and re-fetch the same newest `limit` bodies on every
 * scheduled pass. Bodies also mean the watermark never steps past a message the
 * fetch leg dropped.
 */
function tipFromEmails(emails: unknown[]): number | null {
  let tip: number | null = null;
  for (const email of normalizeEmails(emails)) {
    const sentAt = emailSentAt(email.date);
    if (sentAt === null) continue;
    tip = tip === null ? sentAt : Math.max(tip, sentAt);
  }
  return tip;
}

async function advanceMailSyncCursor(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    credentialId: Id<'connectorCredentials'>;
    inboundSince?: number;
    outboundSince?: number;
  },
): Promise<void> {
  if (args.inboundSince === undefined && args.outboundSince === undefined) {
    return;
  }
  await ctx.runMutation(
    internal.connector_credentials.mutations.patchCredentialInternal,
    {
      organizationId: args.organizationId,
      credentialId: args.credentialId,
      ...(args.inboundSince !== undefined && {
        mailSyncInboundSince: args.inboundSince,
      }),
      ...(args.outboundSince !== undefined && {
        mailSyncOutboundSince: args.outboundSince,
      }),
    },
  );
}

function ingestResult(
  result: Awaited<ReturnType<typeof createConversationFromEmail>>,
): ConversationIngestResult {
  const conversationIds = Array.isArray(result.conversationIds)
    ? result.conversationIds.map(String)
    : result.conversationId
      ? [result.conversationId]
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

function emptyIngest(): ConversationIngestResult {
  return {
    created: false,
    processedCount: 0,
    skippedCount: 0,
    conversationIds: [],
  };
}

function mergeIngest(
  a: ConversationIngestResult,
  b: ConversationIngestResult,
): ConversationIngestResult {
  return {
    created: a.created || b.created,
    processedCount: a.processedCount + b.processedCount,
    skippedCount: a.skippedCount + b.skippedCount,
    conversationIds: [...a.conversationIds, ...b.conversationIds],
    ...(a.reason !== undefined
      ? { reason: a.reason }
      : b.reason !== undefined
        ? { reason: b.reason }
        : {}),
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
    credentialRef?: string;
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
      ...(args.credentialRef !== undefined && {
        credentialRef: args.credentialRef,
      }),
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
    credentialRef?: string;
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
      ...(args.credentialRef !== undefined && {
        credentialRef: args.credentialRef,
      }),
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
    ...(args.credentialRef !== undefined && {
      credentialRef: args.credentialRef,
    }),
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
 *
 * A message already ingested has its stored pointers reused rather than its
 * bytes stored again (`reuseStoredAttachments`). Every poll re-fetches at least
 * the message on the cursor — it is derived from that message's own timestamp
 * and compared inclusively — and storing is not idempotent, so without this each
 * poll minted another blob and another `fileMetadata` row for the same
 * attachment, forever.
 */
async function fetchBodies(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    connectorSlug: string;
    summaries: Array<Record<string, unknown>>;
    mode: 'mock' | 'live';
    credentialRef?: string;
  },
): Promise<unknown[]> {
  const emails: unknown[] = [];
  for (const summary of args.summaries) {
    const fetched = await fetchOneBody(ctx, {
      organizationId: args.organizationId,
      connectorSlug: args.connectorSlug,
      summary,
      mode: args.mode,
      ...(args.credentialRef !== undefined && {
        credentialRef: args.credentialRef,
      }),
    });
    if (fetched === null) continue;
    // Reuse before materialize: an email whose attachments are already stored
    // comes back carrying its existing pointers and no `contentBase64`, so the
    // store below is a no-op for it.
    const [candidate] = await reuseStoredAttachments(ctx, {
      organizationId: args.organizationId,
      emails: [fetched.email],
    });
    const [materialized] = await materializeEmailAttachments(ctx, {
      organizationId: args.organizationId,
      source: args.connectorSlug,
      emails: [candidate],
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
    credentialRef?: string;
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
    ...(args.credentialRef !== undefined && {
      credentialRef: args.credentialRef,
    }),
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

async function listActiveMailCredentials(
  ctx: ActionCtx,
  args: { organizationId: string; connectorSlug: string },
): Promise<ActiveMailCredential[]> {
  return await ctx.runQuery(
    internal.connector_credentials.queries.listActiveCredentialsInternal,
    {
      organizationId: args.organizationId,
      connectorSlug: args.connectorSlug,
    },
  );
}

/**
 * IMAP From and login are the same value. Mirror the basic-auth username into
 * public `config.fromAddress` when missing so the Inbox Mail line can read it
 * without decrypting on the client. Returns the username when it looks like an
 * email, for use as `accountEmail` fallback on this sync pass.
 *
 * Backfill only — credentials written after the mirror landed carry it from
 * create/update, so the caller skips this entirely when the public config
 * already resolves an address (a decrypt per mailbox per pass otherwise).
 */
async function healImapFromAddress(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    connectorSlug: string;
    credentialRef?: string;
  },
): Promise<string | undefined> {
  if (args.connectorSlug !== 'imap-smtp') return undefined;
  try {
    const resolved = await resolveConnectorCredential(ctx, {
      organizationId: args.organizationId,
      connectorSlug: args.connectorSlug,
      ...(args.credentialRef !== undefined && {
        credentialRef: args.credentialRef,
      }),
    });
    const username = resolved.secrets.username?.trim();
    if (!username || !looksLikeEmailAddress(username)) return undefined;

    const nextConfig = withImapFromAddress(
      'imap-smtp',
      resolved.config,
      username,
    );
    const currentFrom =
      typeof resolved.config.fromAddress === 'string'
        ? resolved.config.fromAddress
        : undefined;
    if (nextConfig !== undefined && nextConfig.fromAddress !== currentFrom) {
      await ctx.runMutation(
        internal.connector_credentials.mutations.patchCredentialInternal,
        {
          organizationId: args.organizationId,
          credentialId: resolved.credentialId,
          config: nextConfig,
        },
      );
      console.info(
        `[syncMailbox] mirrored IMAP fromAddress from login for credential ${resolved.credentialId}`,
      );
    }
    return username;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[syncMailbox] IMAP fromAddress heal failed (${args.credentialRef ?? 'default'}): ${message}`,
    );
    return undefined;
  }
}

async function syncOneMailbox(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    connectorSlug: string;
    limit: number;
    includeSent: boolean;
    mode: 'mock' | 'live';
    credentialRef?: string;
    inboundSince: number | null;
    outboundSince: number | null;
  },
): Promise<
  ConversationSyncResult & {
    inboundTip: number | null;
    outboundTip: number | null;
  }
> {
  // Public config first: it needs no decryption, and once the mirror exists the
  // heal below has nothing to do — so the steady state costs one indexed read
  // per pass instead of a credential decrypt per mailbox per pass.
  const credentialRefArg =
    args.credentialRef !== undefined
      ? { credentialRef: args.credentialRef }
      : {};
  let accountEmail = await resolveConnectorAccountEmail(ctx, {
    organizationId: args.organizationId,
    connectorName: args.connectorSlug,
    ...credentialRefArg,
  });
  if (accountEmail === undefined) {
    accountEmail = await healImapFromAddress(ctx, {
      organizationId: args.organizationId,
      connectorSlug: args.connectorSlug,
      ...credentialRefArg,
    });
  }

  const inboundListed = await listFolder(ctx, {
    organizationId: args.organizationId,
    connectorSlug: args.connectorSlug,
    since: args.inboundSince,
    limit: args.limit,
    mode: args.mode,
    ...(args.credentialRef !== undefined && {
      credentialRef: args.credentialRef,
    }),
  });
  const inboundEmails = await fetchBodies(ctx, {
    organizationId: args.organizationId,
    connectorSlug: args.connectorSlug,
    summaries: inboundListed,
    mode: args.mode,
    ...(args.credentialRef !== undefined && {
      credentialRef: args.credentialRef,
    }),
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
  let outboundTip: number | null = null;

  if (args.includeSent) {
    const sentListed = await listFolder(ctx, {
      organizationId: args.organizationId,
      connectorSlug: args.connectorSlug,
      since: args.outboundSince,
      limit: args.limit,
      mailbox: 'sent',
      mode: args.mode,
      ...(args.credentialRef !== undefined && {
        credentialRef: args.credentialRef,
      }),
    });
    listed += sentListed.length;
    const sentEmails = await fetchBodies(ctx, {
      organizationId: args.organizationId,
      connectorSlug: args.connectorSlug,
      summaries: sentListed,
      mode: args.mode,
      ...(args.credentialRef !== undefined && {
        credentialRef: args.credentialRef,
      }),
    });
    outboundTip = tipFromEmails(sentEmails);
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
    inboundTip: tipFromEmails(inboundEmails),
    outboundTip,
  };
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

  const credentials = await listActiveMailCredentials(ctx, {
    organizationId: args.organizationId,
    connectorSlug: args.connectorSlug,
  });

  // No credential rows yet (mock packs, first install mid-setup): keep the
  // legacy single pass against the connector default resolver.
  if (credentials.length === 0) {
    const inboundCursor = await querySyncCursor(ctx, {
      organizationId: args.organizationId,
      connectorSlug: args.connectorSlug,
      direction: 'inbound',
    });
    const outboundCursor = args.includeSent
      ? await querySyncCursor(ctx, {
          organizationId: args.organizationId,
          connectorSlug: args.connectorSlug,
          direction: 'outbound',
        })
      : { since: null as number | null };
    const result = await syncOneMailbox(ctx, {
      organizationId: args.organizationId,
      connectorSlug: args.connectorSlug,
      limit: args.limit,
      includeSent: args.includeSent,
      mode: args.mode,
      inboundSince: inboundCursor.since,
      outboundSince: outboundCursor.since,
    });
    return {
      listed: result.listed,
      inbound: result.inbound,
      ...(result.sent !== undefined ? { sent: result.sent } : {}),
    };
  }

  let listed = 0;
  let inbound = emptyIngest();
  let sent: ConversationIngestResult | undefined;
  const failures: string[] = [];

  // Each credential keeps its own watermark. A never-synced mailbox (no
  // watermark) reads its newest `limit` messages — using the other mailbox's
  // Inbox tip here would hide Recruitment mail older than General Support.
  for (const credential of credentials) {
    const inboundSince =
      typeof credential.mailSyncInboundSince === 'number'
        ? credential.mailSyncInboundSince
        : null;
    const outboundSince =
      typeof credential.mailSyncOutboundSince === 'number'
        ? credential.mailSyncOutboundSince
        : null;

    // One mailbox failing (expired password, host unreachable) must not starve
    // the mailboxes behind it in the fan-out — each pass is independent and
    // each watermark is its own row, so isolate the failure and keep going.
    // An all-failed pass still throws below, so a broken connector is loud.
    let result: Awaited<ReturnType<typeof syncOneMailbox>>;
    try {
      result = await syncOneMailbox(ctx, {
        organizationId: args.organizationId,
        connectorSlug: args.connectorSlug,
        limit: args.limit,
        includeSent: args.includeSent,
        mode: args.mode,
        credentialRef: credential.id,
        inboundSince,
        outboundSince,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[syncMailbox] ${args.connectorSlug} credential "${credential.name}" failed: ${message}`,
      );
      failures.push(`${credential.name}: ${message}`);
      continue;
    }

    listed += result.listed;
    inbound = mergeIngest(inbound, result.inbound);
    if (result.sent !== undefined) {
      sent = sent === undefined ? result.sent : mergeIngest(sent, result.sent);
    }

    const nextInbound =
      result.inboundTip !== null &&
      (inboundSince === null || result.inboundTip > inboundSince)
        ? result.inboundTip
        : undefined;
    const nextOutbound =
      result.outboundTip !== null &&
      (outboundSince === null || result.outboundTip > outboundSince)
        ? result.outboundTip
        : undefined;
    await advanceMailSyncCursor(ctx, {
      organizationId: args.organizationId,
      credentialId: credential.id,
      ...(nextInbound !== undefined && { inboundSince: nextInbound }),
      ...(nextOutbound !== undefined && { outboundSince: nextOutbound }),
    });
  }

  // Nothing got through — the connector itself is broken, not one mailbox.
  // Throw so the workflow step fails visibly instead of reporting a quiet zero.
  if (failures.length === credentials.length) {
    throw new Error(
      `conversation.sync_mailbox: every ${args.connectorSlug} mailbox failed (${failures.join('; ')})`,
    );
  }

  return {
    listed,
    inbound: failures.length
      ? { ...inbound, reason: `mailboxes skipped — ${failures.join('; ')}` }
      : inbound,
    ...(sent !== undefined ? { sent } : {}),
  };
}

/**
 * Newest inbox envelopes across every active credential on the connector —
 * what triage packs feed into one digest. UIDs that are only unique per
 * mailbox are scoped with the credential name so the digest can name them.
 */
export async function listMailboxMessages(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    connectorSlug: string;
    limit: number;
    mode: 'mock' | 'live';
  },
): Promise<{ messages: Array<Record<string, unknown>> }> {
  if (!EMAIL_CONNECTORS.has(args.connectorSlug)) {
    throw new Error(
      `conversation.list_mailbox_messages: unsupported connector "${args.connectorSlug}"`,
    );
  }

  const credentials = await listActiveMailCredentials(ctx, {
    organizationId: args.organizationId,
    connectorSlug: args.connectorSlug,
  });

  // No credential rows (mock packs / mid-setup): one pass on the default.
  if (credentials.length === 0) {
    const listed = await listInbox(ctx, {
      organizationId: args.organizationId,
      connectorSlug: args.connectorSlug,
      limit: args.limit,
      mode: args.mode,
    });
    return { messages: listed };
  }

  const messages: Array<Record<string, unknown>> = [];
  const failures: string[] = [];
  for (const credential of credentials) {
    // A digest over four mailboxes is still worth writing when one of them is
    // unreachable — skip that mailbox rather than losing the whole pass.
    let listed: Array<Record<string, unknown>>;
    try {
      listed = await listInbox(ctx, {
        organizationId: args.organizationId,
        connectorSlug: args.connectorSlug,
        limit: args.limit,
        mode: args.mode,
        credentialRef: credential.id,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[listMailboxMessages] ${args.connectorSlug} credential "${credential.name}" failed: ${message}`,
      );
      failures.push(`${credential.name}: ${message}`);
      continue;
    }
    for (const row of listed) {
      messages.push(stampCredentialMessage(row, credential.name));
    }
  }
  if (failures.length === credentials.length) {
    throw new Error(
      `conversation.list_mailbox_messages: every ${args.connectorSlug} mailbox failed (${failures.join('; ')})`,
    );
  }
  return { messages };
}

/** Inbox list dialect for triage (newest N, no sync cursor). */
async function listInbox(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    connectorSlug: string;
    limit: number;
    mode: 'mock' | 'live';
    credentialRef?: string;
  },
): Promise<Array<Record<string, unknown>>> {
  const input: Record<string, unknown> = {};
  if (args.connectorSlug === 'gmail') {
    input.maxResults = args.limit;
    input.q = 'in:inbox';
  } else if (args.connectorSlug === 'outlook') {
    input.top = args.limit;
    input.orderby = 'receivedDateTime desc';
  } else {
    input.limit = args.limit;
    input.mailbox = 'INBOX';
  }

  const output = await runMailAction(ctx, {
    organizationId: args.organizationId,
    connectorSlug: args.connectorSlug,
    action: 'list_messages',
    input,
    mode: args.mode,
    ...(args.credentialRef !== undefined && {
      credentialRef: args.credentialRef,
    }),
  });
  return listedMessages(output);
}

function stampCredentialMessage(
  row: Record<string, unknown>,
  credentialName: string,
): Record<string, unknown> {
  const globalId =
    typeof row.id === 'string'
      ? row.id
      : typeof row.messageId === 'string'
        ? row.messageId
        : null;
  const uid =
    typeof row.uid === 'string'
      ? row.uid
      : typeof row.uid === 'number'
        ? String(row.uid)
        : null;
  // IMAP UIDs collide across mailboxes; scope them so the digest can name one.
  const id = globalId ?? (uid !== null ? `${credentialName}:${uid}` : null);
  return {
    ...row,
    credentialName,
    ...(id !== null ? { id } : {}),
  };
}
