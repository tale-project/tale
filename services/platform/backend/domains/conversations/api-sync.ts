import { createHash, randomUUID } from 'node:crypto';

import { transactSerializable } from '@tale/shared/db/serializable';
import { micromark } from 'micromark';
import type { Sql, TransactionSql } from 'postgres';
import { z } from 'zod';

import {
  apiAttachmentSchema,
  apiDeliveryFailureSchema,
  type ApiDeliveryStatus,
  replyConstraintsSchema,
  type ApiSnapshot,
} from '../../../lib/shared/conversations/api-sync.ts';
import { toJson } from '../../db/sql.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { statOrgBlob } from '../files/service.ts';
import { firstForeignUpload } from '../files/upload-intents.ts';
import {
  addMessageToConversation,
  ConversationError,
  createConversation,
  viewerCanWrite,
  type ConversationViewer,
} from './service.ts';

export {
  apiSnapshotSchema,
  apiSourceSchema,
} from '../../../lib/shared/conversations/api-sync.ts';

interface Binding {
  conversationId: string;
  ownerUserId: string;
  externalContactId: string;
  version: string;
  hash: string | null;
  /** Whether the source already tore this conversation down. */
  sourceDeleted: boolean;
}

/**
 * A body-referenced attachment must have landed in the org's blob store
 * at the declared size. Two different mistakes, two different fixes: the
 * upload never happened (or its window lapsed — upload it again), or the
 * bytes disagree with the declared size (fix the size, or re-upload).
 * One message used to cover both.
 */
function assertAttachmentLanded(
  landed: { size: number } | null,
  declaredSize: number,
): asserts landed is { size: number } {
  if (!landed)
    throw new ConversationError(
      'ATTACHMENT_NOT_STAGED',
      'Attachment was never uploaded, or its upload window lapsed — upload it again',
      400,
    );
  if (landed.size !== declaredSize)
    throw new ConversationError(
      'ATTACHMENT_SIZE_MISMATCH',
      `Attachment bytes (${landed.size}) do not match the declared size (${declaredSize})`,
      400,
    );
}

function requireWriter(viewer: ConversationViewer): void {
  if (!viewerCanWrite(viewer.role)) {
    throw new ConversationError(
      'ROLE_FORBIDDEN',
      'Only editors and above may synchronize conversations',
      403,
    );
  }
}

function attachmentMetadata(
  attachments: z.infer<typeof apiAttachmentSchema>[],
) {
  return attachments.map((attachment) => ({
    id: attachment.externalId ?? attachment.storageId,
    storageId: attachment.storageId,
    filename: attachment.fileName,
    contentType: attachment.contentType,
    size: attachment.size,
  }));
}

function messageHtml(content: string, format: 'plain' | 'markdown'): string {
  if (format === 'markdown') return micromark(content);
  return `<pre>${content.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</pre>`;
}

async function hint(
  tx: TransactionSql,
  organizationId: string,
  conversationId: string,
) {
  await emitHintInTx(tx, {
    orgId: organizationId,
    entity: 'conversation',
    entityId: conversationId,
  });
}

/** A complete bounded source snapshot; source receipts fence its writes. */
export async function synchronizeConversation(
  sql: Sql,
  viewer: ConversationViewer,
  input: ApiSnapshot,
) {
  requireWriter(viewer);
  const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  // Object-store reads stay outside the retried transaction. Previously
  // receipted immutable refs already carry their verified size, so a source
  // edit need not HEAD every old attachment again.
  const knownRows = await sql<{ metadata: unknown }[]>`
    SELECT m.metadata FROM app.conversation_api_bindings b
    JOIN app.conversation_api_messages r ON r.conversation_id = b.conversation_id
    JOIN app.conversation_messages m ON m.id = r.message_id AND m.org_id = b.org_id
    WHERE b.org_id = ${viewer.organizationId} AND b.source = ${input.source}
      AND b.external_id = ${input.externalId} AND b.owner_user_id = ${viewer.userId}
  `;
  const known = new Map<string, number>();
  for (const row of knownRows) {
    const parsed = z
      .object({
        attachments: z
          .array(z.object({ storageId: z.string(), size: z.number() }))
          .optional(),
      })
      .safeParse(row.metadata);
    if (parsed.success)
      for (const file of parsed.data.attachments ?? [])
        known.set(file.storageId, file.size);
  }
  for (const file of input.messages.flatMap((message) => message.attachments)) {
    if (known.get(file.storageId) === file.size) continue;
    const landed = await statOrgBlob(
      sql,
      viewer.organizationId,
      file.storageId,
    );
    assertAttachmentLanded(landed, file.size);
    known.set(file.storageId, landed.size);
  }
  return transactSerializable(sql, async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`conversation-api:${viewer.organizationId}:${input.source}:${input.externalId}`}, 0))`;
    const bindings = await tx<Binding[]>`
      SELECT conversation_id AS "conversationId", owner_user_id AS "ownerUserId",
             external_contact_id AS "externalContactId",
             snapshot_version::text AS version, snapshot_hash AS hash,
             source_deleted AS "sourceDeleted"
      FROM app.conversation_api_bindings
      WHERE org_id = ${viewer.organizationId} AND source = ${input.source} AND external_id = ${input.externalId}
      FOR UPDATE
    `;
    let binding = bindings[0];
    if (binding && binding.ownerUserId !== viewer.userId) {
      throw new ConversationError(
        'INTEGRATION_NOT_OWNED',
        'This integration belongs to another service user',
        403,
      );
    }
    if (binding && binding.externalContactId !== input.externalContactId)
      throw new ConversationError(
        'CONVERSATION_CONTACT_CONFLICT',
        'The source conversation belongs to another contact',
        409,
      );
    if (binding && Number(binding.version) > input.version)
      return { conversationId: binding.conversationId, applied: false };
    // A teardown is not content: `deleted: true` applies at any version
    // from the stored one up (a source whose versions ran out — the
    // documented maximum included — can still close its mirror), and
    // replays as a no-op once the source is already torn down. Only a
    // content snapshot at the stored version is held to the stored hash.
    if (binding && input.deleted && binding.sourceDeleted)
      return { conversationId: binding.conversationId, applied: false };
    if (
      binding &&
      Number(binding.version) === input.version &&
      !input.deleted
    ) {
      if (binding.hash !== hash)
        throw new ConversationError(
          'CONVERSATION_SNAPSHOT_CONFLICT',
          'Snapshot version already contains different content',
          409,
        );
      return { conversationId: binding.conversationId, applied: false };
    }
    if (!binding) {
      if (input.deleted) return { conversationId: null, applied: false };
      const contacts = await tx<{ id: string }[]>`
        SELECT id FROM app.contacts
        WHERE org_id = ${viewer.organizationId} AND external_id = ${input.externalContactId}
          AND lifecycle_status IS DISTINCT FROM 'trashed'
        LIMIT 2
      `;
      const contact = contacts[0];
      // Two different mistakes, two different fixes: no contact carries
      // the id (create it first — the absent resource's 404), or more
      // than one does (the directory is ambiguous — a state refusal).
      if (!contact)
        throw new ConversationError(
          'CONTACT_NOT_FOUND',
          `No contact carries externalId "${input.externalContactId}"; create it before synchronizing its conversations`,
          404,
        );
      if (contacts.length > 1)
        throw new ConversationError(
          'CONTACT_AMBIGUOUS',
          `More than one contact carries externalId "${input.externalContactId}"`,
          409,
        );
      const conversationId = await createConversation(tx, {
        organizationId: viewer.organizationId,
        contactId: contact.id,
        subject: input.subject,
        status: input.status,
        channel: 'api',
        connectorName: input.source,
        direction: 'inbound',
      });
      await tx`
        INSERT INTO app.conversation_api_bindings(conversation_id, org_id, source, external_id, external_contact_id, owner_user_id)
        VALUES (${conversationId}, ${viewer.organizationId}, ${input.source}, ${input.externalId}, ${input.externalContactId}, ${viewer.userId})
      `;
      binding = {
        conversationId,
        ownerUserId: viewer.userId,
        externalContactId: input.externalContactId,
        version: '-1',
        hash: null,
        sourceDeleted: false,
      };
    }
    const conversationId = binding.conversationId;
    await tx`SELECT id FROM app.conversations WHERE id = ${conversationId} AND org_id = ${viewer.organizationId} FOR UPDATE`;
    const existing = await tx<
      {
        externalId: string;
        messageId: string;
        sourceVersion: number;
        metadata: Record<string, unknown> | null;
      }[]
    >`
      SELECT r.external_id AS "externalId", r.message_id AS "messageId", r.source_version::float8 AS "sourceVersion", m.metadata
      FROM app.conversation_api_messages r JOIN app.conversation_messages m ON m.id = r.message_id
      WHERE r.conversation_id = ${conversationId} AND m.org_id = ${viewer.organizationId}
    `;
    const byExternalId = new Map(existing.map((row) => [row.externalId, row]));
    for (const message of input.messages) {
      const content = messageHtml(message.content, message.format);
      const previous = byExternalId.get(message.externalId);
      if (previous && previous.sourceVersion > input.version)
        throw new ConversationError(
          'CONVERSATION_SNAPSHOT_CONFLICT',
          'A newer source receipt already owns this message',
          409,
        );
      // Delivery acknowledgement links the VAT receipt to the EXISTING
      // native reply. A lost ack is retried before this source revision can
      // apply, preventing a second copy while preserving later source edits.
      if (
        message.taleMessageId &&
        previous?.messageId !== message.taleMessageId
      )
        throw new ConversationError(
          'DELIVERY_UNACKNOWLEDGED',
          'A native reply must be acknowledged before its source snapshot',
          409,
        );
      const oldAttachments = z
        .array(z.object({ storageId: z.string() }))
        .safeParse(previous?.metadata?.attachments ?? []);
      const oldRefs = new Set(
        oldAttachments.success
          ? oldAttachments.data.map((item) => item.storageId)
          : [],
      );
      const newRefs = message.attachments
        .map((attachment) => attachment.storageId)
        .filter((ref) => !oldRefs.has(ref));
      if (await firstForeignUpload(tx, viewer, newRefs))
        throw new ConversationError(
          'ATTACHMENT_NOT_OWNED',
          'An attachment is not owned by this integration',
          403,
        );
      const metadata = {
        sender: message.authorName,
        isCustomer: message.isCustomer,
        attachments: attachmentMetadata(message.attachments),
      };
      if (previous) {
        await tx`
          UPDATE app.conversation_messages SET content = ${content}, metadata = ${tx.json(toJson(metadata))},
            direction = ${message.isCustomer ? 'inbound' : 'outbound'}, sent_at_ms = ${message.createdAt}
          WHERE id = ${previous.messageId} AND org_id = ${viewer.organizationId}
        `;
      } else {
        const created = await addMessageToConversation(tx, {
          organizationId: viewer.organizationId,
          conversationId,
          sender: message.authorName,
          content,
          isCustomer: message.isCustomer,
          // The legacy index is org-wide (email Message-ID semantics).
          // API ids are local to their source/thread, so namespace them.
          externalMessageId: `api:${input.source}:${createHash('sha256')
            .update(JSON.stringify([input.externalId, message.externalId]))
            .digest('hex')}`,
          sentAt: message.createdAt,
          connectorName: input.source,
          metadata,
        });
        await tx`
          INSERT INTO app.conversation_api_messages(conversation_id, external_id, message_id, source_version)
          VALUES (${conversationId}, ${message.externalId}, ${created.messageId}, ${input.version})
        `;
      }
      byExternalId.delete(message.externalId);
    }
    // Reconcile only receipt-owned messages. Unacknowledged native replies
    // have no receipt and cannot be erased by an older source snapshot.
    for (const removed of byExternalId.values()) {
      if (removed.sourceVersion > input.version) continue;
      await tx`DELETE FROM app.conversation_messages WHERE id = ${removed.messageId} AND org_id = ${viewer.organizationId}`;
    }
    await tx`
      UPDATE app.conversations SET subject = ${input.subject}, status = ${input.deleted ? 'closed' : input.status},
        metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{unread_count}', to_jsonb(least(
          CASE WHEN jsonb_typeof(metadata->'unread_count') = 'number' THEN (metadata->>'unread_count')::bigint ELSE 0 END,
          (SELECT count(*) FROM app.conversation_messages WHERE conversation_id = ${conversationId} AND direction = 'inbound')))),
        last_message_at_ms = coalesce((SELECT max(coalesce(sent_at_ms, delivered_at_ms, created_at_ms))
          FROM app.conversation_messages WHERE conversation_id = ${conversationId}), created_at_ms)
      WHERE id = ${conversationId} AND org_id = ${viewer.organizationId}
    `;
    await tx`
      UPDATE app.conversation_api_bindings SET snapshot_version = ${input.version}, snapshot_hash = ${hash}, source_deleted = ${input.deleted}, reply_constraints = ${tx.json(toJson(input.replyConstraints))}
      WHERE conversation_id = ${conversationId} AND org_id = ${viewer.organizationId}
    `;
    await hint(tx, viewer.organizationId, conversationId);
    return { conversationId, applied: true };
  });
}

/**
 * Called only after the normal Inbox visibility and write-role gates. A
 * native API reply is queued for its source, never handed to an email sender.
 */
export async function queueApiReply(
  sql: Sql,
  args: {
    organizationId: string;
    conversationId: string;
    content: string;
    body: string;
    attachments: z.infer<typeof apiAttachmentSchema>[];
    actor: { userId: string; email?: string };
    availableAt: number;
  },
): Promise<string> {
  if (!args.actor.email || args.body.length > 20_000)
    throw new ConversationError(
      'REPLY_INVALID',
      'An office reply needs an identified author and a bounded body',
      400,
    );
  const actorEmail = args.actor.email;
  for (const file of args.attachments) {
    apiAttachmentSchema.parse(file);
    const landed = await statOrgBlob(sql, args.organizationId, file.storageId);
    assertAttachmentLanded(landed, file.size);
  }
  return transactSerializable(sql, async (tx) => {
    const identities = await tx<
      { email: string }[]
    >`SELECT email FROM "user" WHERE id = ${args.actor.userId} AND "emailVerified" = true FOR SHARE`;
    if (
      identities[0]?.email.trim().toLowerCase() !==
      actorEmail.trim().toLowerCase()
    )
      throw new ConversationError(
        'AUTHOR_UNVERIFIED',
        'Verify your email before replying through an external app',
        403,
      );
    const bindings = await tx<{ source: string; constraints: unknown }[]>`
      SELECT b.source, b.reply_constraints AS constraints FROM app.conversation_api_bindings b JOIN app.conversations c ON c.id = b.conversation_id
      WHERE b.org_id = ${args.organizationId} AND b.conversation_id = ${args.conversationId}
        AND NOT b.source_deleted
        AND c.status = 'open' AND c.lifecycle_status IS DISTINCT FROM 'trashed'
      FOR UPDATE OF c
    `;
    if (!bindings[0])
      throw new ConversationError(
        'CONVERSATION_CLOSED',
        'This API conversation is unavailable',
        409,
      );
    const limits = replyConstraintsSchema.parse(bindings[0].constraints);
    if (
      args.body.trim().length > limits.maxBodyChars ||
      (args.attachments.length === 0 &&
        args.body.trim().length < limits.minBodyChars) ||
      args.attachments.length > limits.maxAttachments ||
      args.attachments.some(
        (file) =>
          file.size > limits.maxAttachmentBytes ||
          (limits.attachmentExtensions &&
            !limits.attachmentExtensions.includes(
              file.fileName.split('.').at(-1)?.toLowerCase() ?? '',
            )),
      )
    ) {
      throw new ConversationError(
        'REPLY_LIMITS',
        `This app accepts ${limits.minBodyChars}–${limits.maxBodyChars} characters and at most ${limits.maxAttachments} supported attachments`,
        400,
      );
    }
    const created = await addMessageToConversation(tx, {
      organizationId: args.organizationId,
      conversationId: args.conversationId,
      sender: actorEmail,
      content: args.content,
      isCustomer: false,
      status: 'queued',
      connectorName: bindings[0].source,
      metadata: {
        sourceMarkdown: args.body,
        scheduledSendAt: args.availableAt,
        attachments: attachmentMetadata(args.attachments),
      },
    });
    await tx`
      INSERT INTO app.conversation_api_deliveries(message_id, conversation_id, org_id, actor_user_id, actor_email, body, available_at_ms, retry_at_ms)
      VALUES (${created.messageId}, ${args.conversationId}, ${args.organizationId}, ${args.actor.userId}, ${actorEmail}, ${args.body}, ${args.availableAt}, ${args.availableAt})
    `;
    return created.messageId;
  });
}

const DELIVERY_LEASE_MS = 5 * 60 * 1000;
const DELIVERY_FAILURE_LIMIT = 10;

/**
 * The source a claim names must be one this key user mirrored: a slug no
 * snapshot ever named is the absent resource (404 — a typo'd source used to
 * poll a healthy-looking empty queue forever), and one only other service
 * users own is theirs (403), the same refusal the snapshot lane gives.
 */
async function assertOwnedSource(
  sql: Sql,
  viewer: ConversationViewer,
  source: string,
): Promise<void> {
  const rows = await sql<{ owned: boolean | null }[]>`
    SELECT bool_or(owner_user_id = ${viewer.userId}) AS owned
    FROM app.conversation_api_bindings
    WHERE org_id = ${viewer.organizationId} AND source = ${source}
  `;
  const owned = rows[0]?.owned ?? null;
  if (owned === null)
    throw new ConversationError(
      'CONVERSATION_SOURCE_NOT_FOUND',
      `No conversation was ever synchronized from the source "${source}"`,
      404,
    );
  if (!owned)
    throw new ConversationError(
      'INTEGRATION_NOT_OWNED',
      'This integration belongs to another service user',
      403,
    );
}

/**
 * A visibility lease closes undo and lets later replies progress on a
 * crash. Each item says where it stands in its own life — how many
 * attempts failed before this one, when this lease ends, what the last
 * failure reported, when it was first claimed — so a consumer can log
 * "about to dead-letter" or back off itself instead of counting blind.
 */
export async function claimApiDeliveries(
  sql: Sql,
  viewer: ConversationViewer,
  source: string,
  limit: number,
) {
  requireWriter(viewer);
  return transactSerializable(sql, async (tx) => {
    await assertOwnedSource(tx, viewer, source);
    const now = Date.now();
    const rows = await tx<
      {
        messageId: string;
        conversationId: string;
        externalId: string;
        actorUserId: string;
        actorEmail: string;
        body: string;
        availableAt: number;
        attempts: number;
        claimedAt: number | null;
        lastErrorCode: string | null;
        metadata: Record<string, unknown> | null;
      }[]
    >`
      SELECT d.message_id AS "messageId", d.conversation_id AS "conversationId", b.external_id AS "externalId",
        d.actor_user_id AS "actorUserId", d.actor_email AS "actorEmail", d.body, d.available_at_ms::float8 AS "availableAt",
        d.attempt_count AS attempts, d.claimed_at_ms::float8 AS "claimedAt", d.last_error_code AS "lastErrorCode", m.metadata
      FROM app.conversation_api_deliveries d
      JOIN app.conversation_api_bindings b ON b.conversation_id = d.conversation_id AND b.org_id = d.org_id
      JOIN app.conversation_messages m ON m.id = d.message_id AND m.org_id = d.org_id
      WHERE d.org_id = ${viewer.organizationId} AND b.source = ${source} AND b.owner_user_id = ${viewer.userId}
        AND d.acknowledged_at_ms IS NULL AND d.failed_at_ms IS NULL
        AND d.available_at_ms <= ${now} AND d.retry_at_ms <= ${now}
      ORDER BY d.retry_at_ms, d.available_at_ms, d.message_id LIMIT ${limit}
      FOR UPDATE OF d, m
    `;
    const tokens = new Map<string, string>();
    for (const row of rows) {
      const token = randomUUID();
      tokens.set(row.messageId, token);
      await tx`UPDATE app.conversation_api_deliveries SET claimed_at_ms = coalesce(claimed_at_ms, ${now}), claim_token = ${token}, retry_at_ms = ${now + DELIVERY_LEASE_MS} WHERE message_id = ${row.messageId}`;
      await tx`UPDATE app.conversation_messages SET metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{sendClaimedAt}', ${tx.json(now)}) WHERE id = ${row.messageId}`;
    }
    return rows.map((row) => ({
      messageId: row.messageId,
      claimToken: tokens.get(row.messageId),
      conversationId: row.conversationId,
      externalId: row.externalId,
      actorUserId: row.actorUserId,
      actorEmail: row.actorEmail,
      body: row.body,
      availableAt: row.availableAt,
      attempts: row.attempts,
      leaseExpiresAt: now + DELIVERY_LEASE_MS,
      lastErrorCode: row.lastErrorCode,
      firstClaimedAt: row.claimedAt ?? now,
      attachments: z
        .array(
          z.object({
            storageId: z.string(),
            filename: z.string(),
            contentType: z.string(),
            size: z.number(),
          }),
        )
        .parse(row.metadata?.attachments ?? []),
    }));
  });
}

/** One row of the queue as the listing shows it — no claim token, no
 * body: reading the queue must never hand out what only a claim earns. */
export interface ApiDeliveryListRow {
  messageId: string;
  conversationId: string;
  externalId: string;
  status: ApiDeliveryStatus;
  attempts: number;
  availableAt: number;
  retryAt: number;
  claimedAt: number | null;
  failedAt: number | null;
  lastErrorCode: string | null;
  acknowledgedAt: number | null;
  receiptId: string | null;
}

/**
 * The queue as it stands for a source this key user mirrored — no lease
 * taken, nothing changed: what a consumer could otherwise learn only by
 * claiming. `status` is read off the stamps: `delivered` once
 * acknowledged, `failed` once dead-lettered (a permanent refusal or the
 * tenth transient one), `leased` while a claim's lease runs, `queued` for
 * everything else — the undo window, the backoff between attempts, and a
 * lease that lapsed. Oldest-due first (`retryAt`, then `messageId`), the
 * order a claim drains it in; the keyset continues where a page ended.
 */
export async function listApiDeliveries(
  sql: Sql,
  viewer: ConversationViewer,
  source: string,
  options: {
    status?: ApiDeliveryStatus;
    cursor: { at: number; id: string } | null;
    limit: number;
  },
): Promise<{
  deliveries: ApiDeliveryListRow[];
  nextCursor: { at: number; id: string } | null;
}> {
  requireWriter(viewer);
  await assertOwnedSource(sql, viewer, source);
  const now = Date.now();
  const rows = await sql<ApiDeliveryListRow[]>`
    WITH q AS (
      SELECT d.message_id AS "messageId", d.conversation_id AS "conversationId", b.external_id AS "externalId",
        CASE
          WHEN d.acknowledged_at_ms IS NOT NULL THEN 'delivered'
          WHEN d.failed_at_ms IS NOT NULL THEN 'failed'
          WHEN d.claim_token IS NOT NULL AND d.retry_at_ms > ${now} THEN 'leased'
          ELSE 'queued'
        END AS status,
        d.attempt_count AS attempts, d.available_at_ms::float8 AS "availableAt", d.retry_at_ms::float8 AS "retryAt",
        d.claimed_at_ms::float8 AS "claimedAt", d.failed_at_ms::float8 AS "failedAt", d.last_error_code AS "lastErrorCode",
        d.acknowledged_at_ms::float8 AS "acknowledgedAt", d.receipt_id AS "receiptId",
        d.retry_at_ms AS retry_key
      FROM app.conversation_api_deliveries d
      JOIN app.conversation_api_bindings b ON b.conversation_id = d.conversation_id AND b.org_id = d.org_id
      WHERE d.org_id = ${viewer.organizationId} AND b.source = ${source} AND b.owner_user_id = ${viewer.userId}
    )
    SELECT "messageId", "conversationId", "externalId", status, attempts, "availableAt", "retryAt",
      "claimedAt", "failedAt", "lastErrorCode", "acknowledgedAt", "receiptId"
    FROM q
    WHERE ${options.status === undefined ? sql`true` : sql`status = ${options.status}`}
      AND ${
        options.cursor === null
          ? sql`true`
          : sql`(retry_key, "messageId") > (${options.cursor.at}, ${options.cursor.id})`
      }
    ORDER BY retry_key, "messageId"
    LIMIT ${options.limit + 1}
  `;
  const deliveries = rows.slice(0, options.limit);
  const last = deliveries.at(-1);
  return {
    deliveries,
    nextCursor:
      rows.length > options.limit && last !== undefined
        ? { at: last.retryAt, id: last.messageId }
        : null,
  };
}

/**
 * Re-drive a dead-lettered delivery and record who asked — the ONE
 * audited retry both doors share: the app's Inbox Retry
 * (`retrySendMessage`) and the REST door's
 * `POST /conversations/deliveries/{id}/retry`. Runs inside the caller's
 * transaction, after the caller established that the message is theirs
 * to act on.
 */
export async function retryApiDeliveryAudited(
  tx: TransactionSql,
  args: {
    organizationId: string;
    messageId: string;
    conversationId: string;
    actor: { userId: string; email?: string };
  },
): Promise<void> {
  await retryApiDelivery(tx, args.organizationId, args.messageId);
  await createAuditLog(tx, {
    organizationId: args.organizationId,
    actorId: args.actor.userId,
    ...(args.actor.email !== undefined ? { actorEmail: args.actor.email } : {}),
    actorType: 'user',
    action: 'retry_send_message',
    category: 'data',
    resourceType: 'conversationMessage',
    resourceId: args.messageId,
    newState: { conversationId: args.conversationId, channel: 'api' },
    status: 'success',
  });
}

/**
 * The REST door's retry: a delivery of a source this key user owns that
 * dead-lettered goes back to `queued` and is claimable at once. A delivery
 * nobody owns under the id is absent (404 `DELIVERY_NOT_FOUND`); one that
 * is not dead-lettered — still queued, leased, or already delivered — or
 * whose conversation the source tore down or closed cannot be retried
 * (409 `DELIVERY_RETRY_UNAVAILABLE`).
 */
export async function retryApiDeliveryForSource(
  sql: Sql,
  viewer: ConversationViewer,
  messageId: string,
  actorEmail?: string,
): Promise<{ ok: true }> {
  requireWriter(viewer);
  await sql.begin(async (tx) => {
    const rows = await tx<{ conversationId: string }[]>`
      SELECT d.conversation_id AS "conversationId"
      FROM app.conversation_api_deliveries d
      JOIN app.conversation_api_bindings b ON b.conversation_id = d.conversation_id AND b.org_id = d.org_id
      WHERE d.message_id = ${messageId} AND d.org_id = ${viewer.organizationId} AND b.owner_user_id = ${viewer.userId}
    `;
    const row = rows[0];
    if (!row)
      throw new ConversationError(
        'DELIVERY_NOT_FOUND',
        'Delivery not found',
        404,
      );
    await retryApiDeliveryAudited(tx, {
      organizationId: viewer.organizationId,
      messageId,
      conversationId: row.conversationId,
      actor: {
        userId: viewer.userId,
        ...(actorEmail === undefined ? {} : { email: actorEmail }),
      },
    });
  });
  return { ok: true };
}

/** Failure reports are idempotent per claim; a stale worker cannot fail a new lease. */
export async function failApiDelivery(
  sql: Sql,
  viewer: ConversationViewer,
  messageId: string,
  failure: z.infer<typeof apiDeliveryFailureSchema>,
) {
  requireWriter(viewer);
  return transactSerializable(sql, async (tx) => {
    const rows = await tx<
      {
        conversationId: string;
        claimToken: string | null;
        acknowledgedAt: string | null;
        attempts: number;
      }[]
    >`
      SELECT d.conversation_id AS "conversationId", d.claim_token AS "claimToken",
        d.acknowledged_at_ms::text AS "acknowledgedAt", d.attempt_count AS attempts
      FROM app.conversation_api_deliveries d
      JOIN app.conversation_api_bindings b ON b.conversation_id = d.conversation_id AND b.org_id = d.org_id
      WHERE d.message_id = ${messageId} AND d.org_id = ${viewer.organizationId} AND b.owner_user_id = ${viewer.userId}
      FOR UPDATE OF d
    `;
    const row = rows[0];
    if (!row)
      throw new ConversationError(
        'DELIVERY_NOT_FOUND',
        'Delivery not found',
        404,
      );
    if (row.acknowledgedAt !== null || row.claimToken !== failure.claimToken)
      return { ok: true };
    const attempts = row.attempts + 1;
    const terminal = failure.permanent || attempts >= DELIVERY_FAILURE_LIMIT;
    const now = Date.now();
    const retryAt =
      now + Math.min(60 * 60 * 1000, 60_000 * 2 ** (attempts - 1));
    await tx`UPDATE app.conversation_api_deliveries SET claim_token = NULL, attempt_count = ${attempts},
      retry_at_ms = ${retryAt}, failed_at_ms = ${terminal ? now : null}, last_error_code = ${failure.code}
      WHERE message_id = ${messageId}`;
    // Automatic retries stay queued. Only terminal failures expose Retry /
    // Discard, so a user cannot discard a delivery during its next attempt.
    if (terminal) {
      await tx`UPDATE app.conversation_messages SET delivery_state = 'failed', status_changed_at_ms = ${now},
        metadata = coalesce(metadata, '{}'::jsonb) || ${tx.json({ error: 'The external app could not accept this reply. Review access and retry.', errorCode: failure.code })}
        WHERE id = ${messageId} AND org_id = ${viewer.organizationId}`;
      await hint(tx, viewer.organizationId, row.conversationId);
    }
    return { ok: true };
  });
}

/** The existing Inbox retry door restarts this outbox without an email job. */
export async function retryApiDelivery(
  tx: TransactionSql,
  organizationId: string,
  messageId: string,
): Promise<void> {
  // Match Discard's message-then-cascaded-delivery lock order. Otherwise a
  // simultaneous retry/discard could deadlock after each acquired one row.
  const locked = await tx`
    SELECT id FROM app.conversation_messages WHERE id = ${messageId}
      AND org_id = ${organizationId} AND delivery_state = 'failed' FOR UPDATE
  `;
  if (locked.length !== 1)
    throw new ConversationError(
      'DELIVERY_RETRY_UNAVAILABLE',
      'This API delivery cannot be retried',
      409,
    );
  const rows = await tx<{ conversationId: string }[]>`
    UPDATE app.conversation_api_deliveries d SET failed_at_ms = NULL, attempt_count = 0,
      last_error_code = NULL, claim_token = NULL, retry_at_ms = 0
    FROM app.conversation_api_bindings b, app.conversations c
    WHERE d.message_id = ${messageId} AND d.org_id = ${organizationId}
      AND d.failed_at_ms IS NOT NULL AND d.acknowledged_at_ms IS NULL
      AND b.conversation_id = d.conversation_id AND NOT b.source_deleted
      AND c.id = d.conversation_id AND c.org_id = d.org_id
      AND c.status = 'open' AND c.lifecycle_status IS DISTINCT FROM 'trashed'
    RETURNING d.conversation_id AS "conversationId"
  `;
  const row = rows[0];
  if (!row)
    throw new ConversationError(
      'DELIVERY_RETRY_UNAVAILABLE',
      'This API delivery cannot be retried',
      409,
    );
  const changed = await tx`
    UPDATE app.conversation_messages SET delivery_state = 'queued', retry_count = coalesce(retry_count, 0) + 1,
      status_changed_at_ms = ${Date.now()}, metadata = coalesce(metadata, '{}'::jsonb) - 'error' - 'errorCode'
    WHERE id = ${messageId} AND org_id = ${organizationId} AND delivery_state = 'failed' RETURNING id
  `;
  if (changed.length !== 1)
    throw new ConversationError(
      'DELIVERY_RETRY_UNAVAILABLE',
      'This API delivery cannot be retried',
      409,
    );
  await hint(tx, organizationId, row.conversationId);
}

export async function acknowledgeApiDelivery(
  sql: Sql,
  viewer: ConversationViewer,
  messageId: string,
  receiptId: string,
  sourceVersion: number,
) {
  requireWriter(viewer);
  return transactSerializable(sql, async (tx) => {
    const rows = await tx<
      { conversationId: string; receiptId: string | null }[]
    >`
      SELECT d.conversation_id AS "conversationId", d.receipt_id AS "receiptId"
      FROM app.conversation_api_deliveries d JOIN app.conversation_api_bindings b ON b.conversation_id = d.conversation_id
      WHERE d.message_id = ${messageId} AND d.org_id = ${viewer.organizationId} AND b.owner_user_id = ${viewer.userId}
        AND d.claimed_at_ms IS NOT NULL FOR UPDATE OF d
    `;
    const row = rows[0];
    if (!row)
      throw new ConversationError(
        'DELIVERY_NOT_FOUND',
        'Delivery not found',
        404,
      );
    if (row.receiptId !== null && row.receiptId !== receiptId)
      throw new ConversationError(
        'DELIVERY_RECEIPT_CONFLICT',
        'Delivery already has another receipt',
        409,
      );
    const now = Date.now();
    await tx`UPDATE app.conversation_api_deliveries SET acknowledged_at_ms = coalesce(acknowledged_at_ms, ${now}), receipt_id = ${receiptId}, failed_at_ms = NULL, last_error_code = NULL, claim_token = NULL WHERE message_id = ${messageId}`;
    await tx`INSERT INTO app.conversation_api_messages(conversation_id, external_id, message_id, source_version)
      VALUES (${row.conversationId}, ${receiptId}, ${messageId}, ${sourceVersion}) ON CONFLICT (conversation_id, external_id) DO NOTHING`;
    const receipt = await tx<
      { messageId: string; version: number }[]
    >`SELECT message_id AS "messageId", source_version::float8 AS version FROM app.conversation_api_messages WHERE conversation_id = ${row.conversationId} AND external_id = ${receiptId}`;
    if (
      receipt[0]?.messageId !== messageId ||
      receipt[0].version !== sourceVersion
    )
      throw new ConversationError(
        'DELIVERY_RECEIPT_CONFLICT',
        'Receipt belongs to another message',
        409,
      );
    await tx`UPDATE app.conversation_messages SET delivery_state = 'delivered', sent_at_ms = coalesce(sent_at_ms, ${now}), delivered_at_ms = coalesce(delivered_at_ms, ${now}), metadata = coalesce(metadata, '{}'::jsonb) - 'error' - 'errorCode' WHERE id = ${messageId} AND org_id = ${viewer.organizationId}`;
    await hint(tx, viewer.organizationId, row.conversationId);
    return { ok: true };
  });
}

export async function apiSnapshotState(
  sql: Sql,
  viewer: ConversationViewer,
  source: string,
  externalId: string,
) {
  requireWriter(viewer);
  const bindings = await sql<
    { conversationId: string; version: number; organizationId: string }[]
  >`
    SELECT conversation_id AS "conversationId", snapshot_version::float8 AS version, org_id AS "organizationId"
    FROM app.conversation_api_bindings
    WHERE org_id = ${viewer.organizationId} AND source = ${source} AND external_id = ${externalId} AND owner_user_id = ${viewer.userId}
  `;
  const binding = bindings[0];
  if (!binding) return null;
  const rows = await sql<{ metadata: Record<string, unknown> | null }[]>`
    SELECT m.metadata FROM app.conversation_api_messages r
    JOIN app.conversation_messages m ON m.id = r.message_id
    WHERE r.conversation_id = ${binding.conversationId} AND m.org_id = ${viewer.organizationId}
  `;
  return {
    ...binding,
    attachments: rows.flatMap((row) => {
      const parsed = z
        .array(z.object({ id: z.string(), storageId: z.string() }))
        .safeParse(row.metadata?.attachments ?? []);
      return parsed.success ? parsed.data : [];
    }),
  };
}

export async function apiDeliveryAttachment(
  sql: Sql,
  viewer: ConversationViewer,
  messageId: string,
  index: number,
) {
  requireWriter(viewer);
  const rows = await sql<{ metadata: Record<string, unknown> | null }[]>`
    SELECT m.metadata FROM app.conversation_api_deliveries d
    JOIN app.conversation_api_bindings b ON b.conversation_id = d.conversation_id AND b.org_id = d.org_id
    JOIN app.conversation_messages m ON m.id = d.message_id AND m.org_id = d.org_id
    WHERE d.message_id = ${messageId} AND d.org_id = ${viewer.organizationId} AND b.owner_user_id = ${viewer.userId}
      AND d.claimed_at_ms IS NOT NULL
  `;
  // Two absences, two codes — the same split ack and fail answer: no
  // claimed delivery this user owns under the id, or a delivery without
  // an attachment at that position.
  const row = rows[0];
  if (!row)
    throw new ConversationError(
      'DELIVERY_NOT_FOUND',
      'Delivery not found',
      404,
    );
  const parsed = z
    .array(
      z.object({
        storageId: z.string(),
        filename: z.string(),
        contentType: z.string(),
        size: z.number().max(30 * 1024 * 1024),
      }),
    )
    .safeParse(row.metadata?.attachments ?? []);
  const attachment = parsed.success ? parsed.data[index] : undefined;
  if (!attachment)
    throw new ConversationError(
      'ATTACHMENT_NOT_FOUND',
      'Attachment not found',
      404,
    );
  return attachment;
}
