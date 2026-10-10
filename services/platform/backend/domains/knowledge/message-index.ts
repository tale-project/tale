import type { Sql } from 'postgres';

import {
  messageBodyText,
  messageCorpusNames,
  messageCorrespondent,
} from '../../../lib/knowledge/message-body.ts';
import {
  isIndexedMessage,
  isMessageId,
  messageRef,
} from '../../../lib/knowledge/message-ref.ts';
import {
  AUTOMATION_SUBJECT_ID,
  EMBEDDING_SLUG,
} from '../../../lib/shared/constants/usage.ts';
import { isRecord } from '../../../lib/utils/type-utils.ts';
import { NO_SUBJECT } from '../../core/conversations/ingest/constants.ts';
import { readOrgEmbeddingConfig } from '../../core/knowledge/connection.ts';
import {
  EmbeddingDimensionMismatch,
  UnsupportedVectorWidth,
} from '../../core/knowledge/dimensions.ts';
import {
  classifyEmbeddingFailure,
  EmbeddingBudgetExceeded,
  EmbeddingNotConfigured,
  embedderForOrg,
} from '../../core/knowledge/embedding.ts';
import { indexWholeDocument } from '../../core/knowledge/indexing.ts';
import { parsePiiConfig } from '../../core/knowledge/pii_gate.ts';
import {
  getKnowledgePoolForOrg,
  resolveOrgUrl,
} from '../../core/knowledge/pool.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { createCtxShim } from '../../lib/ctx-shim.ts';
import { readGovernancePolicy, resolveOrgSlug } from '../../lib/org-config.ts';
import { budgetRefusalMessage } from '../governance/budget-refusal.ts';
import type { DirectCallSubject } from '../governance/direct-calls.ts';
import { embeddingBlocked, embeddingMeter } from './embedding-meter.ts';
import { isMessageCorpusLive } from './liveness.ts';
import { knowledgeShimHandlers } from './service.ts';

/** Inbound mail is nobody's spend: its embedding books to the organization. */
const MAIL_EMBEDDING_SUBJECT: DirectCallSubject = {
  userId: AUTOMATION_SUBJECT_ID,
  agentSlug: EMBEDDING_SLUG,
};

/** How long a message a usage limit refused waits before it is tried
 * again — sooner when the limit's period resets first. */
const USAGE_LIMIT_RETRY_MS = 60 * 60 * 1000;

/**
 * Put a message a usage limit refused back in the queue, to be tried again
 * once the limit may allow it: in an hour, or just after its period resets
 * when that comes first. A message has no status row to park it on, so its
 * job carries the wait — one waiting job per message: when a job for it is
 * already queued, that job takes the turn. The queue's default policy reads
 * a singleton key as a label only (`jobs/tasks.ts`), so the waiting job is
 * looked for rather than keyed.
 */
async function deferForUsageLimit(
  sql: Sql,
  messageId: string,
  reason: string,
  resetsAtMs: number | undefined,
): Promise<void> {
  const queued = await sql<{ id: string }[]>`
    SELECT id FROM pgboss.job
    WHERE name = 'rag.index_message' AND state IN ('created', 'retry')
      AND data->>'messageId' = ${messageId}
    LIMIT 1
  `;
  if (queued.length > 0) {
    console.info('[knowledge] email body already waits for a usage limit', {
      messageId,
      reason,
    });
    return;
  }
  const now = Date.now();
  const at =
    resetsAtMs !== undefined && resetsAtMs > now
      ? Math.min(now + USAGE_LIMIT_RETRY_MS, resetsAtMs + 60_000)
      : now + USAGE_LIMIT_RETRY_MS;
  await addJobInTx(
    sql,
    'rag.index_message',
    { messageId },
    { startAfter: new Date(at) },
  );
  console.info('[knowledge] email body waits for a usage limit', {
    messageId,
    retryAt: new Date(at).toISOString(),
    reason,
  });
}

/**
 * Index one inbound email's BODY into its organization's corpus — the
 * `rag.index_message` job, enqueued by `addMessageToConversation` in the
 * transaction that stores the message.
 *
 * The covering note is where the context of an emailed attachment usually
 * lives — the role an applicant names, the order a complaint is about — and
 * until now no retrieval leg could reach it. The body indexes under its
 * message ref (`msg:<message id>`) with its conversation stamped: that keeps
 * the row out of the hub clause (every scope column NULL reads as org-wide),
 * marks it as mail for the readers that wrap mail as untrusted, and names the
 * conversation the retrievable filter decides it by.
 *
 * What differs from a file's indexing:
 *
 *  - No status row. Nothing in the app shows an email's indexing state, so an
 *    outcome that no retry can change — no embedding model, a refused
 *    credential, a vector-width mismatch, the secret scan, the PII policy —
 *    ends the job quietly with a log line; a transient one (the provider, the
 *    corpus, a BM25 rebuild) throws, and the job's retry ladder runs it again.
 *    A message that never indexes is still found by the conversation search's
 *    keyword walk.
 *  - The secret scan reads the TEXT. A mail carries reset links and one-time
 *    passwords as often as a file carries keys, and a credential in the corpus
 *    is read back into a model's context — so the body goes through the same
 *    refusal as an upload. It scans what would be indexed, not the raw HTML:
 *    a token in a tracking pixel never reaches the corpus anyway. The chunk
 *    header (subject and sender) is indexed text too, so it is scanned with
 *    the body, and the PII policy masks or refuses it like the body
 *    (`prepareDocument`).
 *  - Liveness is the message row's (`isMessageCorpusLive`), asked after the
 *    corpus row is claimed: a conversation deleted while the job waited is
 *    never indexed back.
 *  - Its embedding is the organization's spend (`__automation__`), held
 *    and booked request by request (`embedding-meter.ts`). A usage limit
 *    that binds it — checked before anything is read, and on every request
 *    — puts the job back in the queue for later (`deferForUsageLimit`);
 *    the slices already stored stay, and the retry resumes after them.
 *
 * Idempotent: a retry, or a second delivery, finds the content unchanged and
 * embeds nothing.
 */
export async function indexConversationMessage(
  sql: Sql,
  messageId: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<void> {
  // An id no ref can carry names nothing the corpus could serve.
  if (!isMessageId(messageId)) return;
  const rows = await sql<
    {
      organizationId: string;
      conversationId: string;
      channel: string;
      direction: string;
      connectorName: string | null;
      content: string;
      metadata: unknown;
      sentAt: number;
      conversationStatus: string | null;
      conversationSubject: string | null;
      contactName: string | null;
      contactEmail: string | null;
    }[]
  >`
    SELECT m.org_id AS "organizationId", m.conversation_id AS "conversationId",
           m.channel, m.direction, m.connector_name AS "connectorName",
           m.content, m.metadata,
           coalesce(m.sent_at_ms, m.delivered_at_ms, m.created_at_ms)::float8
             AS "sentAt",
           c.status AS "conversationStatus", c.subject AS "conversationSubject",
           ct.name AS "contactName", ct.email AS "contactEmail"
    FROM app.conversation_messages m
    JOIN app.conversations c
      ON c.id = m.conversation_id AND c.org_id = m.org_id
    LEFT JOIN app.contacts ct
      ON ct.id = c.contact_id AND ct.org_id = m.org_id
    WHERE m.id = ${messageId}
    LIMIT 1
  `;
  const message = rows[0];
  // Gone before the job ran (the conversation was deleted), or not a message
  // the corpus holds — nothing to index, nothing to retry. Nor is mail the
  // organization has marked spam: junk an outsider wrote is never sent to
  // the embedding provider, and lifting the verdict queues it again
  // (`conversations/message-corpus.ts`). A verdict that lands while this job
  // runs is seen by the liveness check after the claim.
  if (!message || !isIndexedMessage(message)) return;
  if (message.conversationStatus === 'spam') return;
  const text = messageBodyText(message.content, message.metadata);
  // An empty body — no text, or markup and images alone — matches nothing
  // and would cost a corpus row.
  if (text === '') return;
  const orgSlug = await resolveOrgSlug(sql, message.organizationId);
  if (orgSlug === null) return;

  const names = messageCorpusNames({
    subject: messageSubject(message.metadata, message.conversationSubject),
    correspondent:
      messageCorrespondent(message.metadata) ??
      message.contactName ??
      message.contactEmail,
  });
  const sentAt = new Date(message.sentAt);
  const log = { messageId, orgSlug };
  const blocked = await embeddingBlocked(sql, {
    organizationId: message.organizationId,
    subject: MAIL_EMBEDDING_SUBJECT,
  });
  if (blocked !== null) {
    await deferForUsageLimit(
      sql,
      messageId,
      budgetRefusalMessage(blocked),
      blocked.resetsAt,
    );
    return;
  }
  try {
    const config = await readOrgEmbeddingConfig(orgSlug);
    const embedder = await embedderForOrg(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reused 0.4 module; ctx usage covered by the shim handlers
      createCtxShim(knowledgeShimHandlers(sql)) as unknown as Parameters<
        typeof embedderForOrg
      >[0],
      {
        organizationId: message.organizationId,
        orgSlug,
        config,
        meter: embeddingMeter(sql, {
          organizationId: message.organizationId,
          subject: MAIL_EMBEDDING_SUBJECT,
        }),
      },
    );
    const pool = await getKnowledgePoolForOrg(orgSlug);
    const dbUrl = await resolveOrgUrl(orgSlug);
    const piiPolicy = await readGovernancePolicy(orgSlug, 'pii_config').catch(
      () => null,
    );
    const result = await indexWholeDocument({
      sql: pool,
      dbUrl,
      orgSlug,
      fileId: messageRef(messageId),
      filename: names.filename,
      text,
      // The header is indexed text too (`prepareDocument`), so the subject
      // is scanned with the body: a reset code in a subject line would
      // otherwise head every chunk.
      bytes: new TextEncoder().encode(`${names.title}\n\n${text}`),
      embedder,
      piiConfig: parsePiiConfig(piiPolicy),
      folderPath: null,
      teamIds: null,
      projectId: null,
      conversationId: message.conversationId,
      title: names.title,
      sourceCreatedAt: sentAt,
      sourceModifiedAt: sentAt,
      signal: options.signal,
      stillWanted: () =>
        isMessageCorpusLive(sql, {
          organizationId: message.organizationId,
          messageId,
        }),
    });
    if (
      result.skipped === 'secret-detected' ||
      result.skipped === 'pii-blocked'
    ) {
      // The refusal is on the corpus row; the mail stays out of the index.
      console.info(
        `[knowledge] email body not indexed: ${result.skipped}`,
        log,
      );
    }
  } catch (error) {
    // pg-boss gave up on the job (its budget, a shutdown) and owns the retry.
    if (options.signal?.aborted) throw error;
    if (error instanceof EmbeddingBudgetExceeded) {
      await deferForUsageLimit(sql, messageId, error.message, error.retryAtMs);
      return;
    }
    if (error instanceof EmbeddingNotConfigured) {
      console.info(
        '[knowledge] email body not indexed: the organization has no embedding model',
        log,
      );
      return;
    }
    const refusal = classifyEmbeddingFailure(error);
    if (
      error instanceof EmbeddingDimensionMismatch ||
      error instanceof UnsupportedVectorWidth ||
      refusal === 'unresolved' ||
      refusal === 'credit' ||
      refusal === 'credential'
    ) {
      // Every retry would answer the same refusal; an admin fixes the model
      // or the provider for the mail that arrives after.
      console.warn('[knowledge] email body not indexed: embedding refused', {
        ...log,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    throw error;
  }
}

/** The subject a message's header announces: its own (a reply's `Re: …`),
 * else its conversation's — never the stored no-subject placeholder, which is
 * not prose and must not be indexed as if it were. */
function messageSubject(
  metadata: unknown,
  conversationSubject: string | null,
): string | null {
  const own =
    isRecord(metadata) && typeof metadata.subject === 'string'
      ? metadata.subject
      : null;
  for (const candidate of [own, conversationSubject]) {
    const subject = candidate?.trim() ?? '';
    if (subject !== '' && subject !== NO_SUBJECT) return subject;
  }
  return null;
}
