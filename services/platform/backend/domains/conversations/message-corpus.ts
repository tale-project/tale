import type { Sql, TransactionSql } from 'postgres';

import {
  INDEXED_MESSAGE_CHANNEL,
  INDEXED_MESSAGE_DIRECTION,
  isMessageId,
  messageRef,
} from '../../../lib/knowledge/message-ref.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';

/**
 * The conversation side of the email-body corpus (`rag.index_message`,
 * `domains/knowledge/message-index.ts`): which of a conversation's messages
 * the corpus may hold, and the jobs a lane that changes them queues in its
 * own transaction — a release when the rows go (delete, the retention
 * window, a spam verdict), an index when a spam verdict is lifted.
 *
 * Every read here binds the one definition of an indexed message
 * (`isIndexedMessage`, `lib/knowledge/message-ref.ts`), so a lane can never
 * release fewer refs than the indexer wrote.
 */

/** Refs per `knowledge.release_refs` job: a retention batch can purge a
 * thousand conversations at once, and one job's payload stays bounded. */
const RELEASE_REFS_PER_JOB = 500;

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
 * Queue the release of these message refs in the caller's transaction. The
 * job runs once the transaction commits and releases every ref its liveness
 * check reads as dead (`assessMessageRefLiveness`) — the rows the caller
 * deleted, a conversation it marked spam — so the network I/O never runs
 * inside the caller's transaction, and a rolled-back caller queues nothing.
 * A job that exhausts its retries is the daily corpus reconcile's to
 * finish; the retrievable filter refuses those rows meanwhile.
 */
export async function queueMessageRefRelease(
  tx: TransactionSql | Sql,
  organizationId: string,
  refs: readonly string[],
): Promise<void> {
  for (let at = 0; at < refs.length; at += RELEASE_REFS_PER_JOB) {
    await addJobInTx(tx, 'knowledge.release_refs', {
      organizationId,
      refs: refs.slice(at, at + RELEASE_REFS_PER_JOB),
    });
  }
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
 * What a status flip does to the corpus copies of conversations' email
 * bodies, queued in the flip's own transaction: a conversation newly marked
 * spam has its bodies released (liveness reads a spam conversation's
 * messages as dead), and one whose spam verdict was lifted has them indexed
 * again. Any other flip leaves the corpus alone.
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
    await indexedMessageRefsOf(tx, organizationId, marked),
  );
  await queueMessageIndexing(tx, organizationId, lifted);
}
