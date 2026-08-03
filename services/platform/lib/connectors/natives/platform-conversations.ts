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
    emails: z.union([z.array(emailSchema), z.unknown()]),
    connectorSlug: z.string().min(1),
    accountEmail: z.string().optional(),
    status: z.enum(['open', 'closed', 'archived', 'spam']).optional(),
  })
  .strict();

const syncInput = z
  .object({
    connectorSlug: z.string().min(1),
    limit: z.number().int().positive().max(100).optional(),
    /** When true, also sync the IMAP Sent folder into threads. */
    includeSent: z.boolean().optional(),
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

export interface ConversationSyncResult {
  inbound: ConversationIngestResult;
  sent?: ConversationIngestResult;
  listed: number;
}

export interface ConversationSyncCursor {
  since: number | null;
  messageId: string | null;
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
  }): Promise<ConversationSyncResult>;
}

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
    return await store.syncMailbox({
      organizationId: ctx.organizationId,
      connectorSlug: parsed.data.connectorSlug,
      limit: parsed.data.limit ?? 25,
      includeSent:
        parsed.data.includeSent ?? parsed.data.connectorSlug === 'imap-smtp',
      // The dispatcher only invokes natives in live mode; the mock path runs
      // the connector.yml mock and never reaches here.
      mode: 'live',
    });
  };

  return {
    'conversation.ingest_emails': ingest_emails,
    'conversation.ingest_sent_emails': ingest_sent_emails,
    'conversation.query_sync_cursor': query_sync_cursor,
    'conversation.sync_mailbox': sync_mailbox,
  };
}
