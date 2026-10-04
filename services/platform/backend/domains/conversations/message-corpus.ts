import type { Sql, TransactionSql } from 'postgres';

import {
  INDEXED_MESSAGE_CHANNEL,
  INDEXED_MESSAGE_DIRECTION,
  isMessageId,
  messageRef,
} from '../../../lib/knowledge/message-ref.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { queueHolderBlobRetirement } from '../files/retirement.ts';
import { queueRefRelease } from '../knowledge/release-queue.ts';
import { markRagQueued } from '../knowledge/service.ts';

export function mailAttachmentRefs(metadata: unknown): string[] {
  if (
    typeof metadata !== 'object' ||
    metadata === null ||
    !('attachments' in metadata)
  )
    return [];
  const attachments = metadata.attachments;
  if (!Array.isArray(attachments)) return [];
  return [
    ...new Set(
      attachments.flatMap((attachment: unknown) =>
        typeof attachment === 'object' &&
        attachment !== null &&
        'storageId' in attachment &&
        typeof attachment.storageId === 'string'
          ? [attachment.storageId]
          : [],
      ),
    ),
  ];
}

export async function retireConversationAttachments(
  tx: TransactionSql | Sql,
  organizationId: string,
  conversationIds: readonly string[],
): Promise<void> {
  if (conversationIds.length === 0) return;
  const rows = await tx<{ metadata: unknown; owner: string | null }[]>`
    SELECT metadata, attachment_owner_user_id AS owner FROM app.conversation_messages
    WHERE org_id = ${organizationId} AND conversation_id = ANY(${[...conversationIds]}::text[])
      AND direction = 'outbound' AND delivery_state IN ('queued', 'failed')
    FOR UPDATE
  `;
  await queueHolderBlobRetirement(
    tx,
    organizationId,
    rows.map((row) => ({
      refs: mailAttachmentRefs(row.metadata),
      custodianUserIds: row.owner ? [row.owner] : [],
    })),
  );
}

/**
 * The conversation side of the MAIL corpus — the bodies of its inbound email
 * (`rag.index_message`, `domains/knowledge/message-index.ts`) and its emailed
 * attachments (`rag.index_file`, the file rows the email binder bound to it):
 * which of them the corpus may hold, and the jobs a lane that changes them
 * queues in its own transaction — a release when the rows go (delete, the
 * retention window) or are judged junk (a spam verdict), an index when a
 * spam verdict is lifted.
 *
 * Every body read here binds the one definition of an indexed message
 * (`isIndexedMessage`, `lib/knowledge/message-ref.ts`), and every attachment
 * read the one definition of an emailed attachment (an unbound file row bound
 * to the conversation — the rows `emailedAttachmentConversation` stamps, and
 * those whose ref an active document holds, which index as the document), so
 * a lane can never release fewer refs than the indexers wrote.
 */

/** The messages of these conversations the corpus may hold. */
async function indexedMessagesOf(
  tx: TransactionSql | Sql,
  organizationId: string,
  conversationIds: readonly string[],
  options: { readonly nonEmpty?: boolean } = {},
): Promise<string[]> {
  if (conversationIds.length === 0) return [];
  const rows = await tx<{ id: string }[]>`
    SELECT id FROM app.conversation_messages
    WHERE org_id = ${organizationId}
      AND conversation_id = ANY(${[...conversationIds]}::text[])
      AND direction = ${INDEXED_MESSAGE_DIRECTION}
      AND channel = ${INDEXED_MESSAGE_CHANNEL}
      AND connector_name <> ''
      AND (${options.nonEmpty !== true} OR btrim(content) <> '')
  `;
  // An id no ref can carry was never indexed (`messageRef` refuses it).
  return rows.map((row) => row.id).filter(isMessageId);
}

/** The emailed attachments of these conversations: the file rows bound to
 * them and to no document — a file filed into a document is that
 * document's, and the documents lane owns its corpus copy. `indexable`
 * keeps only the live rows not opted out of indexing. */
async function emailedAttachmentsOf(
  tx: TransactionSql | Sql,
  organizationId: string,
  conversationIds: readonly string[],
  options: { readonly indexable?: boolean } = {},
): Promise<{ id: string; storageRef: string }[]> {
  if (conversationIds.length === 0) return [];
  return tx<{ id: string; storageRef: string }[]>`
    SELECT id, storage_ref AS "storageRef" FROM app.file_metadata
    WHERE org_id = ${organizationId}
      AND conversation_id = ANY(${[...conversationIds]}::text[])
      AND document_id IS NULL
      AND storage_ref IS NOT NULL
      AND (${options.indexable !== true}
           OR (skip_rag_indexing IS DISTINCT FROM true
               AND (lifecycle_status IS NULL
                    OR lifecycle_status = 'active')))
  `;
}

/** The corpus refs of these conversations' indexed email bodies — read
 * BEFORE the rows go, since the refs are the messages' ids. */
export async function indexedMessageRefsOf(
  tx: TransactionSql | Sql,
  organizationId: string,
  conversationIds: readonly string[],
): Promise<string[]> {
  return (await indexedMessagesOf(tx, organizationId, conversationIds)).map(
    messageRef,
  );
}

/**
 * The corpus refs of all these conversations' mail: the message refs of
 * their indexed email bodies and the blob refs of their emailed
 * attachments — read BEFORE the rows go.
 */
export async function mailRefsOf(
  tx: TransactionSql | Sql,
  organizationId: string,
  conversationIds: readonly string[],
): Promise<string[]> {
  const bodies = await indexedMessageRefsOf(
    tx,
    organizationId,
    conversationIds,
  );
  const attachments = await emailedAttachmentsOf(
    tx,
    organizationId,
    conversationIds,
  );
  return [...bodies, ...attachments.map((file) => file.storageRef)];
}

/**
 * Queue the release of these mail refs in the caller's transaction. The job
 * runs once the transaction commits and releases every corpus copy its
 * liveness check reads as dead (`liveness.ts`) — the rows the caller
 * deleted, a conversation it deleted or marked spam — so the network I/O
 * never runs inside the caller's transaction, and a rolled-back caller
 * queues nothing. An attachment's bytes stay while its file row does: only
 * its corpus copy dies with its conversation. A job that exhausts its
 * retries is the daily corpus reconcile's to finish; the retrievable filter
 * refuses those rows meanwhile. The jobs are bounded as every lane that
 * releases more than one ref bounds them (`queueRefRelease`), and an enqueue
 * that fails fails the caller's transaction.
 */
export async function queueMessageRefRelease(
  tx: TransactionSql | Sql,
  organizationId: string,
  refs: readonly string[],
): Promise<void> {
  await queueRefRelease(tx, organizationId, refs);
}

/**
 * Queue the indexing of these conversations' email bodies in the caller's
 * transaction — what lifting a spam verdict does, since a spam body was
 * never embedded and its copy was released. One job per message, as at
 * ingest; the indexer is idempotent, so a body the corpus still holds
 * embeds nothing again.
 */
async function queueMessageIndexing(
  tx: TransactionSql | Sql,
  organizationId: string,
  conversationIds: readonly string[],
): Promise<void> {
  const ids = await indexedMessagesOf(tx, organizationId, conversationIds, {
    nonEmpty: true,
  });
  for (const messageId of ids) {
    await addJobInTx(tx, 'rag.index_message', { messageId });
  }
}

/**
 * Queue the indexing of these conversations' emailed attachments in the
 * caller's transaction — what lifting a spam verdict does, since a spam
 * attachment is never embedded and its copy was released. One job per file,
 * as at the bind; the indexer is idempotent, so an attachment the corpus
 * still holds embeds nothing again. A file opted out of indexing stays out.
 */
async function queueAttachmentIndexing(
  tx: TransactionSql | Sql,
  organizationId: string,
  conversationIds: readonly string[],
): Promise<void> {
  const files = await emailedAttachmentsOf(
    tx,
    organizationId,
    conversationIds,
    { indexable: true },
  );
  for (const file of files) {
    await markRagQueued(tx, file.id);
    await addJobInTx(tx, 'rag.index_file', { fileId: file.id });
  }
}

/**
 * What a status flip does to the corpus copies of conversations' mail,
 * queued in the flip's own transaction: a conversation newly marked spam has
 * its email bodies and its attachments released (liveness reads a spam
 * conversation's mail as dead), and one whose spam verdict was lifted has
 * them indexed again. Any other flip leaves the corpus alone.
 */
export async function queueSpamVerdictCorpusJobs(
  tx: TransactionSql | Sql,
  organizationId: string,
  flips: readonly {
    readonly conversationId: string;
    readonly from: string | null;
    readonly to: string;
  }[],
): Promise<void> {
  const marked = flips
    .filter((flip) => flip.to === 'spam' && flip.from !== 'spam')
    .map((flip) => flip.conversationId);
  const lifted = flips
    .filter((flip) => flip.from === 'spam' && flip.to !== 'spam')
    .map((flip) => flip.conversationId);
  await queueMessageRefRelease(
    tx,
    organizationId,
    await mailRefsOf(tx, organizationId, marked),
  );
  await queueMessageIndexing(tx, organizationId, lifted);
  await queueAttachmentIndexing(tx, organizationId, lifted);
}
