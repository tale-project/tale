/**
 * Native backend for the `conversation` platform connector — ingest mailbox
 * traffic into the org Inbox and expose a one-shot sync for scheduled packs.
 *
 * Write paths go through the conversation ingest helpers (Message-ID
 * idempotency, threading, contact find-or-create, address routing) so the
 * domain invariants stay in one place.
 */

import { z } from 'zod';

import type {
  NativeConnectorContext,
  NativeConnectorImpl,
} from '../dispatcher';
import { ConnectorError } from '../errors';

const emailAddress = z.object({
  address: z.string().optional(),
  name: z.string().optional(),
});

const emailSchema = z
  .object({
    messageId: z.string().optional(),
    from: z.array(emailAddress).optional(),
    to: z.array(emailAddress).optional(),
    cc: z.array(emailAddress).optional(),
    bcc: z.array(emailAddress).optional(),
    subject: z.string().optional(),
    date: z.string().optional(),
    text: z.string().optional(),
    html: z.string().optional(),
    direction: z.enum(['inbound', 'outbound']).optional(),
    inReplyTo: z.string().optional(),
    references: z.union([z.string(), z.array(z.string())]).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    attachments: z.array(z.unknown()).optional(),
  })
  .passthrough();

const ingestInput = z
  .object({
    /** One email or an array of them — the catalog's declared shape; the
     * ingest normaliser accepts both, so anything else is refused here. */
    emails: z.union([z.array(emailSchema), emailSchema]),
    connectorSlug: z.string().min(1),
    accountEmail: z.string().optional(),
    status: z.enum(['open', 'closed', 'archived', 'spam']).optional(),
  })
  .strict();

const syncInput = z
  .object({
    connectorSlug: z.string().min(1),
    /** Emails one pass reads from each mailbox, Inbox and Sent together. */
    limit: z.number().int().positive().max(100).optional(),
    /** Read the Sent folder with the Inbox, so a thread holds both sides. */
    includeSent: z.boolean().optional(),
    /** One mailbox by its connection name; blank reads every active one. */
    mailbox: z.string().max(200).optional(),
    /** Days a mailbox's first pass reads back. */
    backfillDays: z.number().int().min(0).max(365).optional(),
  })
  .strict();

const listMailboxInput = z
  .object({
    connectorSlug: z.string().min(1),
    limit: z.number().int().nonnegative().max(100).optional(),
  })
  .strict();

const listUntriagedInput = z
  .object({
    connectorSlug: z.string().min(1),
    limit: z.number().int().nonnegative().max(100).optional(),
  })
  .strict();

const triageVerdict = z
  .object({
    conversationId: z.string().min(1),
    action: z.enum(['reply', 'no_reply']),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    reason: z.string().max(500).optional(),
  })
  .strict();

const recordTriageInput = z
  .object({
    verdicts: z.array(triageVerdict).max(100),
  })
  .strict();

const draftReplyInput = z
  .object({
    conversationId: z.string().min(1),
    body: z.string().min(1),
    guidelineVersion: z.string().min(1).optional(),
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict();

const cursorInput = z
  .object({
    connectorSlug: z.string().min(1),
    direction: z.enum(['inbound', 'outbound']).default('inbound'),
  })
  .strict();

export interface ConversationIngestResult {
  created: boolean;
  processedCount: number;
  skippedCount: number;
  conversationIds: string[];
  reason?: string;
}

/** What one sync pass did in one mailbox — the run record's account of it. */
export interface MailboxSyncReceipt {
  /** The mailbox's connection name; `default` when the connector has no
   * stored connection. */
  mailbox: string;
  /** False when the pass stopped on an error (`error`). */
  ok: boolean;
  /** Emails listed after the mailbox's position. */
  listed: number;
  /** Emails whose body was read. */
  fetched: number;
  /** Emails stored for the first time. */
  ingested: number;
  /** Emails read again that were stored already. */
  duplicates: number;
  /** Emails that cannot be stored: no Message-ID, or no one to file them
   * under. */
  skipped: number;
  /** Emails deleted or moved between the listing and the read. */
  vanished: number;
  /** More email is waiting than one pass reads; the next pass continues. */
  capped: boolean;
  /** The provider asked the sync to slow down, and the pass stopped there. */
  rateLimited?: true;
  /** When the provider allows the next try, when it said (ISO 8601). */
  retryAfter?: string;
  /** Why the pass stopped early. */
  error?: string;
  /** Where the next pass starts, per folder (ISO 8601): it reads what
   * arrived after that instant. */
  resumeFrom?: { inbox?: string; sent?: string };
}

export interface ConversationSyncResult {
  inbound: ConversationIngestResult;
  sent?: ConversationIngestResult;
  listed: number;
  /** One receipt per mailbox the pass read, in the order read. */
  mailboxes: MailboxSyncReceipt[];
}

export interface ConversationSyncCursor {
  since: number | null;
  messageId: string | null;
}

export interface ConversationListMailboxResult {
  messages: Array<Record<string, unknown>>;
}

export interface ConversationDraftReplyResult {
  approvalId: string;
  /** False when the conversation already carried a pending draft. */
  created: boolean;
}

/** One open thread waiting on the team, as the triage packs read it. */
export interface ConversationUntriagedItem {
  conversationId: string;
  subject: string;
  contact: { name: string; email: string };
  lastInboundAt: string;
  lastInboundText: string;
  unreadCount: number;
  assigned: boolean;
  url: string;
}

export interface ConversationListUntriagedResult {
  conversations: ConversationUntriagedItem[];
}

export interface ConversationTriageVerdict {
  conversationId: string;
  action: 'reply' | 'no_reply';
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  reason?: string;
}

export interface ConversationRecordTriageResult {
  recorded: number;
  prioritized: number;
  unknown: string[];
}

/** What the rim needs from the conversation domain. */
export interface WorkflowConversationStore {
  ingestEmails(args: {
    organizationId: string;
    connectorSlug: string;
    emails: unknown;
    accountEmail?: string;
    status?: 'open' | 'closed' | 'archived' | 'spam';
  }): Promise<ConversationIngestResult>;
  ingestSentEmails(args: {
    organizationId: string;
    connectorSlug: string;
    emails: unknown;
    accountEmail?: string;
    status?: 'open' | 'closed' | 'archived' | 'spam';
  }): Promise<ConversationIngestResult>;
  querySyncCursor(args: {
    organizationId: string;
    connectorSlug: string;
    direction: 'inbound' | 'outbound';
  }): Promise<ConversationSyncCursor>;
  syncMailbox(args: {
    organizationId: string;
    connectorSlug: string;
    limit: number;
    includeSent: boolean;
    mode: 'mock' | 'live';
    /** Days a mailbox's first pass reads back. */
    backfillDays: number;
    /** One mailbox by its connection name; absent reads every one. */
    mailbox?: string;
  }): Promise<ConversationSyncResult>;
  listMailboxMessages(args: {
    organizationId: string;
    connectorSlug: string;
    limit: number;
    mode: 'mock' | 'live';
  }): Promise<ConversationListMailboxResult>;
  listUntriagedConversations(args: {
    organizationId: string;
    connectorSlug: string;
    limit: number;
  }): Promise<ConversationListUntriagedResult>;
  recordTriage(args: {
    organizationId: string;
    verdicts: ConversationTriageVerdict[];
    runId?: string;
  }): Promise<ConversationRecordTriageResult>;
  draftReply(args: {
    organizationId: string;
    conversationId: string;
    body: string;
    guidelineVersion?: string;
    confidence?: number;
    runId?: string;
    nodeId?: string;
  }): Promise<ConversationDraftReplyResult>;
}

/** Emails one sync pass reads from each mailbox when the step names no
 * `limit` — Inbox and Sent together. */
const MAILBOX_PASS_LIMIT = 50;

/** Days a mailbox's first sync pass reads back when the step names none. */
export const FIRST_PASS_BACKFILL_DAYS = 7;

function refuse(action: string, issues: z.ZodError): never {
  throw new ConnectorError(
    'INPUT_INVALID',
    `conversation.${action}: ${issues.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join('.') || 'input'} ${issue.message}`)
      .join('; ')}`,
  );
}

export function platformConversationNatives(
  store: WorkflowConversationStore,
): Record<string, NativeConnectorImpl> {
  const ingest_emails: NativeConnectorImpl = async (
    raw: unknown,
    ctx: NativeConnectorContext,
  ) => {
    const parsed = ingestInput.safeParse(raw);
    if (!parsed.success) refuse('ingest_emails', parsed.error);
    const { emails, connectorSlug, accountEmail, status } = parsed.data;
    return await store.ingestEmails({
      organizationId: ctx.organizationId,
      connectorSlug,
      emails,
      ...(accountEmail !== undefined && { accountEmail }),
      ...(status !== undefined && { status }),
    });
  };

  const ingest_sent_emails: NativeConnectorImpl = async (
    raw: unknown,
    ctx: NativeConnectorContext,
  ) => {
    const parsed = ingestInput.safeParse(raw);
    if (!parsed.success) refuse('ingest_sent_emails', parsed.error);
    const { emails, connectorSlug, accountEmail, status } = parsed.data;
    return await store.ingestSentEmails({
      organizationId: ctx.organizationId,
      connectorSlug,
      emails,
      ...(accountEmail !== undefined && { accountEmail }),
      ...(status !== undefined && { status }),
    });
  };

  const query_sync_cursor: NativeConnectorImpl = async (
    raw: unknown,
    ctx: NativeConnectorContext,
  ) => {
    const parsed = cursorInput.safeParse(raw);
    if (!parsed.success) refuse('query_sync_cursor', parsed.error);
    return await store.querySyncCursor({
      organizationId: ctx.organizationId,
      connectorSlug: parsed.data.connectorSlug,
      direction: parsed.data.direction,
    });
  };

  const sync_mailbox: NativeConnectorImpl = async (
    raw: unknown,
    ctx: NativeConnectorContext,
  ) => {
    const parsed = syncInput.safeParse(raw);
    if (!parsed.success) refuse('sync_mailbox', parsed.error);
    const mailbox = parsed.data.mailbox?.trim() ?? '';
    return await store.syncMailbox({
      organizationId: ctx.organizationId,
      connectorSlug: parsed.data.connectorSlug,
      limit: parsed.data.limit ?? MAILBOX_PASS_LIMIT,
      // Every provider: a thread holds what the mailbox sent from anywhere,
      // and an email sent from the Inbox is stored once (`CONV-R6`).
      includeSent: parsed.data.includeSent ?? true,
      backfillDays: parsed.data.backfillDays ?? FIRST_PASS_BACKFILL_DAYS,
      ...(mailbox !== '' && { mailbox }),
      // The dispatcher only invokes natives in live mode; the mock path runs
      // the connector.yml mock and never reaches here.
      mode: 'live',
    });
  };

  const list_mailbox_messages: NativeConnectorImpl = async (
    raw: unknown,
    ctx: NativeConnectorContext,
  ) => {
    const parsed = listMailboxInput.safeParse(raw);
    if (!parsed.success) refuse('list_mailbox_messages', parsed.error);
    return await store.listMailboxMessages({
      organizationId: ctx.organizationId,
      connectorSlug: parsed.data.connectorSlug,
      limit: parsed.data.limit ?? 25,
      mode: 'live',
    });
  };

  const list_untriaged: NativeConnectorImpl = async (
    raw: unknown,
    ctx: NativeConnectorContext,
  ) => {
    const parsed = listUntriagedInput.safeParse(raw);
    if (!parsed.success) refuse('list_untriaged', parsed.error);
    return await store.listUntriagedConversations({
      organizationId: ctx.organizationId,
      connectorSlug: parsed.data.connectorSlug,
      limit: parsed.data.limit ?? 25,
    });
  };

  const record_triage: NativeConnectorImpl = async (
    raw: unknown,
    ctx: NativeConnectorContext,
  ) => {
    const parsed = recordTriageInput.safeParse(raw);
    if (!parsed.success) refuse('record_triage', parsed.error);
    return await store.recordTriage({
      organizationId: ctx.organizationId,
      verdicts: parsed.data.verdicts,
      // The stamp names the run that judged, when a workflow is the caller.
      ...(ctx.caller?.kind === 'workflow' ? { runId: ctx.caller.runId } : {}),
    });
  };

  const draft_reply: NativeConnectorImpl = async (
    raw: unknown,
    ctx: NativeConnectorContext,
  ) => {
    const parsed = draftReplyInput.safeParse(raw);
    if (!parsed.success) refuse('draft_reply', parsed.error);
    const { conversationId, body, guidelineVersion, confidence } = parsed.data;
    return await store.draftReply({
      organizationId: ctx.organizationId,
      conversationId,
      body,
      ...(guidelineVersion !== undefined && { guidelineVersion }),
      ...(confidence !== undefined && { confidence }),
    });
  };

  return {
    'conversation.draft_reply': draft_reply,
    'conversation.ingest_emails': ingest_emails,
    'conversation.ingest_sent_emails': ingest_sent_emails,
    'conversation.query_sync_cursor': query_sync_cursor,
    'conversation.sync_mailbox': sync_mailbox,
    'conversation.list_mailbox_messages': list_mailbox_messages,
    'conversation.list_untriaged': list_untriaged,
    'conversation.record_triage': record_triage,
  };
}
