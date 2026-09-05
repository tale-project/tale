import type { Sql } from 'postgres';
import { z } from 'zod';

import { isUniqueViolation, toJson } from '../../db/sql.ts';
import {
  listActiveCredentials,
  patchCredentialConfigInternal,
  patchMailSyncWatermarks,
  resolveCredentialRowForShim,
} from '../connector_credentials/service.ts';
import { putOrgBlobBytes, registerUploadedBytes } from '../files/service.ts';
import { applyAddressRouting } from './routing.ts';
import {
  addMessageToConversation,
  createConversation,
  type ConversationMessageRow,
  type ConversationRow,
} from './service.ts';

/**
 * Shim handlers for the REUSED 0.4 mailbox sync/ingest modules
 * (`conversations/sync_mailbox.ts` + `conversations/ingest/*` — Message-ID
 * idempotency, threading, contact find-or-create, attachment reuse): every
 * `ctx.run*` ref those modules call, answered from the 0.5 services. Rows
 * cross the seam in the 0.4 WIRE SHAPE (`_id`/`_creationTime`, absent-not-
 * null fields) because the reused code reads exactly those.
 *
 * `runConnector` is injected by the connectors door (the sync module calls
 * back into `connectors/execute_action:runConnectorAction` for the mail
 * fetches) — a parameter, not an import, so the two domains stay acyclic.
 */

export type RunConnectorFn = (args: {
  organizationId: string;
  connector: string;
  action: string;
  input: unknown;
  mode?: 'mock' | 'live';
  credentialRef?: string;
  caller: unknown;
  idempotencyKey?: string;
}) => Promise<unknown>;

function dropNulls(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== null) out[key] = value;
  }
  return out;
}

/** A PG conversation row in the 0.4 internal-record wire shape. */
function wireConversation(row: ConversationRow): Record<string, unknown> {
  const { id, createdAt, ...rest } = row;
  return dropNulls({ ...rest, _id: id, _creationTime: createdAt });
}

/** A PG message row in the 0.4 internal-record wire shape. */
function wireMessage(row: ConversationMessageRow): Record<string, unknown> {
  const { id, createdAt, ...rest } = row;
  return dropNulls({ ...rest, _id: id, _creationTime: createdAt });
}

/**
 * The row an org's Message-ID already landed on — where the LOSER of an
 * ingest race lands. Two passes of one mailbox can overlap (the schedule
 * claims the occurrence, not the run; a manual run can join a scheduled one),
 * both miss `checkMessageExists`, and both insert. The partial unique index
 * `conversation_messages_org_external_unique` (migration 0077) refuses the
 * second insert; the writer then answers the winner's row, so the ingest
 * treats the message as already landed instead of failing the pass or
 * writing the mail twice. Null when the error is anything else.
 */
async function landOnExistingMessage(
  sql: Sql,
  error: unknown,
  args: { organizationId: string; externalMessageId: string | undefined },
): Promise<{ conversationId: string; messageId: string } | null> {
  if (args.externalMessageId === undefined || !isUniqueViolation(error)) {
    return null;
  }
  const rows = await sql<{ id: string; conversationId: string }[]>`
    SELECT id, conversation_id AS "conversationId"
    FROM app.conversation_messages
    WHERE org_id = ${args.organizationId}
      AND external_message_id = ${args.externalMessageId}
    LIMIT 1
  `;
  const existing = rows[0];
  if (!existing) return null;
  console.info(
    `[conversations-shim] Message-ID ${args.externalMessageId} landed twice; the second write joins message ${existing.id}`,
  );
  return { conversationId: existing.conversationId, messageId: existing.id };
}

const CONVERSATION_WIRE_COLUMNS = `
  id, org_id AS "organizationId", contact_id AS "contactId",
  assignee_user_id AS "assigneeUserId", assignee_team_id AS "assigneeTeamId",
  external_message_id AS "externalMessageId", subject, status, priority,
  type, channel, direction, connector_name AS "connectorName",
  last_message_at_ms::float8 AS "lastMessageAt", metadata,
  lifecycle_status AS "lifecycleStatus",
  status_changed_at_ms::float8 AS "statusChangedAt",
  created_at_ms::float8 AS "createdAt"
`;

const MESSAGE_WIRE_COLUMNS = `
  id, org_id AS "organizationId", conversation_id AS "conversationId",
  channel, direction, external_message_id AS "externalMessageId",
  delivery_state AS "deliveryState", retry_count AS "retryCount",
  connector_name AS "connectorName", content,
  sent_at_ms::float8 AS "sentAt", delivered_at_ms::float8 AS "deliveredAt",
  metadata, created_at_ms::float8 AS "createdAt"
`;

export function conversationShimHandlers(
  sql: Sql,
  runConnector: RunConnectorFn,
) {
  const org = z.object({ organizationId: z.string() });

  return {
    // ------------------------------------------------------------ queries
    'conversations/internal_queries:getConversationById': async (
      raw: unknown,
    ) => {
      const args = z.object({ conversationId: z.string() }).parse(raw);
      const rows = await sql<ConversationRow[]>`
        SELECT ${sql.unsafe(CONVERSATION_WIRE_COLUMNS)}
        FROM app.conversations WHERE id = ${args.conversationId} LIMIT 1
      `;
      return rows[0] ? wireConversation(rows[0]) : null;
    },
    'conversations/internal_queries:getConversationByExternalMessageId': async (
      raw: unknown,
    ) => {
      const args = org.extend({ externalMessageId: z.string() }).parse(raw);
      const rows = await sql<ConversationRow[]>`
          SELECT ${sql.unsafe(CONVERSATION_WIRE_COLUMNS)}
          FROM app.conversations
          WHERE org_id = ${args.organizationId}
            AND external_message_id = ${args.externalMessageId}
          LIMIT 1
        `;
      return rows[0] ? wireConversation(rows[0]) : null;
    },
    'conversations/internal_queries:getMessageByExternalId': async (
      raw: unknown,
    ) => {
      const args = org.extend({ externalMessageId: z.string() }).parse(raw);
      const rows = await sql<ConversationMessageRow[]>`
        SELECT ${sql.unsafe(MESSAGE_WIRE_COLUMNS)}
        FROM app.conversation_messages
        WHERE org_id = ${args.organizationId}
          AND external_message_id = ${args.externalMessageId}
        LIMIT 1
      `;
      return rows[0] ? wireMessage(rows[0]) : null;
    },
    'conversations/internal_queries:queryLatestMessageByDeliveryState': async (
      raw: unknown,
    ) => {
      const args = org
        .extend({
          channel: z.string(),
          direction: z.enum(['inbound', 'outbound']),
          deliveryState: z.enum(['queued', 'sent', 'delivered', 'failed']),
          connectorName: z.string().optional(),
        })
        .parse(raw);
      const rows = await sql<ConversationMessageRow[]>`
          SELECT ${sql.unsafe(MESSAGE_WIRE_COLUMNS)}
          FROM app.conversation_messages
          WHERE org_id = ${args.organizationId}
            AND channel = ${args.channel}
            AND direction = ${args.direction}
            AND delivery_state = ${args.deliveryState}
            AND (${args.connectorName ?? null}::text IS NULL
              OR connector_name = ${args.connectorName ?? null})
          ORDER BY delivered_at_ms DESC NULLS LAST, seq DESC
          LIMIT 1
        `;
      return { message: rows[0] ? wireMessage(rows[0]) : null };
    },

    // ---------------------------------------------------------- mutations
    'conversations/internal_mutations:createConversationWithMessage': async (
      raw: unknown,
    ) => {
      const args = org
        .extend({
          contactId: z.string().optional(),
          assigneeUserId: z.string().optional(),
          assigneeTeamId: z.string().optional(),
          externalMessageId: z.string().optional(),
          subject: z.string().optional(),
          status: z.enum(['open', 'closed', 'spam', 'archived']).optional(),
          priority: z.string().optional(),
          type: z.string().optional(),
          channel: z.string().optional(),
          direction: z.enum(['inbound', 'outbound']).optional(),
          connectorName: z.string().optional(),
          metadata: z.record(z.string(), z.unknown()).optional(),
          initialMessage: z
            .object({
              sender: z.string(),
              content: z.string(),
              isCustomer: z.boolean(),
              status: z.string().optional(),
              attachment: z.unknown().optional(),
              attachments: z.array(z.unknown()).optional(),
              externalMessageId: z.string().optional(),
              metadata: z.record(z.string(), z.unknown()).optional(),
              sentAt: z.number().optional(),
              deliveredAt: z.number().optional(),
              connectorName: z.string().optional(),
            })
            .loose(),
        })
        .parse(raw);
      const { initialMessage, ...conversationArgs } = args;
      try {
        return await sql.begin(async (tx) => {
          const conversationId = await createConversation(tx, conversationArgs);
          const { messageId } = await addMessageToConversation(tx, {
            conversationId,
            organizationId: args.organizationId,
            sender: initialMessage.sender,
            content: initialMessage.content,
            isCustomer: initialMessage.isCustomer,
            ...(initialMessage.status !== undefined
              ? { status: initialMessage.status }
              : {}),
            ...(Array.isArray(initialMessage.attachments)
              ? { attachments: initialMessage.attachments }
              : {}),
            ...(initialMessage.externalMessageId !== undefined
              ? { externalMessageId: initialMessage.externalMessageId }
              : {}),
            ...(initialMessage.metadata !== undefined
              ? { metadata: initialMessage.metadata }
              : {}),
            ...(initialMessage.sentAt !== undefined
              ? { sentAt: initialMessage.sentAt }
              : {}),
            ...(initialMessage.deliveredAt !== undefined
              ? { deliveredAt: initialMessage.deliveredAt }
              : {}),
            ...(initialMessage.connectorName !== undefined ||
            args.connectorName !== undefined
              ? {
                  connectorName:
                    initialMessage.connectorName ?? args.connectorName,
                }
              : {}),
          });
          // Address routing (governance feature): auto-assign a NEW inbound
          // conversation to the team/person mapped to the address it was sent
          // to, BEFORE downstream notifications observe the row (the 0.4
          // ingest-inline hook).
          if (args.direction === 'inbound') {
            await applyAddressRouting(tx, {
              id: conversationId,
              organizationId: args.organizationId,
              subject: args.subject ?? null,
              status: args.status ?? 'open',
              assigneeUserId: args.assigneeUserId ?? null,
              assigneeTeamId: args.assigneeTeamId ?? null,
              metadata: args.metadata ?? null,
            });
          }
          return { conversationId, messageId };
        });
      } catch (error) {
        const landed = await landOnExistingMessage(sql, error, {
          organizationId: args.organizationId,
          externalMessageId:
            initialMessage.externalMessageId ?? args.externalMessageId,
        });
        if (!landed) throw error;
        return landed;
      }
    },
    'conversations/internal_mutations:addMessageToConversation': async (
      raw: unknown,
    ) => {
      const args = org
        .extend({
          conversationId: z.string(),
          sender: z.string(),
          content: z.string(),
          isCustomer: z.boolean(),
          status: z.string().optional(),
          attachment: z.unknown().optional(),
          attachments: z.array(z.unknown()).optional(),
          externalMessageId: z.string().optional(),
          metadata: z.record(z.string(), z.unknown()).optional(),
          sentAt: z.number().optional(),
          deliveredAt: z.number().optional(),
          connectorName: z.string().optional(),
        })
        .parse(raw);
      try {
        const result = await sql.begin((tx) =>
          addMessageToConversation(tx, {
            conversationId: args.conversationId,
            organizationId: args.organizationId,
            sender: args.sender,
            content: args.content,
            isCustomer: args.isCustomer,
            ...(args.status !== undefined ? { status: args.status } : {}),
            ...(Array.isArray(args.attachments)
              ? { attachments: args.attachments }
              : {}),
            ...(args.externalMessageId !== undefined
              ? { externalMessageId: args.externalMessageId }
              : {}),
            ...(args.metadata !== undefined ? { metadata: args.metadata } : {}),
            ...(args.sentAt !== undefined ? { sentAt: args.sentAt } : {}),
            ...(args.deliveredAt !== undefined
              ? { deliveredAt: args.deliveredAt }
              : {}),
            ...(args.connectorName !== undefined
              ? { connectorName: args.connectorName }
              : {}),
          }),
        );
        return result.conversationId;
      } catch (error) {
        const landed = await landOnExistingMessage(sql, error, {
          organizationId: args.organizationId,
          externalMessageId: args.externalMessageId,
        });
        if (!landed) throw error;
        return landed.conversationId;
      }
    },
    'conversations/internal_mutations:updateConversationMessage': async (
      raw: unknown,
    ) => {
      const args = z
        .object({
          messageId: z.string(),
          externalMessageId: z.string().optional(),
          deliveryState: z
            .enum(['queued', 'sent', 'delivered', 'failed'])
            .optional(),
          sentAt: z.number().optional(),
          deliveredAt: z.number().optional(),
          metadata: z.record(z.string(), z.unknown()).optional(),
          retryCount: z.number().optional(),
        })
        .parse(raw);
      // Metadata MERGES onto the stored object (the same `||` every other
      // message metadata write uses): a re-sync of an already-ingested
      // message hands back only the envelope (`buildEmailMetadata`: from/to/
      // cc/…), and a wholesale replace dropped the insert-time `sender` /
      // `isCustomer` the Inbox renders — on every mailbox, every second poll,
      // because the sync re-fetches the message sitting on its cursor.
      await sql`
        UPDATE app.conversation_messages SET
          external_message_id = ${args.externalMessageId ?? sql.unsafe('external_message_id')},
          delivery_state = ${args.deliveryState ?? sql.unsafe('delivery_state')},
          sent_at_ms = ${args.sentAt ?? sql.unsafe('sent_at_ms')},
          delivered_at_ms = ${args.deliveredAt ?? sql.unsafe('delivered_at_ms')},
          metadata = ${
            args.metadata !== undefined
              ? sql`coalesce(metadata, '{}'::jsonb) || ${sql.json(toJson(args.metadata))}`
              : sql.unsafe('metadata')
          },
          retry_count = ${args.retryCount ?? sql.unsafe('retry_count')}
        WHERE id = ${args.messageId}
      `;
      return null;
    },

    // ------------------------------------------------------------ contacts
    'contacts/internal_mutations:findOrCreateContact': async (raw: unknown) => {
      const args = org
        .extend({
          email: z.string(),
          name: z.string().optional(),
          source: z.string(),
          metadata: z.record(z.string(), z.unknown()).optional(),
        })
        .parse(raw);
      const email = args.email.toLowerCase().trim();
      return sql.begin(async (tx) => {
        // `contacts_org_email` is a plain index, so two overlapping sync
        // passes that both miss the lookup would both insert. Serialize the
        // find-or-create per (org, email): the second transaction waits on
        // the first's commit and its SELECT then sees the row.
        await tx`
          SELECT pg_advisory_xact_lock(
            hashtextextended('contact:' || ${args.organizationId} || ':' || ${email}, 0)
          )
        `;
        const existing = await tx<{ id: string }[]>`
          SELECT id FROM app.contacts
          WHERE org_id = ${args.organizationId} AND email = ${email}
          LIMIT 1
        `;
        if (existing[0]) {
          return { contactId: existing[0].id, created: false };
        }
        const now = Date.now();
        const inserted = await tx<{ id: string }[]>`
          INSERT INTO app.contacts (
            org_id, name, email, source, metadata, created_at_ms,
            updated_at_ms
          ) VALUES (
            ${args.organizationId}, ${args.name || email}, ${email},
            ${args.source},
            ${args.metadata === undefined ? null : tx.json(toJson(args.metadata))},
            ${now}, ${now}
          )
          RETURNING id
        `;
        const contactId = inserted[0]?.id;
        if (!contactId) throw new Error('contact insert failed');
        return { contactId, created: true };
      });
    },

    // ------------------------------------------------------- attachments
    'files/blob_actions:storeOrgBlob': async (raw: unknown) => {
      const args = org
        .extend({
          bytes: z.instanceof(ArrayBuffer),
          contentType: z.string(),
        })
        .parse(raw);
      return storeOrgBlobBytes(sql, args);
    },
    'file_metadata/internal_mutations:saveFileMetadata': async (
      raw: unknown,
    ) => {
      const args = org
        .extend({
          storageId: z.string(),
          fileName: z.string(),
          contentType: z.string(),
          size: z.number(),
          source: z.string().optional(),
          uploadedBy: z.string().optional(),
          skipRagIndexing: z.boolean().optional(),
          deferRagDispatch: z.boolean().optional(),
        })
        .loose()
        .parse(raw);
      return registerUploadedBytes(sql, {
        organizationId: args.organizationId,
        storageRef: args.storageId,
        fileName: args.fileName,
        contentType: args.contentType,
        size: args.size,
        ...(args.source !== undefined ? { source: args.source } : {}),
        ...(args.uploadedBy !== undefined
          ? { uploadedBy: args.uploadedBy }
          : {}),
        skipRagIndexing: args.skipRagIndexing === true,
      });
    },
    'file_metadata/internal_mutations:bindFileToConversation': async (
      raw: unknown,
    ) => {
      const args = org
        .extend({
          storageId: z.string(),
          conversationId: z.string(),
          receivedAt: z.number().optional(),
        })
        .parse(raw);
      const rows = await sql<
        {
          id: string;
          organizationId: string;
          conversationId: string | null;
          mailReceivedAt: number | null;
          createdAt: number;
        }[]
      >`
        SELECT id, org_id AS "organizationId",
               conversation_id AS "conversationId",
               mail_received_at_ms::float8 AS "mailReceivedAt",
               created_at_ms::float8 AS "createdAt"
        FROM app.file_metadata
        WHERE storage_ref = ${args.storageId}
        LIMIT 1
      `;
      const row = rows[0];
      if (!row) return 'not_found';
      if (row.organizationId !== args.organizationId) return 'other_org';
      const alreadyBound = row.conversationId === args.conversationId;
      const receivedAt = row.mailReceivedAt ?? args.receivedAt ?? row.createdAt;
      const needsReceivedAt = row.mailReceivedAt !== receivedAt;
      if (alreadyBound && !needsReceivedAt) return 'unchanged';
      await sql`
        UPDATE app.file_metadata SET
          conversation_id = ${alreadyBound ? sql.unsafe('conversation_id') : args.conversationId},
          mail_received_at_ms = ${needsReceivedAt ? receivedAt : sql.unsafe('mail_received_at_ms')}
        WHERE id = ${row.id}
      `;
      // The 0.4 conversation-scope RAG upgrade rides the conversation-corpus
      // retrieval leg (still honest-empty in 0.5) — bound, never queued here.
      return 'bound';
    },

    // -------------------------------------------------------- credentials
    /**
     * The full row the reused resolver reads (the SAME answer the work-lane
     * shim serves). The sync's account-email read wants only `config`, but the
     * IMAP fromAddress heal runs the reused resolver on this row and decrypts
     * `encryptedData` itself — the identity-only answer served before left it
     * dying on the missing envelope every pass, before it could heal anything.
     */
    'connector_credentials/queries:resolveCredentialRefInternal': async (
      raw: unknown,
    ) => {
      const args = org
        .extend({
          connectorSlug: z.string(),
          credentialRef: z.string().optional(),
        })
        .parse(raw);
      return resolveCredentialRowForShim(sql, args);
    },
    'connector_credentials/queries:listActiveCredentialsInternal': async (
      raw: unknown,
    ) => {
      const args = org.extend({ connectorSlug: z.string() }).parse(raw);
      const rows = await listActiveCredentials(
        sql,
        args.organizationId,
        args.connectorSlug,
      );
      return rows.map((row) =>
        dropNulls({
          id: row.id,
          name: row.name,
          isDefault: row.isDefault,
          config: row.config,
          mailSyncInboundSince: row.mailSyncInboundSince,
          mailSyncOutboundSince: row.mailSyncOutboundSince,
        }),
      );
    },
    /**
     * Two callers, two patches: the watermark advance names the since-fields,
     * the IMAP fromAddress heal names `config`. Each lands only when named —
     * `config` used to fall through `.loose()` and was silently DROPPED, so
     * the heal logged "mirrored" every pass and never wrote.
     */
    'connector_credentials/mutations:patchCredentialInternal': async (
      raw: unknown,
    ) => {
      const args = org
        .extend({
          credentialId: z.string(),
          mailSyncInboundSince: z.number().optional(),
          mailSyncOutboundSince: z.number().optional(),
          config: z
            .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
            .optional(),
        })
        .loose()
        .parse(raw);
      if (args.config !== undefined) {
        await patchCredentialConfigInternal(
          sql,
          args.organizationId,
          args.credentialId,
          args.config,
        );
      }
      if (
        args.mailSyncInboundSince !== undefined ||
        args.mailSyncOutboundSince !== undefined
      ) {
        await patchMailSyncWatermarks(
          sql,
          args.organizationId,
          args.credentialId,
          {
            ...(args.mailSyncInboundSince !== undefined
              ? { inboundSince: args.mailSyncInboundSince }
              : {}),
            ...(args.mailSyncOutboundSince !== undefined
              ? { outboundSince: args.mailSyncOutboundSince }
              : {}),
          },
        );
      }
      return null;
    },

    // ---------------------------------------------------------- recursion
    'connectors/execute_action:runConnectorAction': async (raw: unknown) => {
      const args = z
        .object({
          organizationId: z.string(),
          connector: z.string(),
          action: z.string(),
          input: z.unknown(),
          credentialRef: z.string().optional(),
          mode: z.enum(['mock', 'live']).optional(),
          caller: z.unknown(),
          idempotencyKey: z.string().optional(),
        })
        .loose()
        .parse(raw);
      return runConnector({
        organizationId: args.organizationId,
        connector: args.connector,
        action: args.action,
        input: args.input,
        ...(args.mode !== undefined ? { mode: args.mode } : {}),
        ...(args.credentialRef !== undefined
          ? { credentialRef: args.credentialRef }
          : {}),
        caller: args.caller,
        ...(args.idempotencyKey !== undefined
          ? { idempotencyKey: args.idempotencyKey }
          : {}),
      });
    },
  };
}

/** Store raw bytes into the org's S3 store and answer the blob ref — the
 * 0.4 `storeOrgBlob` contract (the attachments lane's write). */
async function storeOrgBlobBytes(
  sql: Sql,
  args: { organizationId: string; bytes: ArrayBuffer; contentType: string },
): Promise<string> {
  return putOrgBlobBytes(sql, args.organizationId, {
    bytes: new Uint8Array(args.bytes),
    contentType: args.contentType,
  });
}
