'use node';

/**
 * One-shot mailbox → Inbox sync for the `conversation.sync_mailbox` native.
 *
 * Each *active* credential on the mail connector — or the one the step names
 * — is one mailbox, read on its own: its Inbox and, unless the step turns it
 * off, its Sent folder. A pass lists what arrived after the mailbox's
 * position in each folder, reads it oldest first — both folders in one order,
 * so what the mailbox sent lands before the answer to it — and hands each
 * email to the conversation ingest helpers (Message-ID idempotency,
 * threading). Positions stand on the provider's own clock and move only past
 * what the pass read (`mail_sync_plan.ts`), so a backlog larger than one pass
 * drains over several and nothing is skipped; a mailbox's first pass starts
 * the given number of days back.
 *
 * A provider asking the sync to slow down stops that mailbox's pass with what
 * it read kept; an email gone since the listing is skipped; any other failure
 * stops the pass the same way and is named in the mailbox's receipt
 * (`mail_sync_failure.ts`). Only when every mailbox fails does the step fail.
 * IMAP has no push, so scheduled automations call this on a timer.
 */

import {
  type ConversationIngestResult,
  type ConversationSyncCursor,
  type ConversationSyncResult,
  FIRST_PASS_BACKFILL_DAYS,
  type MailboxSyncReceipt,
} from '../../../lib/connectors/natives/platform-conversations';
import { looksLikeEmailAddress } from '../../../lib/shared/utils/email-address';
import { isRecord } from '../../../lib/utils/type-utils';
import {
  withFromAddress,
  withImapFromAddress,
} from '../connector_credentials/imap_from_address';
import { resolveConnectorCredential } from '../connector_credentials/resolve_credential';
import type { ActionCtx } from '../lib/ctx';
import { internal } from '../lib/handler_names';
import type { Id } from '../lib/rows';
import { checkMessageExists } from './ingest/check_message_exists';
import { createConversationFromEmail } from './ingest/create_conversation_from_email';
import { createConversationFromSentEmail } from './ingest/create_conversation_from_sent_email';
import { emailEpochMs } from './ingest/email_epoch';
import { materializeEmailAttachments } from './ingest/materialize_email_attachments';
import { normalizeEmail } from './ingest/normalize_email';
import { normalizeExternalMessageId } from './ingest/normalize_external_message_id';
import { queryLatestMessageByDeliveryState } from './ingest/query_latest_message_by_delivery_state';
import { queryLatestOutboundMessageForEmailSync } from './ingest/query_latest_outbound_message_for_sync';
import { resolveConnectorAccountEmail } from './ingest/resolve_connector_account_email';
import {
  reuseStoredAttachments,
  settledAttachmentsOfIngested,
} from './ingest/reuse_stored_attachments';
import type { EmailType } from './ingest/types';
import { classifyMailFailure, type MailCallFailure } from './mail_sync_failure';
import {
  advancedPosition,
  byArrival,
  distinctCandidates,
  edgeAt,
  edgeIds,
  fittingWindow,
  type MailCandidate,
  type MailEdges,
  type MailFolder,
  planTimedPass,
  readEdges,
  sameEdge,
  usablePosition,
} from './mail_sync_plan';

const EMAIL_CONNECTORS = new Set(['gmail', 'outlook', 'imap-smtp']);

interface ActiveMailCredential {
  id: Id<'connectorCredentials'>;
  name: string;
  isDefault: boolean;
  mailSyncInboundSince?: number;
  mailSyncOutboundSince?: number;
  /** The emails already read at each folder's position (`readEdges`). */
  mailSyncEdges?: unknown;
}

async function advanceMailSyncCursor(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    credentialId: Id<'connectorCredentials'>;
    inboundSince?: number;
    outboundSince?: number;
    edges?: MailEdges;
  },
): Promise<void> {
  if (
    args.inboundSince === undefined &&
    args.outboundSince === undefined &&
    args.edges === undefined
  ) {
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
      ...(args.edges !== undefined && { mailSyncEdges: args.edges }),
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
    conversationIds: [...new Set([...a.conversationIds, ...b.conversationIds])],
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

/**
 * One body, or `null` when the envelope carries no id to fetch it by. `at` is
 * Gmail's own arrival clock (`internalDate`), which only the message carries;
 * Graph's and the IMAP server's come with the listing.
 */
async function fetchOneBody(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    connectorSlug: string;
    summary: Record<string, unknown>;
    mode: 'mock' | 'live';
    credentialRef?: string;
  },
): Promise<{ email: unknown; at: number | null } | null> {
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
    return { email: unwrapFetchedMessage(output), at: null };
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
  const fetched = unwrapFetchedMessage(output);
  return {
    email: await withConnectorStoredAttachments(ctx, {
      ...args,
      messageId,
      fetched,
    }),
    at:
      args.connectorSlug === 'gmail' && isRecord(fetched)
        ? emailEpochMs(fetched.internalDate)
        : null,
  };
}

type EmailAttachment = NonNullable<EmailType['attachments']>[number];

/** Whether a fetched message has attachments: Gmail lists its parts, Graph
 *  lists none on the message and only raises `hasAttachments`. */
function announcesAttachments(fetched: unknown, email: unknown): boolean {
  if (!isRecord(email)) return false;
  return (
    (Array.isArray(email.attachments) && email.attachments.length > 0) ||
    (isRecord(fetched) && fetched.hasAttachments === true)
  );
}

/** The attachments a connector's `get_message` stored, as wire attachments:
 *  its `fileId` is the org blob ref ingest calls `storageId`, and a part it
 *  could not carry comes back `truncated`. */
function connectorStoredAttachments(output: unknown): EmailAttachment[] {
  if (!isRecord(output) || !Array.isArray(output.attachments)) return [];
  const attachments: EmailAttachment[] = [];
  for (const raw of output.attachments) {
    if (!isRecord(raw) || typeof raw.id !== 'string') continue;
    const filename =
      typeof raw.filename === 'string'
        ? raw.filename
        : typeof raw.name === 'string'
          ? raw.name
          : 'attachment';
    attachments.push({
      id: raw.id,
      filename,
      contentType:
        typeof raw.contentType === 'string'
          ? raw.contentType
          : 'application/octet-stream',
      size: typeof raw.size === 'number' ? raw.size : 0,
      ...(typeof raw.contentId === 'string' && { contentId: raw.contentId }),
      ...(typeof raw.fileId === 'string'
        ? { storageId: raw.fileId }
        : raw.truncated === true
          ? { truncated: true }
          : {}),
    });
  }
  return attachments;
}

/** The message's parts with the connector's stored references laid on by id;
 *  a stored attachment the message never listed (all of Outlook's) is kept. */
function withStoredReferences(
  parts: EmailAttachment[],
  stored: EmailAttachment[],
): EmailAttachment[] {
  const byId = new Map(stored.map((attachment) => [attachment.id, attachment]));
  const merged = parts.map((part) => {
    const match = byId.get(part.id);
    if (match === undefined) return part;
    byId.delete(part.id);
    return {
      ...part,
      ...(match.storageId !== undefined && { storageId: match.storageId }),
      ...(match.truncated === true && { truncated: true }),
    };
  });
  return [...merged, ...byId.values()];
}

/**
 * Gmail and Outlook hand attachments over as vendor handles: their
 * `get_message` downloads the bytes into org storage only when asked
 * (`includeAttachments`), returning each stored reference as `fileId`.
 * Without that ask every chip is metadata-only — listed, never openable.
 *
 * The ask is gated. Every poll re-fetches the message on the cursor and
 * storing is not idempotent, so a message already ingested with its
 * attachments settled keeps the references it has; only one still missing
 * bytes is fetched a second time, with them. That response is used whole:
 * Gmail's attachment ids are per-fetch, so its references only match the
 * parts of the same response.
 *
 * A failed download keeps the first fetch's metadata-only chips — the mail
 * itself must still land, and the next re-fetch may store them.
 */
async function withConnectorStoredAttachments(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    connectorSlug: string;
    messageId: string;
    fetched: unknown;
    mode: 'mock' | 'live';
    credentialRef?: string;
  },
): Promise<EmailType> {
  const email = normalizeEmail(args.fetched);
  if (!announcesAttachments(args.fetched, email)) return email;
  if (typeof email.messageId === 'string' && email.messageId !== '') {
    const settled = await settledAttachmentsOfIngested(
      ctx,
      args.organizationId,
      email.messageId,
    );
    if (settled !== null) return { ...email, attachments: settled };
  }

  let output: unknown;
  try {
    output = await runMailAction(ctx, {
      organizationId: args.organizationId,
      connectorSlug: args.connectorSlug,
      action: 'get_message',
      input: { messageId: args.messageId, includeAttachments: true },
      mode: args.mode,
      ...(args.credentialRef !== undefined && {
        credentialRef: args.credentialRef,
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[syncMailbox] ${args.connectorSlug} message ${args.messageId}: attachments not stored, keeping metadata only: ${message}`,
    );
    return email;
  }
  const withBytes = normalizeEmail(unwrapFetchedMessage(output));
  return {
    ...withBytes,
    attachments: withStoredReferences(
      withBytes.attachments ?? [],
      connectorStoredAttachments(output),
    ),
  };
}

/** What every connector call of one mailbox's pass carries. */
interface MailboxCallArgs {
  organizationId: string;
  connectorSlug: string;
  mode: 'mock' | 'live';
  credentialRef?: string;
}

function callArgs(args: MailboxCallArgs): MailboxCallArgs {
  return {
    organizationId: args.organizationId,
    connectorSlug: args.connectorSlug,
    mode: args.mode,
    ...(args.credentialRef !== undefined && {
      credentialRef: args.credentialRef,
    }),
  };
}

/**
 * Read one listed email: its body, and its attachment bytes drained into blob
 * storage BEFORE the next email is read. Reading a whole pass first would hold
 * every body's base64 payload in this action at once — enough to exhaust it;
 * one email at a time keeps one body's bytes live.
 *
 * An email already ingested has its stored pointers reused rather than its
 * bytes stored again (`reuseStoredAttachments`): storing is not idempotent, so
 * every re-read minted another blob and another `fileMetadata` row for the
 * same attachment. Null when the listing row carries no id to read it by.
 */
async function readEmail(
  ctx: ActionCtx,
  args: MailboxCallArgs & { row: Record<string, unknown> },
): Promise<{ email: unknown; at: number | null } | null> {
  const fetched = await fetchOneBody(ctx, {
    ...callArgs(args),
    summary: args.row,
  });
  if (fetched === null) return null;
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
  return { email: materialized, at: fetched.at };
}

/** Graph stamps each folder with its own field, in whole seconds — received
 * for the Inbox, sent for Sent Items — and refuses a `$filter` on one field
 * ordered by the other. */
const OUTLOOK_FIELD: Record<MailFolder, 'receivedDateTime' | 'sentDateTime'> = {
  inbox: 'receivedDateTime',
  sent: 'sentDateTime',
};

/**
 * One folder's email that arrived after `after`, oldest first, up to `limit`,
 * each with the instant the provider took it in: Outlook and IMAP list that
 * instant with the email.
 */
async function listTimedFolder(
  ctx: ActionCtx,
  args: MailboxCallArgs & { folder: MailFolder; after: number; limit: number },
): Promise<MailCandidate[]> {
  const input: Record<string, unknown> = {};
  if (args.connectorSlug === 'outlook') {
    const field = OUTLOOK_FIELD[args.folder];
    input.top = args.limit;
    // Always a folder: the mailbox's `messages` spans every folder, Sent Items
    // included, and the mailbox's own mail opened conversations with the
    // mailbox as the customer.
    input.folder = args.folder === 'sent' ? 'sentitems' : 'inbox';
    input.orderby = `${field} asc`;
    // Graph keeps whole seconds and a position never splits an instant, so
    // the listing starts at the second after it.
    const from = Math.floor(args.after / 1000) * 1000 + 1000;
    input.filter = `${field} ge ${new Date(from).toISOString()}`;
    input.select = 'id,internetMessageId,receivedDateTime,sentDateTime';
  } else {
    input.limit = args.limit;
    input.after = args.after;
    if (args.folder === 'sent') input.mailbox = 'sent';
  }
  const output = await runMailAction(ctx, {
    ...callArgs(args),
    action: 'list_messages',
    input,
  });
  const candidates: MailCandidate[] = [];
  for (const row of listedMessages(output)) {
    const candidate = timedCandidate(args, row);
    if (candidate === null) {
      console.warn(
        `[syncMailbox] ${args.connectorSlug} ${args.folder}: a listed email carries no id or arrival time to read it by; left out`,
      );
      continue;
    }
    // A listing that answers more than it was asked is held to the position
    // all the same.
    if (candidate.at !== null && candidate.at <= args.after) continue;
    candidates.push(candidate);
  }
  return candidates;
}

function timedCandidate(
  args: { connectorSlug: string; folder: MailFolder },
  row: Record<string, unknown>,
): MailCandidate | null {
  if (args.connectorSlug === 'outlook') {
    const id = typeof row.id === 'string' ? row.id : '';
    const stamp = row[OUTLOOK_FIELD[args.folder]];
    const at = typeof stamp === 'string' ? Date.parse(stamp) : Number.NaN;
    if (id === '' || !Number.isFinite(at)) return null;
    return { folder: args.folder, key: id, row, at };
  }
  const uid =
    typeof row.uid === 'string'
      ? row.uid
      : typeof row.uid === 'number'
        ? String(row.uid)
        : '';
  // The server's arrival time; a listing from before it was reported
  // carries only the sender's date.
  const at =
    typeof row.receivedAt === 'number'
      ? row.receivedAt
      : typeof row.sentAt === 'number'
        ? row.sentAt
        : Number.NaN;
  if (uid === '' || !Number.isFinite(at)) return null;
  return {
    folder: args.folder,
    // IMAP UIDs are unique per folder only.
    key: `${args.folder}:${uid}`,
    row: args.folder === 'sent' ? { ...row, mailbox: 'sent' } : row,
    at,
  };
}

/** Gmail lists at most this many ids per page. */
const GMAIL_PAGE = 500;

/** The pages one window's listing follows: Gmail may answer pages shorter
 * than asked, each saying with a token that more is left. */
const MAX_GMAIL_PAGES = 10;

/**
 * One Gmail folder's message ids in a window of whole seconds on Gmail's
 * arrival clock (`after:` and, once narrowed, `before:`), leaving out the
 * ids already read at the position (`skip`). Follows Gmail's page token: a
 * page is never taken for the whole window while a token says more is left.
 * `complete` is false when the window holds more than `want` new ids.
 */
async function listGmailWindow(
  ctx: ActionCtx,
  args: MailboxCallArgs & {
    folder: MailFolder;
    afterSec: number;
    beforeSec: number | null;
    want: number;
    skip: ReadonlySet<string>;
  },
): Promise<{ rows: MailCandidate[]; complete: boolean }> {
  const rows: MailCandidate[] = [];
  let pageToken = '';
  for (let page = 0; page < MAX_GMAIL_PAGES; page++) {
    const output = await runMailAction(ctx, {
      ...callArgs(args),
      action: 'list_messages',
      input: {
        maxResults: Math.min(GMAIL_PAGE, args.want + 1 + args.skip.size),
        q:
          args.beforeSec === null
            ? `after:${args.afterSec}`
            : `after:${args.afterSec} before:${args.beforeSec}`,
        // Always a label: without one `users.messages.list` answers EVERY
        // message — Sent included — and the mailbox's own mail opened
        // conversations with the mailbox as the customer.
        labelIds: args.folder === 'sent' ? 'SENT' : 'INBOX',
        ...(pageToken !== '' && { pageToken }),
      },
    });
    for (const row of listedMessages(output)) {
      if (typeof row.id !== 'string' || row.id === '') continue;
      if (args.skip.has(row.id)) continue;
      rows.push({ folder: args.folder, key: row.id, row, at: null });
    }
    if (rows.length > args.want) return { rows, complete: false };
    pageToken =
      isRecord(output) && typeof output.nextPageToken === 'string'
        ? output.nextPageToken
        : '';
    if (pageToken === '') return { rows, complete: true };
  }
  return { rows, complete: false };
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

/**
 * The ingest result plus the tip the pass actually COVERED — the newest message
 * it persisted (or permanently skipped). The watermark advances to `tip`, never
 * to the tip of the fetched set, so no message between the old and new watermark
 * is ever left unpersisted. `tip` rides alongside `result` (not merged into it)
 * so the sync's public `inbound`/`sent` stay the clean ConversationIngestResult.
 */
interface IngestOutcome {
  result: ConversationIngestResult;
  tip: number | null;
}

function ingestedTipOf(raw: { ingestedTip?: number | null }): number | null {
  return typeof raw.ingestedTip === 'number' ? raw.ingestedTip : null;
}

export async function ingestEmails(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    connectorSlug: string;
    emails: unknown;
    accountEmail?: string;
    /** The credential this batch was fetched with, so each message records
     *  the mailbox that carried it. */
    credentialId?: string;
    status?: 'open' | 'closed' | 'archived' | 'spam';
  },
): Promise<IngestOutcome> {
  const raw = await createConversationFromEmail(ctx, {
    organizationId: args.organizationId,
    emails: args.emails,
    connectorName: args.connectorSlug,
    ...(args.credentialId !== undefined
      ? { credentialId: args.credentialId }
      : {}),
    ...(args.accountEmail !== undefined
      ? { accountEmail: args.accountEmail }
      : {}),
    ...(args.status !== undefined ? { status: args.status } : {}),
  });
  return { result: ingestResult(raw), tip: ingestedTipOf(raw) };
}

export async function ingestSentEmails(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    connectorSlug: string;
    emails: unknown;
    accountEmail?: string;
    /** The credential this batch was fetched with. */
    credentialId?: string;
    status?: 'open' | 'closed' | 'archived' | 'spam';
  },
): Promise<IngestOutcome> {
  const raw = await createConversationFromSentEmail(ctx, {
    organizationId: args.organizationId,
    emails: args.emails,
    connectorName: args.connectorSlug,
    ...(args.credentialId !== undefined
      ? { credentialId: args.credentialId }
      : {}),
    ...(args.accountEmail !== undefined
      ? { accountEmail: args.accountEmail }
      : {}),
    ...(args.status !== undefined ? { status: args.status } : {}),
  });
  return { result: ingestResult(raw), tip: ingestedTipOf(raw) };
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

/**
 * Gmail and Outlook twins of the IMAP heal. An OAuth credential carries no
 * login to mirror, so the first pass asks the provider who the mailbox is
 * (`get_profile`) and keeps the answer on public `config.fromAddress` — the
 * Inbox header, the composer and every later pass read it from there.
 * Without it the ingest cannot tell the mailbox's own mail from the
 * customer's, and a thread the mailbox started opened with the mailbox as
 * the contact and every direction inverted.
 *
 * Backfill only, like the IMAP heal: the caller skips it once the public
 * config resolves an address. A provider that cannot answer leaves the
 * pass to run as before.
 */
async function healOAuthFromAddress(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    connectorSlug: string;
    mode: 'mock' | 'live';
    credentialRef?: string;
  },
): Promise<string | undefined> {
  if (args.connectorSlug !== 'gmail' && args.connectorSlug !== 'outlook') {
    return undefined;
  }
  try {
    const row: unknown = await ctx.runQuery(
      internal.connector_credentials.queries.resolveCredentialRefInternal,
      {
        organizationId: args.organizationId,
        connectorSlug: args.connectorSlug,
        ...(args.credentialRef !== undefined && {
          credentialRef: args.credentialRef,
        }),
      },
    );
    if (!isRecord(row) || typeof row._id !== 'string') return undefined;
    const output = await runMailAction(ctx, {
      organizationId: args.organizationId,
      connectorSlug: args.connectorSlug,
      action: 'get_profile',
      input: {},
      mode: args.mode,
      ...(args.credentialRef !== undefined && {
        credentialRef: args.credentialRef,
      }),
    });
    const address =
      isRecord(output) && typeof output.emailAddress === 'string'
        ? output.emailAddress.trim()
        : '';
    if (!looksLikeEmailAddress(address)) return undefined;
    const config = isRecord(row.config) ? row.config : undefined;
    const nextConfig = withFromAddress(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the shim serves config as the credential's public scalar map
      config as Record<string, string | number | boolean> | undefined,
      address,
    );
    if (
      nextConfig !== undefined &&
      nextConfig.fromAddress !== config?.fromAddress
    ) {
      await ctx.runMutation(
        internal.connector_credentials.mutations.patchCredentialInternal,
        {
          organizationId: args.organizationId,
          credentialId: row._id,
          config: nextConfig,
        },
      );
      console.info(
        `[syncMailbox] learned the ${args.connectorSlug} mailbox address for credential ${row._id}`,
      );
    }
    return address;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[syncMailbox] ${args.connectorSlug} mailbox address heal failed (${args.credentialRef ?? 'default'}): ${message}`,
    );
    return undefined;
  }
}

// ---------------------------------------------------------------- the pass

const DAY_MS = 86_400_000;

/** An instant holding more email than one pass is read whole, up to this
 * many — the listing ceilings of Graph and of the IMAP native. */
const MAX_INSTANT_EMAILS = 1000;

/** Probes one pass may spend narrowing a Gmail backlog to a window it reads
 * whole: enough to halve years down to one second. */
const MAX_WINDOW_PROBES = 32;

/** Windows one Gmail pass plans: a window that held only emails read already
 * is planned once more without them. */
const MAX_GMAIL_PLANS = 2;

/** One mailbox's pass. */
interface MailboxPassArgs extends MailboxCallArgs {
  /** The receipt's name for the mailbox. */
  name: string;
  /** Emails the pass reads, Inbox and Sent together. */
  limit: number;
  includeSent: boolean;
  /** Each folder's position; null for a folder never read. */
  positions: Record<MailFolder, number | null>;
  /** The emails already read at each folder's position, as stored. */
  storedEdges: MailEdges;
  /** Where a folder never read starts: the first pass's window. */
  backfillFrom: number;
}

interface MailboxPass {
  receipt: MailboxSyncReceipt;
  inbound: ConversationIngestResult;
  sent?: ConversationIngestResult;
  /** The positions to keep, for the folders that moved. */
  moved: Partial<Record<MailFolder, number>>;
  /** The edges to keep, when they changed (Gmail). */
  edges?: MailEdges;
}

/** The emails a pass reads, and every email its positions are computed over. */
interface PassPlan {
  /** In the order they are read. */
  take: MailCandidate[];
  /** Every email listed, those left for a later pass included. */
  listed: MailCandidate[];
  capped: boolean;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * The emails of Outlook and IMAP folders a pass reads: each folder lists one
 * more than the pass reads, and `planTimedPass` keeps whole instants. An
 * instant that alone holds more than a pass is listed again, whole.
 */
async function planTimedFolders(
  ctx: ActionCtx,
  args: MailboxPassArgs,
  folders: readonly MailFolder[],
  starts: Record<MailFolder, number>,
): Promise<PassPlan> {
  const listings: Array<{ folder: MailFolder; candidates: MailCandidate[] }> =
    [];
  for (const folder of folders) {
    listings.push({
      folder,
      candidates: await listTimedFolder(ctx, {
        ...callArgs(args),
        folder,
        after: starts[folder],
        limit: args.limit + 1,
      }),
    });
  }
  const planned = planTimedPass(listings, args.limit);
  if (planned.widen === undefined) {
    return {
      take: planned.take,
      listed: listings.flatMap((listing) => listing.candidates),
      capped: planned.capped,
    };
  }
  const { folder, at } = planned.widen;
  const wide = await listTimedFolder(ctx, {
    ...callArgs(args),
    folder,
    after: starts[folder],
    limit: MAX_INSTANT_EMAILS,
  });
  const instant = wide.filter((candidate) => candidate.at === at);
  if (instant.length >= MAX_INSTANT_EMAILS) {
    throw new Error(
      `more than ${MAX_INSTANT_EMAILS} emails of the ${folder} folder share one instant (${iso(at)}), too many to read in one pass`,
    );
  }
  return {
    take: instant,
    listed: [
      ...wide,
      ...listings
        .filter((listing) => listing.folder !== folder)
        .flatMap((listing) => listing.candidates),
    ],
    capped: true,
  };
}

/**
 * The Gmail emails a pass reads: Gmail lists ids without their instants,
 * newest first, so the pass reads a whole window — every email of it — and
 * learns the instants from the bodies. A window that holds more than a pass
 * is narrowed (`fittingWindow`); the rest waits for the next pass.
 */
async function planGmailPass(
  ctx: ActionCtx,
  args: MailboxPassArgs,
  folders: readonly MailFolder[],
  starts: Record<MailFolder, number>,
  skip: Record<MailFolder, ReadonlySet<string>>,
): Promise<PassPlan> {
  // `after:` reads whole seconds, so the second the position falls in is
  // listed again. Its emails already read are left out by id (`skip`, the
  // folder's edge) — counted, they could fill every window and the pass
  // would never move — and any other one at or before the position is
  // passed over once its instant is read.
  const afterSec = (folder: MailFolder): number =>
    Math.floor(starts[folder] / 1000);
  const probe = async (beforeSec: number | null, perPass: number) => {
    const rows: MailCandidate[] = [];
    let overflow = false;
    for (const folder of folders) {
      if (beforeSec !== null && beforeSec <= afterSec(folder)) continue;
      const listed = await listGmailWindow(ctx, {
        ...callArgs(args),
        folder,
        afterSec: afterSec(folder),
        beforeSec,
        want: perPass,
        skip: skip[folder],
      });
      if (!listed.complete) overflow = true;
      rows.push(...listed.rows);
    }
    const distinct = distinctCandidates(rows);
    return { rows: distinct, overflow: overflow || distinct.length > perPass };
  };
  const window = await fittingWindow({
    fromSec: Math.min(...folders.map(afterSec)),
    nowSec: Math.floor(Date.now() / 1000),
    probe: (beforeSec) => probe(beforeSec, args.limit),
    maxProbes: MAX_WINDOW_PROBES,
    enough: Math.ceil(args.limit / 2),
  });
  if (!('overflowAt' in window)) {
    return {
      // Gmail lists newest first: read the oldest first.
      take: [...window.rows].reverse(),
      listed: window.rows,
      capped: window.narrowed,
    };
  }
  // One second holds more than a pass: read that window whole, up to a page.
  const whole = await probe(window.overflowAt, GMAIL_PAGE - 1);
  if (whole.overflow) {
    throw new Error(
      `more than ${GMAIL_PAGE - 1} Gmail emails arrived within one second before ${iso(window.overflowAt * 1000)}, too many to read in one pass`,
    );
  }
  return { take: [...whole.rows].reverse(), listed: whole.rows, capped: true };
}

/** The mailbox's own address, for telling its email from everyone else's
 * (`CONV-R7`): the connection's public config first — no decryption — and the
 * heals below only while it names none. */
async function mailboxAddress(
  ctx: ActionCtx,
  args: MailboxCallArgs,
): Promise<string | undefined> {
  const credentialRefArg =
    args.credentialRef !== undefined
      ? { credentialRef: args.credentialRef }
      : {};
  const known = await resolveConnectorAccountEmail(ctx, {
    organizationId: args.organizationId,
    connectorName: args.connectorSlug,
    ...credentialRefArg,
  });
  if (known !== undefined) return known;
  return args.connectorSlug === 'imap-smtp'
    ? await healImapFromAddress(ctx, {
        organizationId: args.organizationId,
        connectorSlug: args.connectorSlug,
        ...credentialRefArg,
      })
    : await healOAuthFromAddress(ctx, {
        organizationId: args.organizationId,
        connectorSlug: args.connectorSlug,
        mode: args.mode,
        ...credentialRefArg,
      });
}

type StoreOutcome = 'stored' | 'duplicate' | 'skipped';

/** Hand one email to the ingest helpers (`CONV-R5` to `CONV-R7`). */
async function storeEmail(
  ctx: ActionCtx,
  args: MailboxCallArgs & {
    folder: MailFolder;
    email: unknown;
    accountEmail?: string;
  },
): Promise<{ outcome: StoreOutcome; result: ConversationIngestResult }> {
  const ingestArgs = {
    organizationId: args.organizationId,
    emails: [args.email],
    connectorName: args.connectorSlug,
    status: 'open' as const,
    ...(args.accountEmail !== undefined
      ? { accountEmail: args.accountEmail }
      : {}),
    // The mailbox that carried it, so the message records it.
    ...(args.credentialRef !== undefined
      ? { credentialId: args.credentialRef }
      : {}),
  };
  const raw =
    args.folder === 'sent'
      ? await createConversationFromSentEmail(ctx, ingestArgs)
      : await createConversationFromEmail(ctx, ingestArgs);
  // The pass reports per email in its receipt; a reason belongs to a batch.
  const { reason: _reason, ...result } = ingestResult(raw);
  const already =
    'alreadyStoredCount' in raw && typeof raw.alreadyStoredCount === 'number'
      ? raw.alreadyStoredCount
      : 0;
  return {
    outcome:
      result.skippedCount > 0
        ? 'skipped'
        : already > 0
          ? 'duplicate'
          : 'stored',
    result,
  };
}

/**
 * One mailbox's pass: list what arrived after each folder's position, read
 * and store it oldest first — Inbox and Sent in one order — and work out how
 * far each position moves. Never throws: whatever stops the pass is the
 * receipt's to say, and what the pass read before it is kept.
 */
async function syncOneMailbox(
  ctx: ActionCtx,
  args: MailboxPassArgs,
): Promise<MailboxPass> {
  const folders: MailFolder[] = args.includeSent
    ? ['sent', 'inbox']
    : ['inbox'];
  const starts: Record<MailFolder, number> = {
    inbox: args.positions.inbox ?? args.backfillFrom,
    sent: args.positions.sent ?? args.backfillFrom,
  };
  const receipt: MailboxSyncReceipt = {
    mailbox: args.name,
    ok: true,
    listed: 0,
    fetched: 0,
    ingested: 0,
    duplicates: 0,
    skipped: 0,
    vanished: 0,
    capped: false,
  };
  /** What the pass stored, per folder, and what stopped it. */
  const tally: {
    inbound: ConversationIngestResult;
    sent: ConversationIngestResult | undefined;
    stop: MailCallFailure | null;
  } = {
    inbound: emptyIngest(),
    sent: args.includeSent ? emptyIngest() : undefined,
    stop: null,
  };
  const handled = new Set<string>();
  /** Gmail emails listed again at the edge of the position: passed over,
   * and counted nowhere. */
  const passedOver = new Set<string>();
  let plan: PassPlan | null = null;

  const store = async (
    candidate: MailCandidate,
    email: unknown,
    accountEmail: string | undefined,
  ): Promise<boolean> => {
    let stored: Awaited<ReturnType<typeof storeEmail>>;
    try {
      stored = await storeEmail(ctx, {
        ...callArgs(args),
        folder: candidate.folder,
        email,
        ...(accountEmail !== undefined && { accountEmail }),
      });
    } catch (error) {
      tally.stop = { kind: 'failed', message: messageOf(error) };
      return false;
    }
    handled.add(candidate.key);
    if (stored.outcome === 'stored') receipt.ingested += 1;
    else if (stored.outcome === 'duplicate') receipt.duplicates += 1;
    else receipt.skipped += 1;
    if (candidate.folder === 'sent') {
      tally.sent = mergeIngest(tally.sent ?? emptyIngest(), stored.result);
    } else {
      tally.inbound = mergeIngest(tally.inbound, stored.result);
    }
    return true;
  };

  /** Read one email: its body, `skip` when it cannot be read and never will
   * be, `stop` when the pass must end here. */
  const read = async (
    candidate: MailCandidate,
  ): Promise<{ email: unknown; at: number | null } | 'skip' | 'stop'> => {
    try {
      const body = await readEmail(ctx, {
        ...callArgs(args),
        row: candidate.row,
      });
      if (body === null) {
        handled.add(candidate.key);
        receipt.skipped += 1;
        return 'skip';
      }
      return body;
    } catch (error) {
      const failure = classifyMailFailure(error, 'read');
      if (failure.kind === 'gone') {
        console.warn(
          `[syncMailbox] ${args.connectorSlug} mailbox "${args.name}": an email listed in ${candidate.folder} is gone since the listing; skipped (${failure.message})`,
        );
        handled.add(candidate.key);
        receipt.vanished += 1;
        return 'skip';
      }
      tally.stop = failure;
      return 'stop';
    }
  };

  try {
    const accountEmail = await mailboxAddress(ctx, args);
    if (args.connectorSlug === 'gmail') {
      // Read each window whole first: Gmail's instants come with the bodies.
      const skip: Record<MailFolder, Set<string>> = {
        inbox: new Set(edgeIds(args.storedEdges.inbox, args.positions.inbox)),
        sent: new Set(edgeIds(args.storedEdges.sent, args.positions.sent)),
      };
      const bodies = new Map<string, unknown>();
      const taken: MailCandidate[] = [];
      const listedAll = new Map<string, MailCandidate>();
      for (let attempt = 0; attempt < MAX_GMAIL_PLANS; attempt++) {
        const planned = await planGmailPass(ctx, args, folders, starts, skip);
        for (const candidate of planned.listed) {
          listedAll.set(candidate.key, candidate);
        }
        plan = {
          take: taken,
          listed: [...listedAll.values()],
          capped: planned.capped,
        };
        receipt.capped = planned.capped;
        /** Whether the window held anything besides emails read already. */
        let fresh = false;
        let stopped = false;
        for (const candidate of planned.take) {
          const body = await read(candidate);
          if (body === 'stop') {
            stopped = true;
            break;
          }
          if (body === 'skip') {
            fresh = true;
            continue;
          }
          candidate.at = body.at;
          if (body.at !== null && body.at <= starts[candidate.folder]) {
            handled.add(candidate.key);
            passedOver.add(candidate.key);
            skip[candidate.folder].add(candidate.key);
            continue;
          }
          fresh = true;
          receipt.fetched += 1;
          bodies.set(candidate.key, body.email);
          taken.push(candidate);
        }
        // A window holding only emails read already says nothing about what
        // follows them: plan once more, without them.
        if (stopped || fresh || !planned.capped) break;
      }
      for (const candidate of byArrival(taken)) {
        const email = bodies.get(candidate.key);
        if (candidate.folder === 'sent') {
          await adoptGmailSentRecord(ctx, {
            organizationId: args.organizationId,
            gmailId: candidate.key,
            email,
          });
        }
        if (!(await store(candidate, email, accountEmail))) break;
      }
    } else {
      plan = await planTimedFolders(ctx, args, folders, starts);
      receipt.capped = plan.capped;
      for (const candidate of plan.take) {
        const body = await read(candidate);
        if (body === 'stop') break;
        if (body === 'skip') continue;
        receipt.fetched += 1;
        if (!(await store(candidate, body.email, accountEmail))) break;
      }
    }
  } catch (error) {
    // The listing (or the mailbox's address) failed: nothing more was read.
    tally.stop = classifyMailFailure(error, 'list');
  }

  const moved: Partial<Record<MailFolder, number>> = {};
  const resumeFrom: { inbox?: string; sent?: string } = {};
  const listed = (plan?.listed ?? []).filter(
    (candidate) => !passedOver.has(candidate.key),
  );
  receipt.listed = listed.length;
  for (const folder of folders) {
    const before = args.positions[folder];
    let next: number | null = null;
    if (plan !== null) {
      const advanced = advancedPosition(
        listed.filter((candidate) => candidate.folder === folder),
        handled,
      );
      if (advanced !== null && (before === null || advanced > before)) {
        next = advanced;
      }
      // A first pass keeps where its window starts, email found or not, so
      // the window does not slide past mail arriving between passes.
      if (next === null && before === null) next = starts[folder];
    }
    if (next !== null) moved[folder] = next;
    const resume = next ?? before;
    if (resume !== null) resumeFrom[folder] = iso(resume);
  }

  const edges =
    args.connectorSlug === 'gmail' && plan !== null
      ? keptEdges(args, folders, {
          moved,
          read: plan.listed.filter((candidate) => handled.has(candidate.key)),
        })
      : undefined;

  const stopped = tally.stop;
  if (stopped !== null) {
    if (stopped.kind === 'rate_limited') {
      receipt.rateLimited = true;
      if (stopped.retryAfterMs !== null) {
        receipt.retryAfter = iso(Date.now() + stopped.retryAfterMs);
      }
      console.warn(
        `[syncMailbox] ${args.connectorSlug} mailbox "${args.name}" rate-limited; the next pass continues: ${stopped.message}`,
      );
    } else {
      receipt.ok = false;
      receipt.error = stopped.message;
      console.error(
        `[syncMailbox] ${args.connectorSlug} mailbox "${args.name}" stopped: ${stopped.message}`,
      );
    }
  }
  if (resumeFrom.inbox !== undefined || resumeFrom.sent !== undefined) {
    receipt.resumeFrom = resumeFrom;
  }
  return {
    receipt,
    inbound: tally.inbound,
    ...(tally.sent !== undefined && { sent: tally.sent }),
    moved,
    ...(edges !== undefined && { edges }),
  };
}

/**
 * The Gmail edges to keep after a pass, or undefined when none changed: for
 * each folder, the emails read in the second its position falls in
 * (`edgeAt`). A pass that only learned which emails it had read already
 * keeps them too, so the next one leaves them out.
 */
function keptEdges(
  args: MailboxPassArgs,
  folders: readonly MailFolder[],
  pass: {
    moved: Partial<Record<MailFolder, number>>;
    read: readonly MailCandidate[];
  },
): MailEdges | undefined {
  const next: MailEdges = { ...args.storedEdges };
  let changed = false;
  for (const folder of folders) {
    const position = pass.moved[folder] ?? args.positions[folder];
    if (position === null) continue;
    const stored = args.storedEdges[folder];
    const edge = edgeAt(position, {
      previousPosition: args.positions[folder],
      previous: edgeIds(stored, args.positions[folder]),
      read: pass.read.filter((candidate) => candidate.folder === folder),
    });
    if (edge.ids.length === 0 && stored === undefined) continue;
    if (sameEdge(stored, edge)) continue;
    next[folder] = edge;
    changed = true;
  }
  return changed ? next : undefined;
}

/**
 * A reply sent from the Inbox whose Message-ID the send could not read back
 * from Gmail was recorded under Gmail's own id (`resolveSentExternalMessageId`
 * in `domains/conversations/send.ts`). Reading it from Sent, the sync moves
 * that record to the Message-ID first, so the reply is stored once
 * (`CONV-R6`). Best-effort: a failure leaves the record as it was.
 */
async function adoptGmailSentRecord(
  ctx: ActionCtx,
  args: { organizationId: string; gmailId: string; email: unknown },
): Promise<void> {
  const messageId = normalizeExternalMessageId(
    normalizeEmail(args.email).messageId,
  );
  if (
    messageId === undefined ||
    messageId === normalizeExternalMessageId(args.gmailId)
  ) {
    return;
  }
  try {
    const recorded = await checkMessageExists(
      ctx,
      args.organizationId,
      args.gmailId,
    );
    if (recorded === null) return;
    await ctx.runMutation(
      internal.conversations.internal_mutations.updateConversationMessage,
      { messageId: recorded._id, externalMessageId: messageId },
    );
  } catch (error) {
    // Another record may hold the Message-ID already; the ingest finds it.
    console.warn(
      `[syncMailbox] gmail: the Sent email ${args.gmailId} keeps the record it has: ${messageOf(error)}`,
    );
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Sync every active mailbox of a mail connector — or the one the step names —
 * each from its own positions (`CONV-R17` to `CONV-R23`).
 */
export async function syncMailbox(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    connectorSlug: string;
    /** Emails one pass reads from each mailbox, Inbox and Sent together. */
    limit: number;
    includeSent: boolean;
    mode: 'mock' | 'live';
    /** Days a mailbox's first pass reads back; seven when absent. */
    backfillDays?: number;
    /** One mailbox by its connection name; absent or blank reads every
     * active one. */
    mailbox?: string;
  },
): Promise<ConversationSyncResult> {
  if (!EMAIL_CONNECTORS.has(args.connectorSlug)) {
    throw new Error(
      `conversation.sync_mailbox: unsupported connector "${args.connectorSlug}"`,
    );
  }

  const now = Date.now();
  const base = {
    organizationId: args.organizationId,
    connectorSlug: args.connectorSlug,
    mode: args.mode,
    limit: Math.max(1, Math.floor(args.limit)),
    includeSent: args.includeSent,
    backfillFrom:
      now - Math.max(0, args.backfillDays ?? FIRST_PASS_BACKFILL_DAYS) * DAY_MS,
  };
  const named = args.mailbox?.trim() ?? '';
  const active = await listActiveMailCredentials(ctx, {
    organizationId: args.organizationId,
    connectorSlug: args.connectorSlug,
  });
  const credentials =
    named === ''
      ? active
      : active.filter((credential) => credential.name === named);
  if (named !== '' && credentials.length === 0) {
    throw new Error(
      `conversation.sync_mailbox: no active ${args.connectorSlug} mailbox is named "${named}"`,
    );
  }

  // Every read goes through a connection in service: with none, each listing
  // would refuse, and there would be no row to keep a position on.
  if (credentials.length === 0) {
    throw new Error(
      `conversation.sync_mailbox: no active ${args.connectorSlug} mailbox is connected; connect one in Settings › Connectors`,
    );
  }

  // Each mailbox keeps its own positions on its credential row: another
  // mailbox's progress would clip one added later. One failing does not stop
  // the others.
  const passes: MailboxPass[] = [];
  for (const credential of credentials) {
    const pass = await syncOneMailbox(ctx, {
      ...base,
      name: credential.name,
      credentialRef: credential.id,
      positions: {
        inbox: usablePosition(credential.mailSyncInboundSince, now),
        sent: usablePosition(credential.mailSyncOutboundSince, now),
      },
      storedEdges: readEdges(credential.mailSyncEdges),
    });
    try {
      await advanceMailSyncCursor(ctx, {
        organizationId: args.organizationId,
        credentialId: credential.id,
        ...(pass.moved.inbox !== undefined && {
          inboundSince: pass.moved.inbox,
        }),
        ...(pass.moved.sent !== undefined && {
          outboundSince: pass.moved.sent,
        }),
        ...(pass.edges !== undefined && { edges: pass.edges }),
      });
    } catch (error) {
      // The email is stored; the next pass reads it again and finds it.
      const message = `the position was not kept: ${messageOf(error)}`;
      console.error(
        `[syncMailbox] ${args.connectorSlug} mailbox "${credential.name}": ${message}`,
      );
      pass.receipt.ok = false;
      pass.receipt.error = message;
    }
    passes.push(pass);
  }

  let inbound = emptyIngest();
  let sent: ConversationIngestResult | undefined;
  for (const pass of passes) {
    inbound = mergeIngest(inbound, pass.inbound);
    if (pass.sent !== undefined) {
      sent = sent === undefined ? pass.sent : mergeIngest(sent, pass.sent);
    }
  }
  const receipts = passes.map((pass) => pass.receipt);
  const failures = receipts.flatMap((receipt) =>
    receipt.error !== undefined ? [`${receipt.mailbox}: ${receipt.error}`] : [],
  );
  // Nothing got through — the connector itself is broken, not one mailbox.
  // Fail the step so the automation's failure notices fire, instead of a
  // quiet zero; what any pass read before failing is kept.
  if (failures.length > 0 && failures.length === receipts.length) {
    throw new Error(
      `conversation.sync_mailbox: every ${args.connectorSlug} mailbox failed (${failures.join('; ')})`,
    );
  }
  return {
    listed: receipts.reduce((sum, receipt) => sum + receipt.listed, 0),
    inbound:
      failures.length > 0
        ? { ...inbound, reason: `mailboxes skipped — ${failures.join('; ')}` }
        : inbound,
    ...(sent !== undefined && { sent }),
    mailboxes: receipts,
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
  const listed = listedMessages(output);
  if (args.connectorSlug !== 'gmail') return listed;
  return await fetchGmailEnvelopes(ctx, {
    organizationId: args.organizationId,
    listed,
    mode: args.mode,
    ...(args.credentialRef !== undefined && {
      credentialRef: args.credentialRef,
    }),
  });
}

/**
 * Gmail's `list_messages` is `users.messages.list`: bare `{id, threadId}`
 * pairs, no envelope. Outlook and IMAP list subject, sender and date in the
 * same call, so the digest reads them off the listing; Gmail needs one
 * metadata fetch per id (headers + snippet — no body, no attachment bytes) to
 * carry the same fields, in the shape the IMAP listing already has. A message
 * gone between the list and the fetch is skipped; every fetch failing fails
 * the mailbox, so a dead token cannot read as an empty inbox.
 */
async function fetchGmailEnvelopes(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    listed: Array<Record<string, unknown>>;
    mode: 'mock' | 'live';
    credentialRef?: string;
  },
): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  const failures: string[] = [];
  for (const summary of args.listed) {
    const messageId = typeof summary.id === 'string' ? summary.id : null;
    if (!messageId) continue;
    let output: unknown;
    try {
      output = await runMailAction(ctx, {
        organizationId: args.organizationId,
        connectorSlug: 'gmail',
        action: 'get_message',
        input: { messageId, format: 'metadata' },
        mode: args.mode,
        ...(args.credentialRef !== undefined && {
          credentialRef: args.credentialRef,
        }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[listMailboxMessages] gmail message ${messageId} skipped: ${message}`,
      );
      failures.push(`${messageId}: ${message}`);
      continue;
    }
    const fetched = unwrapFetchedMessage(output);
    // A connector answer that is not a raw Gmail message normalizes to itself,
    // so every envelope field is read as possibly absent.
    const email: Partial<EmailType> = normalizeEmail(fetched);
    const sender = email.from?.[0];
    const sentAt = emailEpochMs(email.date);
    rows.push({
      ...summary,
      id: messageId,
      from: sender?.address ?? sender?.name ?? '',
      subject: email.subject ?? '',
      ...(sentAt !== null && { sentAt }),
      snippet:
        isRecord(fetched) && typeof fetched.snippet === 'string'
          ? fetched.snippet
          : '',
    });
  }
  if (rows.length === 0 && failures.length > 0) {
    throw new Error(
      `conversation.list_mailbox_messages: every gmail message fetch failed (${failures.join('; ')})`,
    );
  }
  return rows;
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
