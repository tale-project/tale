import type { Sql, TransactionSql } from 'postgres';

import { ConnectorError } from '../../../lib/connectors/errors.ts';
import { nextConversationLastMessageAt } from '../../../lib/shared/conversations/message-order.ts';
import { isRecord } from '../../../lib/utils/type-utils.ts';
import { validateConversationAttachmentCaps } from '../../core/conversations/attachments.ts';
import { buildThreadingHeaders } from '../../core/conversations/build_threading_headers.ts';
import { sendConnectorAction } from '../../core/conversations/connector_slug.ts';
import { normalizeEmail } from '../../core/conversations/ingest/normalize_email.ts';
import { normalizeExternalMessageId } from '../../core/conversations/ingest/normalize_external_message_id.ts';
import { inboundRecipientAddress } from '../../core/conversations/reply_from.ts';
import {
  BULK_REPLY_CAP,
  buildReplySubject,
  splitHtmlText,
} from '../../core/conversations/reply_to_conversation.ts';
import {
  buildSendInput,
  externalIdFromSendOutput,
} from '../../core/conversations/send_input.ts';
import { toJson } from '../../db/sql.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import type { TaskPayloads } from '../../jobs/tasks.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { runConnectorAction } from '../connectors/service.ts';
import { getFileUrl } from '../files/service.ts';
import {
  assertAssignableMember,
  CONVERSATION_COLUMNS,
  ConversationError,
  createConversation,
  MESSAGE_COLUMNS,
  viewerIsAdmin,
  type BulkOperationResult,
  type ConversationMessageRow,
  type ConversationRow,
} from './service.ts';

/**
 * The outbound send surface — the 0.5 twin of the 0.4 send lane
 * (`send_message_via_connector` / `reply_to_conversation` /
 * `compose_email_conversation` / `undo_send_message` / `retry_send_message`
 * / `discard_outbound_message`), with the PURE pieces reused verbatim
 * (attachment caps, threading headers, reply-from resolution, Re:-prefix,
 * html/text split, external-id normalization).
 *
 * The undo window: every send funnels through
 * {@link sendMessageViaConnector}, which inserts a `queued` row and
 * schedules `conversation.send_message` one undo window in the future.
 * {@link undoSendMessage} deletes the still-queued row; the job CLAIMS the
 * row before sending (a conditional update stamping `metadata.sendClaimedAt`
 * — a fired job after an undo finds nothing to claim and is a no-op, and an
 * undo after the claim is refused), so the window closes at exactly one
 * instant for both sides (stronger than the 0.4 scheduler-cancel — safe under
 * at-least-once delivery).
 */

/** The undo window (0.4 parity: 10s). Read at call time so the integration
 * harness can shorten it via CONVERSATION_UNDO_SEND_DELAY_MS. */
export function undoSendDelayMs(): number {
  return Number(process.env.CONVERSATION_UNDO_SEND_DELAY_MS ?? '') || 10_000;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => {
    return typeof item === 'string';
  });
  return strings.length > 0 ? strings : undefined;
}

interface JobAttachment {
  storageRef: string;
  fileName: string;
  contentType: string;
  size: number;
}

/** Rebuild the job's attachment args from the metadata stamped at send. */
function attachmentsFromMetadata(value: unknown): JobAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const attachments: JobAttachment[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const entry: Record<string, unknown> = item;
    if (
      typeof entry.storageId !== 'string' ||
      typeof entry.filename !== 'string' ||
      typeof entry.contentType !== 'string'
    ) {
      continue;
    }
    attachments.push({
      storageRef: entry.storageId,
      fileName: entry.filename,
      contentType: entry.contentType,
      size: typeof entry.size === 'number' ? entry.size : 0,
    });
  }
  return attachments.length > 0 ? attachments : undefined;
}

async function loadMessage(
  db: Sql | TransactionSql,
  messageId: string,
): Promise<ConversationMessageRow | null> {
  const rows = await db<ConversationMessageRow[]>`
    SELECT ${db.unsafe(MESSAGE_COLUMNS)} FROM app.conversation_messages
    WHERE id = ${messageId} LIMIT 1
  `;
  return rows[0] ?? null;
}

/** Walk `lastMessageAt` back to the remaining latest message. */
async function recomputeConversationLastMessageAt(
  tx: TransactionSql,
  conversationId: string,
): Promise<void> {
  const conversations = await tx<
    { metadata: Record<string, unknown> | null; createdAt: number }[]
  >`
    SELECT metadata, created_at_ms::float8 AS "createdAt"
    FROM app.conversations WHERE id = ${conversationId} LIMIT 1
  `;
  const conversation = conversations[0];
  if (!conversation) return;
  const remaining = await tx<
    {
      id: string;
      sentAt: number | null;
      deliveredAt: number | null;
      createdAt: number;
    }[]
  >`
    SELECT id, sent_at_ms::float8 AS "sentAt",
           delivered_at_ms::float8 AS "deliveredAt",
           created_at_ms::float8 AS "createdAt"
    FROM app.conversation_messages
    WHERE conversation_id = ${conversationId}
  `;
  let lastMessageAt: number | undefined;
  for (const row of remaining) {
    lastMessageAt = nextConversationLastMessageAt(lastMessageAt, {
      _id: row.id,
      _creationTime: row.createdAt,
      ...(row.sentAt !== null ? { sentAt: row.sentAt } : {}),
      ...(row.deliveredAt !== null ? { deliveredAt: row.deliveredAt } : {}),
    });
  }
  lastMessageAt ??= conversation.createdAt;
  await tx`
    UPDATE app.conversations SET
      last_message_at_ms = ${lastMessageAt},
      metadata = ${tx.json(
        toJson({
          ...conversation.metadata,
          last_message_at: lastMessageAt,
        }),
      )}
    WHERE id = ${conversationId}
  `;
}

export interface SendAttachment {
  storageId: string;
  fileName: string;
  contentType: string;
  size: number;
}

export interface SendMessageViaConnectorArgs {
  conversationId: string;
  organizationId: string;
  connectorName: string;
  content: string;
  to: string[];
  cc?: string[];
  subject: string;
  html?: string;
  text?: string;
  inReplyTo?: string;
  references?: string[];
  sourceMarkdown?: string;
  attachments?: SendAttachment[];
  actor: { userId: string; email?: string };
}

/**
 * Queue one outbound message and schedule its delivery after the undo
 * window — the single choke point every send path funnels through. The
 * pending approval on the conversation (an agent-drafted reply awaiting a
 * human) completes when the human sends.
 */
export async function sendMessageViaConnector(
  sql: Sql,
  args: SendMessageViaConnectorArgs,
): Promise<string> {
  validateConversationAttachmentCaps(args.attachments);
  return sql.begin((tx) => sendMessageViaConnectorInTx(tx, args));
}

/**
 * The transactional core of {@link sendMessageViaConnector}, for a caller
 * that has other writes to commit WITH the queued message (compose creates
 * the conversation in the same transaction). Runs no cap check of its own —
 * the caller validates before its first write, as compose already did.
 */
export async function sendMessageViaConnectorInTx(
  tx: TransactionSql,
  args: SendMessageViaConnectorArgs,
): Promise<string> {
  const conversations = await tx<ConversationRow[]>`
      SELECT ${tx.unsafe(CONVERSATION_COLUMNS)} FROM app.conversations
      WHERE id = ${args.conversationId} LIMIT 1
    `;
  const conversation = conversations[0];
  if (!conversation) {
    throw new ConversationError(
      'conversation_not_found',
      'Conversation not found',
      404,
    );
  }
  if (conversation.organizationId !== args.organizationId) {
    throw new ConversationError(
      'conversation_org_mismatch',
      'Conversation does not belong to organization',
      403,
    );
  }

  const latest = args.inReplyTo
    ? null
    : (
        await tx<{ externalMessageId: string | null }[]>`
            SELECT external_message_id AS "externalMessageId"
            FROM app.conversation_messages
            WHERE conversation_id = ${args.conversationId}
            ORDER BY delivered_at_ms DESC NULLS LAST, seq DESC
            LIMIT 1
          `
      )[0];
  const { inReplyTo, references } = buildThreadingHeaders({
    ...(args.inReplyTo !== undefined ? { inReplyTo: args.inReplyTo } : {}),
    ...(args.references !== undefined ? { references: args.references } : {}),
    latestMessageExternalId: latest?.externalMessageId ?? undefined,
    conversationExternalMessageId: conversation.externalMessageId ?? undefined,
  });

  const now = Date.now();
  const attachmentsMeta = args.attachments?.length
    ? args.attachments.map((att) => ({
        id: att.storageId,
        filename: att.fileName,
        contentType: att.contentType,
        size: att.size,
        storageId: att.storageId,
      }))
    : undefined;

  const messageMetadata: Record<string, unknown> = {
    sender: 'connector',
    isCustomer: false,
    to: args.to,
    subject: args.subject,
    connectorName: args.connectorName,
    scheduledSendAt: now + undoSendDelayMs(),
    sendContentType: args.html ? 'HTML' : 'Text',
    ...(args.sourceMarkdown ? { sourceMarkdown: args.sourceMarkdown } : {}),
    ...(args.cc ? { cc: args.cc } : {}),
    ...(inReplyTo ? { inReplyTo } : {}),
    ...(references ? { references } : {}),
    ...(attachmentsMeta ? { attachments: attachmentsMeta } : {}),
  };

  const inserted = await tx<{ id: string }[]>`
      INSERT INTO app.conversation_messages (
        org_id, conversation_id, connector_name, channel, direction,
        delivery_state, content, sent_at_ms, delivered_at_ms, metadata,
        created_at_ms, status_changed_at_ms
      ) VALUES (
        ${args.organizationId}, ${args.conversationId},
        ${args.connectorName}, 'email', 'outbound', 'queued',
        ${args.content}, ${now}, ${now},
        ${tx.json(toJson(messageMetadata))}, ${now}, ${now}
      )
      RETURNING id
    `;
  const messageId = inserted[0]?.id;
  if (!messageId) throw new Error('outbound message insert failed');

  const replyFrom = inboundRecipientAddress(conversation.metadata ?? undefined);
  const scheduledSendId = await addJobInTx(
    tx,
    'conversation.send_message',
    {
      organizationId: args.organizationId,
      messageId,
      connectorName: args.connectorName,
      to: args.to,
      ...(args.cc !== undefined ? { cc: args.cc } : {}),
      subject: args.subject,
      body: args.html || args.text || args.content,
      contentType: args.html ? 'HTML' : 'Text',
      ...(inReplyTo !== undefined ? { inReplyTo } : {}),
      ...(references !== undefined ? { references } : {}),
      ...(replyFrom ? { from: replyFrom } : {}),
      ...(args.attachments?.length
        ? {
            attachments: args.attachments.map((att) => ({
              storageRef: att.storageId,
              fileName: att.fileName,
              contentType: att.contentType,
              size: att.size,
            })),
          }
        : {}),
    },
    { startAfter: new Date(now + undoSendDelayMs()) },
  );
  if (scheduledSendId !== null) {
    await tx`
        UPDATE app.conversation_messages SET metadata = ${tx.json(
          toJson({ ...messageMetadata, scheduledSendId }),
        )}
        WHERE id = ${messageId}
      `;
  }

  const lastMessageAt = nextConversationLastMessageAt(
    conversation.lastMessageAt ?? undefined,
    { _id: messageId, _creationTime: now, sentAt: now, deliveredAt: now },
  );
  await tx`
      UPDATE app.conversations SET
        last_message_at_ms = ${lastMessageAt},
        metadata = ${tx.json(
          toJson({
            ...conversation.metadata,
            last_message_at: lastMessageAt,
          }),
        )}
      WHERE id = ${args.conversationId}
    `;

  // A pending approval on the conversation (an agent-drafted reply
  // awaiting a human) completes when the human sends.
  const pending = await tx<
    { id: string; metadata: Record<string, unknown> | null }[]
  >`
      SELECT id, metadata FROM app.approvals
      WHERE resource_type = 'conversations'
        AND resource_id = ${args.conversationId} AND status = 'pending'
      ORDER BY seq ASC LIMIT 1
    `;
  if (pending[0]) {
    await tx`
        UPDATE app.approvals SET
          status = 'completed', approved_by = ${args.actor.userId},
          reviewed_at_ms = ${now},
          metadata = ${tx.json(
            toJson({
              ...pending[0].metadata,
              sentContent: args.content,
              sentTo: args.to,
              sentSubject: args.subject,
              sentAt: now,
              ...(args.html ? { sentHtml: args.html } : {}),
              ...(args.text ? { sentText: args.text } : {}),
              ...(args.cc ? { sentCc: args.cc } : {}),
            }),
          )}
        WHERE id = ${pending[0].id}
      `;
  }

  await createAuditLog(tx, {
    organizationId: args.organizationId,
    actorId: args.actor.userId,
    ...(args.actor.email !== undefined ? { actorEmail: args.actor.email } : {}),
    actorType: 'user',
    action: 'send_message_via_connector',
    category: 'data',
    resourceType: 'conversationMessage',
    resourceId: messageId,
    resourceName: args.subject,
    newState: {
      conversationId: args.conversationId,
      connectorName: args.connectorName,
      to: args.to,
      subject: args.subject,
    },
    status: 'success',
  });
  await emitHintInTx(tx, {
    orgId: args.organizationId,
    entity: 'conversation',
    entityId: args.conversationId,
  });
  return messageId;
}

const UNKNOWN_CONTACT_EMAIL = 'unknown@example.com';

export async function replyToConversation(
  sql: Sql,
  args: {
    conversationId: string;
    organizationId: string;
    content: string;
    sourceMarkdown?: string;
    attachments?: SendAttachment[];
    actor: { userId: string; email?: string };
  },
): Promise<string> {
  const rows = await sql<
    {
      organizationId: string;
      connectorName: string | null;
      subject: string | null;
      contactEmail: string | null;
    }[]
  >`
    SELECT c.org_id AS "organizationId",
           c.connector_name AS "connectorName", c.subject,
           ct.email AS "contactEmail"
    FROM app.conversations c
    LEFT JOIN app.contacts ct ON ct.id = c.contact_id AND ct.org_id = c.org_id
    WHERE c.id = ${args.conversationId} LIMIT 1
  `;
  const row = rows[0];
  if (!row) {
    throw new ConversationError(
      'conversation_not_found',
      'Conversation not found',
      404,
    );
  }
  if (row.organizationId !== args.organizationId) {
    throw new ConversationError(
      'conversation_org_mismatch',
      'Conversation does not belong to organization',
      403,
    );
  }
  if (!row.connectorName) {
    throw new ConversationError(
      'conversation_connector_missing',
      'Conversation has no connector to reply through — reply is unavailable until a sync stamps its connectorName',
      409,
    );
  }
  if (!row.contactEmail || row.contactEmail === UNKNOWN_CONTACT_EMAIL) {
    throw new ConversationError(
      'customer_email_not_found',
      'Conversation has no contact email to reply to',
      409,
    );
  }
  const subject = buildReplySubject(row.subject ?? undefined);
  const { html, text } = splitHtmlText(args.content);
  return sendMessageViaConnector(sql, {
    conversationId: args.conversationId,
    organizationId: args.organizationId,
    connectorName: row.connectorName,
    content: args.content,
    to: [row.contactEmail],
    subject,
    html,
    text,
    ...(args.sourceMarkdown ? { sourceMarkdown: args.sourceMarkdown } : {}),
    ...(args.attachments?.length ? { attachments: args.attachments } : {}),
    actor: args.actor,
  });
}

/**
 * Reply to many conversations with one body — the 0.4 partial-failure
 * contract: sequential, a per-conversation failure is recorded and the rest
 * still go out (every throw in {@link replyToConversation} happens before
 * its first write).
 */
export async function bulkReplyToConversations(
  sql: Sql,
  args: {
    conversationIds: string[];
    organizationId: string;
    content: string;
    actor: { userId: string; email?: string };
  },
): Promise<BulkOperationResult> {
  if (args.conversationIds.length > BULK_REPLY_CAP) {
    throw new ConversationError(
      'bulk_reply_too_many',
      `Cannot reply to more than ${BULK_REPLY_CAP} conversations at once`,
    );
  }
  let successCount = 0;
  const errors: string[] = [];
  for (const conversationId of args.conversationIds) {
    try {
      await replyToConversation(sql, {
        conversationId,
        organizationId: args.organizationId,
        content: args.content,
        actor: args.actor,
      });
      successCount++;
    } catch (error) {
      errors.push(
        `Failed to reply to ${conversationId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
  return {
    successCount,
    failedCount: args.conversationIds.length - successCount,
    errors,
  };
}

/**
 * Resolve who owns a newly composed outbound conversation.
 *
 * Defaults to the creator; only an admin may pick another member or a team
 * queue. Non-admin team requests are dropped (not rejected). A picked person
 * must be an active org member (`user_not_in_org` otherwise — the shared
 * assignee gate) and a team must belong to the org or we throw
 * `team_not_in_org`.
 */
export async function resolveComposeAssignment(
  sql: Sql,
  args: {
    organizationId: string;
    assigneeUserId?: string;
    assigneeTeamId?: string;
    actor: { userId: string; role: string };
  },
): Promise<{ assigneeUserId: string; assigneeTeamId?: string }> {
  const isAdmin = viewerIsAdmin(args.actor.role);
  const assigneeUserId = isAdmin
    ? (args.assigneeUserId ?? args.actor.userId)
    : args.actor.userId;
  // The actor is a member by construction (the org middleware); anyone else
  // an admin picks passes the same gate the assign door and routing apply.
  if (assigneeUserId !== args.actor.userId) {
    await assertAssignableMember(sql, args.organizationId, assigneeUserId);
  }
  if (!(isAdmin && args.assigneeTeamId)) {
    return { assigneeUserId };
  }
  const teams = await sql<{ organizationId: string }[]>`
    SELECT "organizationId" FROM "team" WHERE "id" = ${args.assigneeTeamId}
    LIMIT 1
  `;
  if (teams[0]?.organizationId !== args.organizationId) {
    throw new ConversationError(
      'team_not_in_org',
      'Team does not belong to this organization',
    );
  }
  return { assigneeUserId, assigneeTeamId: args.assigneeTeamId };
}

export async function composeEmailConversation(
  sql: Sql,
  args: {
    organizationId: string;
    contactId: string;
    assigneeUserId?: string;
    /** Team queue. Admin-only; validated in-org. Non-admin requests are dropped. */
    assigneeTeamId?: string;
    connectorName: string;
    subject: string;
    content: string;
    sourceMarkdown?: string;
    from?: string;
    attachments?: SendAttachment[];
    actor: { userId: string; email?: string; role: string };
  },
): Promise<{ conversationId: string; messageId: string }> {
  const subject = args.subject.trim();
  if (!subject) {
    throw new ConversationError(
      'compose_subject_required',
      'A subject is required to start an email',
    );
  }
  const contacts = await sql<
    { organizationId: string; email: string | null }[]
  >`
    SELECT org_id AS "organizationId", email FROM app.contacts
    WHERE id = ${args.contactId} LIMIT 1
  `;
  const contact = contacts[0];
  if (!contact) {
    throw new ConversationError('contact_not_found', 'Contact not found', 404);
  }
  if (contact.organizationId !== args.organizationId) {
    throw new ConversationError(
      'contact_org_mismatch',
      'Contact does not belong to organization',
      403,
    );
  }
  if (!contact.email || contact.email === UNKNOWN_CONTACT_EMAIL) {
    throw new ConversationError(
      'contact_email_not_found',
      'Contact has no email address to send to',
      409,
    );
  }
  const contactEmail = contact.email;
  // Refuse over-cap attachments BEFORE creating the conversation — the 0.4
  // compose is one atomic mutation, so a cap denial must leave nothing.
  validateConversationAttachmentCaps(args.attachments);

  const { assigneeUserId, assigneeTeamId } = await resolveComposeAssignment(
    sql,
    {
      organizationId: args.organizationId,
      actor: args.actor,
      ...(args.assigneeUserId !== undefined
        ? { assigneeUserId: args.assigneeUserId }
        : {}),
      ...(args.assigneeTeamId !== undefined
        ? { assigneeTeamId: args.assigneeTeamId }
        : {}),
    },
  );

  const chosenFrom = args.from?.trim();
  const { html, text } = splitHtmlText(args.content);
  // ONE transaction for the conversation and its first message: a failed
  // enqueue (pg-boss down) or message insert must roll the conversation back
  // too, or the composer is left with an outbound thread that has no message,
  // no failed bubble to retry or discard, and only delete as a way out.
  return sql.begin(async (tx) => {
    const conversationId = await createConversation(tx, {
      organizationId: args.organizationId,
      contactId: args.contactId,
      assigneeUserId,
      ...(assigneeTeamId !== undefined ? { assigneeTeamId } : {}),
      subject,
      status: 'open',
      channel: 'email',
      direction: 'outbound',
      connectorName: args.connectorName,
      ...(chosenFrom ? { metadata: { to: [{ address: chosenFrom }] } } : {}),
    });
    const messageId = await sendMessageViaConnectorInTx(tx, {
      conversationId,
      organizationId: args.organizationId,
      connectorName: args.connectorName,
      content: args.content,
      to: [contactEmail],
      subject,
      html,
      text,
      ...(args.sourceMarkdown ? { sourceMarkdown: args.sourceMarkdown } : {}),
      ...(args.attachments?.length ? { attachments: args.attachments } : {}),
      actor: args.actor,
    });
    return { conversationId, messageId };
  });
}

/** Cancel a still-queued send: delete the row (the email never existed) and
 * hand the composer draft back. The scheduled job no-ops on the gone row. */
export async function undoSendMessage(
  sql: Sql,
  args: {
    organizationId: string;
    messageId: string;
    actor: { userId: string; email?: string };
  },
): Promise<{ sourceMarkdown: string | null }> {
  return sql.begin(async (tx) => {
    const message = await loadMessage(tx, args.messageId);
    if (!message || message.organizationId !== args.organizationId) {
      throw new ConversationError(
        'message_not_found',
        'Message not found',
        404,
      );
    }
    if (
      message.direction !== 'outbound' ||
      message.deliveryState !== 'queued'
    ) {
      throw new ConversationError(
        'undo_window_closed',
        'The message has already been sent',
        409,
      );
    }
    const metadata = message.metadata ?? {};
    // The send job claimed the row: the connector call is in flight (or
    // finished and about to settle). Deleting now would let the mail leave
    // while the org loses its record of it — refuse, exactly like a settled
    // send. A claimed row whose worker died is failed by the watchdog and
    // becomes discardable there.
    if (typeof metadata.sendClaimedAt === 'number') {
      throw new ConversationError(
        'undo_window_closed',
        'The message is being sent',
        409,
      );
    }
    await tx`
      DELETE FROM app.conversation_messages WHERE id = ${args.messageId}
    `;
    await recomputeConversationLastMessageAt(tx, message.conversationId);
    await emitHintInTx(tx, {
      orgId: args.organizationId,
      entity: 'conversation',
      entityId: message.conversationId,
    });
    await createAuditLog(tx, {
      organizationId: args.organizationId,
      actorId: args.actor.userId,
      ...(args.actor.email !== undefined
        ? { actorEmail: args.actor.email }
        : {}),
      actorType: 'user',
      action: 'undo_send_message',
      category: 'data',
      resourceType: 'conversationMessage',
      resourceId: args.messageId,
      ...(typeof metadata.subject === 'string'
        ? { resourceName: metadata.subject }
        : {}),
      newState: { conversationId: message.conversationId },
      status: 'success',
    });
    const sourceMarkdown = metadata.sourceMarkdown;
    return {
      sourceMarkdown:
        typeof sourceMarkdown === 'string' ? sourceMarkdown : null,
    };
  });
}

/** Re-attempt a failed send: rebuild the job args from the stored row, flip
 * back to `queued`, and schedule immediately (no undo window on a retry). */
export async function retrySendMessage(
  sql: Sql,
  args: {
    organizationId: string;
    messageId: string;
    actor: { userId: string; email?: string };
  },
): Promise<void> {
  await sql.begin(async (tx) => {
    const message = await loadMessage(tx, args.messageId);
    if (!message || message.organizationId !== args.organizationId) {
      throw new ConversationError(
        'message_not_found',
        'Message not found',
        404,
      );
    }
    if (
      message.direction !== 'outbound' ||
      message.deliveryState !== 'failed'
    ) {
      throw new ConversationError(
        'retry_not_available',
        'Only a failed outbound message can be retried',
        409,
      );
    }
    const metadata = message.metadata ?? {};
    const to = asStringArray(metadata.to);
    const connectorName =
      message.connectorName ??
      (typeof metadata.connectorName === 'string'
        ? metadata.connectorName
        : undefined);
    if (!to || !connectorName) {
      // Rows written before the composer stamped its send args can't be
      // rebuilt.
      throw new ConversationError(
        'retry_not_available',
        'This message is missing its original send parameters',
        409,
      );
    }
    const subject =
      typeof metadata.subject === 'string' ? metadata.subject : '';
    const conversations = await tx<
      { metadata: Record<string, unknown> | null }[]
    >`
      SELECT metadata FROM app.conversations
      WHERE id = ${message.conversationId} LIMIT 1
    `;
    const replyFrom = inboundRecipientAddress(
      conversations[0]?.metadata ?? undefined,
    );
    // Clear the failure and the stale undo stamps: a retry is immediate, so
    // there is no scheduled window to count down or cancel. The previous
    // attempt's claim goes too, or the retried job could never claim the row.
    const retainedMetadata = { ...metadata };
    delete retainedMetadata.error;
    delete retainedMetadata.errorCode;
    delete retainedMetadata.scheduledSendId;
    delete retainedMetadata.scheduledSendAt;
    delete retainedMetadata.sendClaimedAt;
    const retryCount = (message.retryCount ?? 0) + 1;
    await tx`
      UPDATE app.conversation_messages SET
        delivery_state = 'queued', retry_count = ${retryCount},
        status_changed_at_ms = ${Date.now()},
        metadata = ${tx.json(toJson(retainedMetadata))}
      WHERE id = ${args.messageId}
    `;
    const cc = asStringArray(metadata.cc);
    const references = asStringArray(metadata.references);
    const attachments = attachmentsFromMetadata(metadata.attachments);
    await addJobInTx(tx, 'conversation.send_message', {
      organizationId: args.organizationId,
      messageId: args.messageId,
      connectorName,
      to,
      ...(cc ? { cc } : {}),
      subject,
      body: message.content,
      contentType:
        typeof metadata.sendContentType === 'string'
          ? metadata.sendContentType
          : 'HTML',
      ...(typeof metadata.inReplyTo === 'string'
        ? { inReplyTo: metadata.inReplyTo }
        : {}),
      ...(references ? { references } : {}),
      ...(replyFrom ? { from: replyFrom } : {}),
      ...(attachments ? { attachments } : {}),
    });
    await emitHintInTx(tx, {
      orgId: args.organizationId,
      entity: 'conversation',
      entityId: message.conversationId,
    });
    await createAuditLog(tx, {
      organizationId: args.organizationId,
      actorId: args.actor.userId,
      ...(args.actor.email !== undefined
        ? { actorEmail: args.actor.email }
        : {}),
      actorType: 'user',
      action: 'retry_send_message',
      category: 'data',
      resourceType: 'conversationMessage',
      resourceId: args.messageId,
      ...(subject ? { resourceName: subject } : {}),
      newState: {
        conversationId: message.conversationId,
        connectorName,
        to,
        retryCount,
      },
      status: 'success',
    });
  });
}

/** Remove a failed outbound bubble — the email never left. */
export async function discardOutboundMessage(
  sql: Sql,
  args: {
    organizationId: string;
    messageId: string;
    actor: { userId: string; email?: string };
  },
): Promise<void> {
  await sql.begin(async (tx) => {
    const message = await loadMessage(tx, args.messageId);
    if (!message || message.organizationId !== args.organizationId) {
      throw new ConversationError(
        'message_not_found',
        'Message not found',
        404,
      );
    }
    if (
      message.direction !== 'outbound' ||
      message.deliveryState !== 'failed'
    ) {
      throw new ConversationError(
        'discard_not_available',
        'Only a failed outbound message can be discarded',
        409,
      );
    }
    const metadata = message.metadata ?? {};
    await tx`
      DELETE FROM app.conversation_messages WHERE id = ${args.messageId}
    `;
    await recomputeConversationLastMessageAt(tx, message.conversationId);
    await emitHintInTx(tx, {
      orgId: args.organizationId,
      entity: 'conversation',
      entityId: message.conversationId,
    });
    await createAuditLog(tx, {
      organizationId: args.organizationId,
      actorId: args.actor.userId,
      ...(args.actor.email !== undefined
        ? { actorEmail: args.actor.email }
        : {}),
      actorType: 'user',
      action: 'discard_outbound_message',
      category: 'data',
      resourceType: 'conversationMessage',
      resourceId: args.messageId,
      ...(typeof metadata.subject === 'string'
        ? { resourceName: metadata.subject }
        : {}),
      newState: { conversationId: message.conversationId },
      status: 'success',
    });
  });
}

/** The `{ message }` / `{ email }` wrapper a mail get_message answers with. */
function unwrapConnectorMessage(output: unknown): unknown {
  if (!isRecord(output)) return output;
  if ('message' in output) return output.message;
  if ('email' in output) return output.email;
  return output;
}

/**
 * The external id to stamp on the sent row so a customer's reply threads back
 * onto this conversation.
 *
 * Threading keys on the RFC Message-ID (an inbound reply's In-Reply-To carries
 * it), but Gmail's send returns only its OWN API id. Storing that makes the
 * reply's lookup miss AND makes buildThreadingHeaders later emit the API id as
 * an invalid outgoing In-Reply-To on the next reply. So for Gmail we read the
 * sent message back once to recover its RFC Message-ID. Best-effort: the send
 * already succeeded, so a failed read-back keeps the API id rather than failing
 * a message that was delivered. Outlook (Graph sendMail returns no id) relies on
 * the Sent-folder sync; imap-smtp already returns the RFC id.
 */
export async function resolveSentExternalMessageId(
  sql: Sql,
  args: {
    organizationId: string;
    connector: string;
    connectorName: string;
    output: unknown;
  },
): Promise<string | undefined> {
  const fallback = externalIdFromSendOutput(args.connectorName, args.output);
  if (args.connector !== 'gmail') return fallback;
  const apiId =
    isRecord(args.output) && typeof args.output.id === 'string'
      ? args.output.id
      : undefined;
  if (apiId === undefined) return fallback;
  try {
    const fetched = await runConnectorAction(sql, {
      organizationId: args.organizationId,
      connector: 'gmail',
      action: 'get_message',
      input: { messageId: apiId },
      mode: 'live',
      caller: { kind: 'system', reason: 'conversation reply Message-ID' },
    });
    if (fetched.status !== 'ok') return fallback;
    const rfc = normalizeExternalMessageId(
      normalizeEmail(unwrapConnectorMessage(fetched.output)).messageId,
    );
    return rfc ?? fallback;
  } catch (error) {
    console.warn(
      `[conversation-send] gmail Message-ID read-back failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return fallback;
  }
}

/**
 * The scheduled delivery — the 0.4 `sendMessageViaConnectorAction` twin:
 * CLAIMS the still-queued row (an undo deleted it; a claimed row is refused
 * to undo), runs the send through the connector door as the audited system
 * caller, and settles the row `sent` (with the provider's Message-ID) or
 * `failed` (with the error the retry surface shows).
 */
export async function runSendMessageJob(
  sql: Sql,
  payload: TaskPayloads['conversation.send_message'],
): Promise<void> {
  // One conditional update is the whole race: a row that is queued, in this
  // org and unclaimed becomes ours; anything else — undone (gone), already
  // sent, failed, or claimed by a duplicate delivery — is nothing to deliver.
  // A plain read-then-check left the seconds of the connector call open to
  // an undo that deleted the row under a mail already leaving.
  const claimedAt = Date.now();
  const claimed = await sql<ConversationMessageRow[]>`
    UPDATE app.conversation_messages SET
      status_changed_at_ms = ${claimedAt},
      metadata = coalesce(metadata, '{}'::jsonb)
        || ${sql.json(toJson({ sendClaimedAt: claimedAt }))}
    WHERE id = ${payload.messageId} AND org_id = ${payload.organizationId}
      AND direction = 'outbound' AND delivery_state = 'queued'
      AND metadata->>'sendClaimedAt' IS NULL
    RETURNING ${sql.unsafe(MESSAGE_COLUMNS)}
  `;
  const message = claimed[0];
  if (!message) return;
  try {
    const { connector, action } = sendConnectorAction(payload.connectorName);
    // Presign a GET per attachment at send time — for EVERY mail connector,
    // imap-smtp included: its native now streams each part from the URL, so a
    // reply carries the files the sender attached instead of dropping them.
    const attachmentPayloads = !payload.attachments?.length
      ? []
      : await Promise.all(
          payload.attachments.map(async (att) => ({
            name: att.fileName,
            contentType: att.contentType,
            size: att.size,
            url: await getFileUrl(
              sql,
              { organizationId: payload.organizationId },
              att.storageRef,
            ),
          })),
        );
    const input = buildSendInput({
      connectorName: payload.connectorName,
      to: payload.to,
      ...(payload.cc !== undefined ? { cc: payload.cc } : {}),
      subject: payload.subject,
      body: payload.body,
      ...(payload.contentType !== undefined
        ? { contentType: payload.contentType }
        : {}),
      ...(payload.inReplyTo !== undefined
        ? { inReplyTo: payload.inReplyTo }
        : {}),
      ...(payload.references !== undefined
        ? { references: payload.references }
        : {}),
      attachments: attachmentPayloads,
    });
    // `payload.from` is carried for parity but not injected into the input —
    // the 0.4 action accepts it and likewise never forwards it (the domain-
    // validated From lane was never built; the connector's configured From
    // applies).
    const result = await runConnectorAction(sql, {
      organizationId: payload.organizationId,
      connector,
      action,
      input,
      mode: 'live',
      caller: { kind: 'system', reason: 'conversation email reply' },
    });
    if (result.status !== 'ok') {
      throw new Error(result.message);
    }
    const externalMessageId = await resolveSentExternalMessageId(sql, {
      organizationId: payload.organizationId,
      connector,
      connectorName: payload.connectorName,
      output: result.output,
    });
    const now = Date.now();
    const settled = await sql<{ id: string }[]>`
      UPDATE app.conversation_messages SET
        delivery_state = 'sent', sent_at_ms = ${now},
        status_changed_at_ms = ${now},
        external_message_id = ${externalMessageId ?? sql.unsafe('external_message_id')}
      WHERE id = ${payload.messageId}
      RETURNING id
    `;
    if (settled.length === 0) {
      // The mail left; the row did not survive to record it (the conversation
      // was deleted under the send). Loud, because the Sent-folder sync will
      // later re-create the message as a surprise.
      console.warn(
        `[conversation-send] ${payload.messageId} was delivered but its row is gone — nothing recorded the send`,
      );
    }
    await emitHintInTx(sql, {
      orgId: payload.organizationId,
      entity: 'conversation',
      entityId: message.conversationId,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(
      `[conversation-send] delivery failed for ${payload.messageId}: ${reason}`,
    );
    await sql`
      UPDATE app.conversation_messages SET
        delivery_state = 'failed', status_changed_at_ms = ${Date.now()},
        metadata = coalesce(metadata, '{}'::jsonb)
          || ${sql.json(
            toJson({
              error: reason,
              ...(error instanceof ConnectorError
                ? { errorCode: error.code }
                : {}),
            }),
          )}
      WHERE id = ${payload.messageId}
    `;
    await emitHintInTx(sql, {
      orgId: payload.organizationId,
      entity: 'conversation',
      entityId: message.conversationId,
    });
  }
}

/** A send left 'queued' this long past its last state change lost its job:
 * the undo window is seconds and the send job's own expiry is 600s, so a row
 * still queued well past both was never settled by a live handler. Generous,
 * so a slow-but-live connector send is never failed out from under itself. */
const SEND_STALE_MS = 20 * 60 * 1000;
const SEND_WATCHDOG_ERROR =
  'the message could not be delivered — the send was interrupted before it completed';

/**
 * Crash-recovery watchdog for outbound conversation sends (the job-liveness
 * class): `conversation.send_message` has retryLimit 0, so a worker killed
 * mid-send, or a job expired past its 600s window, leaves the message row
 * `delivery_state='queued'` with no job behind it — an eternal "sending"
 * clock, and the retry/discard controls only appear on `failed`.
 *
 * Flip stale queued rows to `failed` with a reason so the existing retry
 * surface lights up (`retrySendMessage` re-queues from the stored args). The
 * window is far past the send job's own expiry, so a live-but-slow handler is
 * never failed under itself; and were one to finish afterwards it settles the
 * row `sent`, correcting the bubble.
 */
export async function recoverStuckConversationSends(
  sql: Sql,
  options: { staleMs?: number } = {},
): Promise<{ failed: number }> {
  const now = Date.now();
  const cutoff = now - (options.staleMs ?? SEND_STALE_MS);
  const failed = await sql<
    { id: string; conversationId: string; orgId: string }[]
  >`
    UPDATE app.conversation_messages SET
      delivery_state = 'failed', status_changed_at_ms = ${now},
      metadata = coalesce(metadata, '{}'::jsonb) || ${sql.json(
        toJson({ error: SEND_WATCHDOG_ERROR, errorCode: 'send_interrupted' }),
      )}
    WHERE direction = 'outbound' AND delivery_state = 'queued'
      AND coalesce(status_changed_at_ms, created_at_ms) < ${cutoff}
    RETURNING id, conversation_id AS "conversationId", org_id AS "orgId"
  `;
  for (const row of failed) {
    await emitHintInTx(sql, {
      orgId: row.orgId,
      entity: 'conversation',
      entityId: row.conversationId,
    });
  }
  if (failed.length > 0) {
    console.warn(
      `[conversation-send-watchdog] failed ${failed.length} stranded queued send(s)`,
    );
  }
  return { failed: failed.length };
}
