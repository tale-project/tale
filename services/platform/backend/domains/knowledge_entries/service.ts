import { createHash } from 'node:crypto';

import type { Sql, TransactionSql } from 'postgres';

import { authorizeRls } from '../../auth/access.ts';
import { KNOWLEDGE_SOURCE_PROVIDER } from '../../core/knowledge_entries/constants.ts';
import { validateTopicAndContent } from '../../core/knowledge_entries/helpers.ts';
import { toJson } from '../../db/sql.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import {
  buildObjectKey,
  resolveObjectStore,
  s3PresignPutUrl,
} from '../../lib/object-store.ts';
import { resolveOrgSlug } from '../../lib/org-config.ts';
import { wordStartPatterns } from '../../lib/word-match.ts';
import { markRagQueued } from '../knowledge/service.ts';

/**
 * User-contributed knowledge entries — the 0.5 twin of
 * `convex/knowledge_entries/*` (validators REUSED): topic-keyed markdown
 * facts with a supersede version chain, each ACTIVE row backed by a
 * documents row (`source_provider: 'knowledge'`) so indexing/citations/
 * scoping/deletion ride the document pipeline.
 *
 * One deliberate 0.5 simplification: versions RE-MATERIALIZE under the SAME
 * file row and document — but the corpus is keyed by the BLOB REF that row
 * carries (`indexUploadedFile` passes `storage_ref` as the corpus
 * `file_id`), so rotating the ref moves the entry to a NEW corpus key. The
 * rotate branch therefore enqueues `knowledge.release_refs` for the
 * previous ref in the same transaction: the shared release seam de-indexes
 * its corpus rows and deletes its blob (nothing else references an entry's
 * blobs — no `historyFiles`; the version chain keeps every version's full
 * content on its entry row instead, same audit/undo surface). Deletion
 * soft-deletes the chain and trashes the backing document — the
 * retrievability filter excludes trashed documents, so the corpus rows go
 * dark immediately, and the retention purge releases them physically (lazy
 * cleanup posture). The reverse holds too: a backing document hidden or
 * removed through ANY other door — the Documents tab's purge, a WebDAV
 * DELETE, the retention sweep's expiry flip into the Trash and its later
 * purge — soft-deletes its entry chain via
 * `markEntryChainDeletedForDocument` / `markEntryChainsDeletedForDocuments`,
 * so a trashed or expired document never leaves an entry listed, counted
 * and served to the agent leg while its corpus rows are dark — the 0.4
 * `deleteDocument → markEntryChainDeleted` contract.
 *
 * Mutations are role-gated at this seam (`authorizeRls(role, 'knowledge',
 * 'write')`): entries materialize `app.documents` rows and feed the org's
 * RAG corpus, so a read-only member must not be able to plant or edit them
 * through the app or REST lanes.
 */

export class KnowledgeEntryError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404 | 409 | 503;
  constructor(
    code: string,
    message: string,
    status: 400 | 403 | 404 | 409 | 503 = 400,
  ) {
    super(message);
    this.name = 'KnowledgeEntryError';
    this.code = code;
    this.status = status;
  }
}

/** The write gate every mutation lane (app routes, REST) funnels through:
 * entries materialize documents rows and feed the RAG corpus, so the
 * `knowledge` write grant (editor and up) is required. */
function assertCanWriteEntries(role: string | undefined): void {
  if (!authorizeRls(role, 'knowledge', 'write')) {
    throw new KnowledgeEntryError(
      'KNOWLEDGE_ENTRY_FORBIDDEN',
      'Your role cannot modify knowledge entries',
      403,
    );
  }
}

function validate(
  topic: string,
  content: string,
): { topic: string; topicKey: string; content: string } {
  try {
    return validateTopicAndContent(topic, content);
  } catch (error) {
    // The reused validator throws AppError with {code}; re-shape it.
    const code =
      error !== null &&
      typeof error === 'object' &&
      'data' in error &&
      error.data !== null &&
      typeof error.data === 'object' &&
      'code' in error.data &&
      typeof error.data.code === 'string'
        ? error.data.code
        : 'KNOWLEDGE_ENTRY_INVALID';
    throw new KnowledgeEntryError(code, 'Invalid topic or content');
  }
}

interface ActiveEntry {
  id: string;
  topic: string;
  documentId: string | null;
}

async function findActiveByTopicKey(
  tx: TransactionSql | Sql,
  organizationId: string,
  topicKey: string,
): Promise<ActiveEntry | null> {
  const rows = await tx<ActiveEntry[]>`
    SELECT id, topic, document_id AS "documentId"
    FROM app.knowledge_entries
    WHERE org_id = ${organizationId} AND topic_key = ${topicKey}
      AND status = 'active' AND deleted_at_ms IS NULL
    LIMIT 1
  `;
  return rows[0] ?? null;
}

interface StoredEntryBlob {
  storageRef: string;
  size: number;
  contentHash: string;
}

/** How long the object store gets to accept an entry's markdown. Node's
 * `fetch` has no timeout of its own: a stalled connection held the request
 * (and the caller's spinner) indefinitely, with its rate-limit token spent. */
const ENTRY_BLOB_STORE_TIMEOUT_MS = 30_000;

/** Upload the entry's markdown BEFORE the transaction — the write path never
 * holds a tx open over network I/O; an orphaned blob from a failed tx is
 * inert (never referenced). */
async function storeEntryBlob(
  sql: Sql,
  organizationId: string,
  content: string,
): Promise<StoredEntryBlob> {
  const orgSlug = await resolveOrgSlug(sql, organizationId);
  if (orgSlug === null) {
    throw new KnowledgeEntryError('ORG_NOT_FOUND', 'Unknown organization', 404);
  }
  const store = await resolveObjectStore(orgSlug);
  const key = buildObjectKey(store, orgSlug);
  const bytes = new TextEncoder().encode(content);
  const putUrl = await s3PresignPutUrl(store, key, {
    contentType: 'text/markdown',
  });
  let putRes: Response;
  try {
    putRes = await fetch(putUrl, {
      method: 'PUT',
      headers: { 'content-type': 'text/markdown' },
      body: bytes,
      signal: AbortSignal.timeout(ENTRY_BLOB_STORE_TIMEOUT_MS),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'TimeoutError' || error.name === 'AbortError')
    ) {
      throw new KnowledgeEntryError(
        'KNOWLEDGE_ENTRY_STORE_TIMEOUT',
        `The object store did not accept the entry within ${ENTRY_BLOB_STORE_TIMEOUT_MS / 1000} seconds. Try again; if it keeps happening, check the object store.`,
        503,
      );
    }
    throw error;
  }
  if (!putRes.ok) {
    throw new Error(`knowledge entry blob store failed: ${putRes.status}`);
  }
  return {
    storageRef: `s3:${key}`,
    size: bytes.byteLength,
    contentHash: createHash('sha256').update(content).digest('hex'),
  };
}

/**
 * Keep the entry's backing document + file row in step with a stored blob:
 * the first version mints the file row + documents row; a re-materialize
 * rotates the blob REF on the same file row and re-enqueues indexing (the
 * corpus replaces by file id). Returns the document id.
 */
async function attachEntryDocument(
  tx: TransactionSql,
  args: {
    organizationId: string;
    entryId: string;
    topic: string;
    blob: StoredEntryBlob;
    createdBy: string;
    existingDocumentId: string | null;
  },
): Promise<string> {
  const { storageRef, size, contentHash } = args.blob;
  const fileName = `${args.topic}.md`;
  const now = Date.now();

  if (args.existingDocumentId !== null) {
    // Same document, same FILE row — but the corpus is keyed by the blob
    // REF, so this rotation re-materializes the entry under a new corpus
    // key. Capture the outgoing ref first: the release job below de-indexes
    // its corpus rows and deletes its blob (nothing else references it),
    // instead of stranding one unpurgeable corpus document per edit.
    const previous = await tx<{ storageRef: string }[]>`
      SELECT storage_ref AS "storageRef" FROM app.file_metadata
      WHERE document_id = ${args.existingDocumentId}
      LIMIT 1
    `;
    const previousRef = previous[0]?.storageRef ?? null;
    await tx`
      UPDATE app.documents SET
        title = ${fileName}, file_ref = ${storageRef},
        mime_type = 'text/markdown', extension = 'md',
        metadata = coalesce(metadata, '{}'::jsonb)
          || jsonb_build_object('contentHash', ${contentHash}::text),
        updated_at_ms = ${now}
      WHERE id = ${args.existingDocumentId}
    `;
    // The rotated blob is new content: whatever the previous version's
    // indexing left behind (a failure and its code) no longer describes it.
    const files = await tx<{ id: string }[]>`
      UPDATE app.file_metadata SET
        storage_ref = ${storageRef}, file_name = ${fileName},
        size = ${size}, rag_error = NULL, rag_error_code = NULL
      WHERE document_id = ${args.existingDocumentId}
      RETURNING id
    `;
    const fileId = files[0]?.id;
    if (fileId !== undefined) {
      // The producer idiom: `queued` from the enqueue on, not NULL until the
      // worker's first write. NULL read as "Not indexed" in the UI, and a job
      // lost after its retries left the row there forever — the indexing
      // watchdog only reconciles `queued`/`running` rows.
      await markRagQueued(tx, fileId);
      await addJobInTx(tx, 'rag.index_file', { fileId });
    }
    if (previousRef !== null && previousRef !== storageRef) {
      await addJobInTx(tx, 'knowledge.release_refs', {
        organizationId: args.organizationId,
        refs: [previousRef],
      });
    }
    await tx`
      UPDATE app.knowledge_entries SET
        document_id = ${args.existingDocumentId}
      WHERE id = ${args.entryId}
    `;
    return args.existingDocumentId;
  }

  const files = await tx<{ id: string }[]>`
    INSERT INTO app.file_metadata (
      org_id, storage_ref, file_name, content_type, size, source,
      uploaded_by, created_at_ms
    ) VALUES (
      ${args.organizationId}, ${storageRef}, ${fileName}, 'text/markdown',
      ${size}, 'knowledge', ${args.createdBy}, ${now}
    ) RETURNING id
  `;
  const fileId = files[0]?.id;
  if (!fileId) throw new Error('knowledge entry file insert failed');
  const docs = await tx<{ id: string }[]>`
    INSERT INTO app.documents (
      org_id, title, file_ref, mime_type, extension, source_provider,
      team_tags, created_by, metadata, created_at_ms, updated_at_ms
    ) VALUES (
      ${args.organizationId}, ${fileName}, ${storageRef}, 'text/markdown',
      'md', ${KNOWLEDGE_SOURCE_PROVIDER}, ${[]}::text[], ${args.createdBy},
      ${tx.json(toJson({ contentHash }))}, ${now}, ${now}
    ) RETURNING id
  `;
  const documentId = docs[0]?.id;
  if (!documentId) throw new Error('knowledge entry document insert failed');
  await tx`
    UPDATE app.file_metadata SET document_id = ${documentId}
    WHERE id = ${fileId}
  `;
  await tx`
    UPDATE app.knowledge_entries SET document_id = ${documentId}
    WHERE id = ${args.entryId}
  `;
  await markRagQueued(tx, fileId);
  await addJobInTx(tx, 'rag.index_file', { fileId });
  return documentId;
}

export async function createKnowledgeEntry(
  sql: Sql,
  args: {
    organizationId: string;
    userId: string;
    role: string;
    topic: string;
    content: string;
    source?: 'chat' | 'manual';
    sourceThreadId?: string;
    sourceMessageId?: string;
  },
): Promise<string> {
  assertCanWriteEntries(args.role);
  const { topic, topicKey, content } = validate(args.topic, args.content);
  const precheck = await findActiveByTopicKey(
    sql,
    args.organizationId,
    topicKey,
  );
  if (precheck) {
    throw new KnowledgeEntryError(
      'KNOWLEDGE_ENTRY_DUPLICATE',
      `An entry for "${precheck.topic}" already exists`,
      409,
    );
  }
  const blob = await storeEntryBlob(sql, args.organizationId, content);
  return sql.begin(async (tx) => {
    const existing = await findActiveByTopicKey(
      tx,
      args.organizationId,
      topicKey,
    );
    if (existing) {
      throw new KnowledgeEntryError(
        'KNOWLEDGE_ENTRY_DUPLICATE',
        `An entry for "${existing.topic}" already exists`,
        409,
      );
    }
    const rows = await tx<{ id: string }[]>`
      INSERT INTO app.knowledge_entries (
        org_id, topic, topic_key, content, status, source,
        source_thread_id, source_message_id, created_by, created_at_ms
      ) VALUES (
        ${args.organizationId}, ${topic}, ${topicKey}, ${content}, 'active',
        ${args.source ?? 'manual'}, ${args.sourceThreadId ?? null},
        ${args.sourceMessageId ?? null}, ${args.userId}, ${Date.now()}
      ) RETURNING id
    `;
    const entryId = rows[0]?.id;
    if (!entryId) throw new Error('knowledge entry insert failed');
    await attachEntryDocument(tx, {
      organizationId: args.organizationId,
      entryId,
      topic,
      blob,
      createdBy: args.userId,
      existingDocumentId: null,
    });
    return entryId;
  });
}

/** Write a NEW active version onto the topic chain (supersede the old). */
export async function updateKnowledgeEntry(
  sql: Sql,
  args: {
    organizationId: string;
    userId: string;
    role: string;
    entryId: string;
    topic: string;
    content: string;
  },
): Promise<string> {
  assertCanWriteEntries(args.role);
  const { topic, topicKey, content } = validate(args.topic, args.content);
  const blob = await storeEntryBlob(sql, args.organizationId, content);
  return sql.begin(async (tx) => {
    // The backing document must still be ACTIVE: a version written onto a
    // trashed document would rotate its blob and index content nobody can
    // retrieve (the filter excludes trashed documents). Such an entry is
    // gone from the caller's point of view, so it answers as not found.
    const currents = await tx<
      { id: string; topicKey: string; documentId: string | null }[]
    >`
      SELECT ke.id, ke.topic_key AS "topicKey", ke.document_id AS "documentId"
      FROM app.knowledge_entries ke
      LEFT JOIN app.documents d ON d.id = ke.document_id
      WHERE ke.id = ${args.entryId} AND ke.org_id = ${args.organizationId}
        AND ke.status = 'active' AND ke.deleted_at_ms IS NULL
        AND (d.id IS NULL OR d.lifecycle_status IS NULL
             OR d.lifecycle_status = 'active')
      LIMIT 1
    `;
    const current = currents[0];
    if (!current) {
      throw new KnowledgeEntryError(
        'KNOWLEDGE_ENTRY_NOT_FOUND',
        'Entry not found',
        404,
      );
    }
    if (topicKey !== current.topicKey) {
      // A topic rename lands on ANOTHER chain — refuse a silent collision.
      const clash = await findActiveByTopicKey(
        tx,
        args.organizationId,
        topicKey,
      );
      if (clash && clash.id !== current.id) {
        throw new KnowledgeEntryError(
          'KNOWLEDGE_ENTRY_DUPLICATE',
          `An entry for "${clash.topic}" already exists`,
          409,
        );
      }
    }
    const now = Date.now();
    const rows = await tx<{ id: string }[]>`
      INSERT INTO app.knowledge_entries (
        org_id, topic, topic_key, content, status, document_id, source,
        created_by, created_at_ms
      ) VALUES (
        ${args.organizationId}, ${topic}, ${topicKey}, ${content}, 'active',
        ${current.documentId}, 'manual', ${args.userId}, ${now}
      ) RETURNING id
    `;
    const entryId = rows[0]?.id;
    if (!entryId) throw new Error('knowledge entry insert failed');
    await tx`
      UPDATE app.knowledge_entries SET
        status = 'superseded', superseded_by = ${entryId},
        superseded_at_ms = ${now}
      WHERE id = ${current.id}
    `;
    await attachEntryDocument(tx, {
      organizationId: args.organizationId,
      entryId,
      topic,
      blob,
      createdBy: args.userId,
      existingDocumentId: current.documentId,
    });
    return entryId;
  });
}

/**
 * Soft-delete every version of the entry chain a document backs — the hook
 * every path that trashes or purges a document calls, so a knowledge entry
 * can never outlive its backing document. Org-scoped and keyed by the
 * DOCUMENT alone: every version of a chain re-materializes onto the same
 * document (`attachEntryDocument` rotates the existing one), so the document
 * IS the chain. Never hop through the topic key — a deleted chain's key is
 * free for a new entry (`findActiveByTopicKey` ignores deleted rows), and a
 * late purge of the OLD document must not retire the NEW chain that reused
 * it. Returns how many rows were marked; zero when the document backs no
 * entry.
 */
export async function markEntryChainDeletedForDocument(
  tx: TransactionSql | Sql,
  organizationId: string,
  documentId: string,
): Promise<number> {
  return markEntryChainsDeletedForDocuments(tx, organizationId, [documentId]);
}

/**
 * The batch form of {@link markEntryChainDeletedForDocument} for a door that
 * hides many documents at once (the retention sweep's expiry flip): one
 * statement for the whole batch, the same predicate. Zero documents is a
 * no-op.
 */
export async function markEntryChainsDeletedForDocuments(
  tx: TransactionSql | Sql,
  organizationId: string,
  documentIds: readonly string[],
): Promise<number> {
  if (documentIds.length === 0) return 0;
  const result = await tx`
    UPDATE app.knowledge_entries SET deleted_at_ms = ${Date.now()}
    WHERE org_id = ${organizationId} AND document_id = ANY(${[...documentIds]})
      AND deleted_at_ms IS NULL
  `;
  return result.count;
}

/** Soft-delete the whole topic chain and trash the backing document — the
 * retrievability filter excludes trashed documents, so RAG goes dark now. */
export async function deleteKnowledgeEntry(
  sql: Sql,
  args: { organizationId: string; entryId: string; role: string },
): Promise<void> {
  assertCanWriteEntries(args.role);
  await sql.begin(async (tx) => {
    const rows = await tx<{ topicKey: string; documentId: string | null }[]>`
      SELECT topic_key AS "topicKey", document_id AS "documentId"
      FROM app.knowledge_entries
      WHERE id = ${args.entryId} AND org_id = ${args.organizationId}
      LIMIT 1
    `;
    const entry = rows[0];
    if (!entry) {
      throw new KnowledgeEntryError(
        'KNOWLEDGE_ENTRY_NOT_FOUND',
        'Entry not found',
        404,
      );
    }
    const now = Date.now();
    await tx`
      UPDATE app.knowledge_entries SET deleted_at_ms = ${now}
      WHERE org_id = ${args.organizationId}
        AND topic_key = ${entry.topicKey} AND deleted_at_ms IS NULL
    `;
    if (entry.documentId !== null) {
      await tx`
        UPDATE app.documents SET
          lifecycle_status = 'trashed', status_changed_at_ms = ${now},
          updated_at_ms = ${now}
        WHERE id = ${entry.documentId}
          AND org_id = ${args.organizationId}
      `;
    }
  });
}

export interface KnowledgeEntryRow {
  id: string;
  topic: string;
  content: string;
  source: string;
  documentId: string | null;
  createdBy: string;
  createdAt: number;
}

export async function listKnowledgeEntries(
  sql: Sql,
  organizationId: string,
  options: {
    cursor?: number;
    limit?: number;
    topic?: string;
    /** Also match a topic on any meaningful WORD of `topic`, not only on the
     *  whole string. Opt-in, because only the chat leg passes a question
     *  here — the entries page passes what the reader typed. */
    matchWords?: boolean;
  } = {},
): Promise<{ rows: KnowledgeEntryRow[]; nextCursor: number | null }> {
  const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
  const topicLower = options.topic?.trim().toLowerCase() || null;
  const words =
    options.matchWords === true && topicLower !== null
      ? wordStartPatterns(topicLower)
      : [];
  const page = await sql<(KnowledgeEntryRow & { seq: number })[]>`
    SELECT id, topic, content, source, document_id AS "documentId",
           created_by AS "createdBy", created_at_ms::float8 AS "createdAt",
           seq::float8 AS seq
    FROM app.knowledge_entries
    WHERE org_id = ${organizationId} AND status = 'active'
      AND deleted_at_ms IS NULL
      AND (${topicLower}::text IS NULL
           OR lower(topic) LIKE '%' || ${topicLower} || '%'
           OR (${words.length > 0} AND topic ~* ANY(${words})))
      AND (${options.cursor ?? null}::bigint IS NULL
           OR seq < ${options.cursor ?? null})
    ORDER BY seq DESC
    LIMIT ${limit + 1}
  `;
  const rows = page.slice(0, limit);
  return {
    rows: rows.map(({ seq: _seq, ...row }) => row),
    nextCursor: page.length > limit ? (rows.at(-1)?.seq ?? null) : null,
  };
}

export async function countKnowledgeEntries(
  sql: Sql,
  organizationId: string,
): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM app.knowledge_entries
    WHERE org_id = ${organizationId} AND status = 'active'
      AND deleted_at_ms IS NULL
  `;
  return Number(rows[0]?.count ?? '0');
}

/** The version chain of one entry's topic, newest first. */
export async function getKnowledgeEntryVersions(
  sql: Sql,
  organizationId: string,
  entryId: string,
): Promise<
  Array<{
    id: string;
    topic: string;
    content: string;
    status: string;
    createdBy: string;
    createdAt: number;
  }>
> {
  const keys = await sql<{ topicKey: string }[]>`
    SELECT topic_key AS "topicKey" FROM app.knowledge_entries
    WHERE id = ${entryId} AND org_id = ${organizationId}
    LIMIT 1
  `;
  const topicKey = keys[0]?.topicKey;
  if (topicKey === undefined) return [];
  return sql<
    {
      id: string;
      topic: string;
      content: string;
      status: string;
      createdBy: string;
      createdAt: number;
    }[]
  >`
    SELECT id, topic, content, status, created_by AS "createdBy",
           created_at_ms::float8 AS "createdAt"
    FROM app.knowledge_entries
    WHERE org_id = ${organizationId} AND topic_key = ${topicKey}
    ORDER BY seq DESC
  `;
}

/** The agent-facing listing (the chat shim's leg): active entries only,
 * optional case-insensitive topic filter, seq-keyed pages. */
export async function listEntriesForAgent(
  sql: Sql,
  args: {
    organizationId: string;
    topic?: string;
    numItems: number;
    cursor: string | null;
    matchWords?: boolean;
  },
): Promise<{
  page: Array<{
    topic: string;
    content: string;
    source: string;
    createdAt: number;
  }>;
  isDone: boolean;
  continueCursor: string;
}> {
  const cursor =
    args.cursor !== null && args.cursor !== '' ? Number(args.cursor) : null;
  // A cursor is a page key THIS listing issued (the last row's seq). Anything
  // else is refused at the door — `Number('abc')` is NaN, which postgres.js
  // would serialize into the query and the ::bigint cast would fail as a 500.
  if (cursor !== null && (!Number.isInteger(cursor) || cursor <= 0)) {
    throw new KnowledgeEntryError(
      'KNOWLEDGE_ENTRY_CURSOR_INVALID',
      `"${args.cursor}" is not a page cursor this listing issued — pass the continueCursor of the previous page, or none for the first page.`,
      400,
    );
  }
  const { rows, nextCursor } = await listKnowledgeEntries(
    sql,
    args.organizationId,
    {
      ...(cursor !== null ? { cursor } : {}),
      limit: args.numItems,
      ...(args.topic !== undefined ? { topic: args.topic } : {}),
      ...(args.matchWords === true ? { matchWords: true } : {}),
    },
  );
  return {
    page: rows.map((row) => ({
      topic: row.topic,
      content: row.content,
      source: row.source,
      createdAt: row.createdAt,
    })),
    isDone: nextCursor === null,
    continueCursor: nextCursor === null ? '' : String(nextCursor),
  };
}
