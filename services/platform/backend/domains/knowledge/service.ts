import type { Sql, TransactionSql } from 'postgres';

import { PRIVATE_KNOWLEDGE_SCHEMA } from '../../../lib/knowledge/types.ts';
import { readOrgEmbeddingConfig } from '../../core/knowledge/connection.ts';
import { applyCorpusSchema } from '../../core/knowledge/ddl.ts';
import { pinDimensions } from '../../core/knowledge/dimensions.ts';
import {
  EmbeddingNotConfigured,
  embedderForOrg,
} from '../../core/knowledge/embedding.ts';
import {
  fetchDocumentByFileId,
  type FetchDocumentByFileIdArgs,
  type FetchedDocument,
} from '../../core/knowledge/fetch.ts';
import { indexDocument } from '../../core/knowledge/indexing.ts';
import { parsePiiConfig } from '../../core/knowledge/pii_gate.ts';
import {
  getKnowledgePool,
  getKnowledgePoolForOrg,
  resolveOrgUrl,
} from '../../core/knowledge/pool.ts';
import {
  searchKnowledge,
  type SearchKnowledgeArgs,
} from '../../core/knowledge/search.ts';
import {
  extractText,
  isSupported,
} from '../../core/lib/knowledge/extraction/router.ts';
import { parseBlobRef } from '../../core/lib/storage/blob_ref.ts';
import { s3GetObjectBytes } from '../../core/lib/storage/object_store.ts';
import { createCtxShim, type ShimHandlers } from '../../lib/ctx-shim.ts';
import { resolveObjectStore } from '../../lib/object-store.ts';
import { readGovernancePolicy, resolveOrgSlug } from '../../lib/org-config.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { credentialShimHandlers } from '../provider_credentials/service.ts';
import {
  decideRetrievable,
  type AccessScopeArg,
  type DocCandidate,
  type UnboundFileCandidate,
} from './retrievable.ts';

/**
 * Knowledge (RAG) — the retrieval and ingest lanes over the knowledge
 * corpus databases. The 0.4 modules already speak plain Postgres (per-org
 * BYO corpus → deployment default, pgvector + FTS), so search/fetch reuse
 * them VERBATIM through the ctx shim; only three seams re-point at 0.5:
 * the org-row lookup, the credential row loads, and the retrievable-file
 * access filter (Tier A: document + chat-thread scopes; the conversation /
 * email-message branches return deny until those domains land — ledger).
 *
 * Ingest is a 0.5-native composition of the same exported pieces
 * (extractText → embedder → indexDocument) with status writes on
 * `app.file_metadata`, driven by the `rag.index_file` job.
 */

const ADAPTER_FIND_ONE = '_reference/childComponent/betterAuth/adapter/findOne';
const FILTER_RETRIEVABLE =
  'documents/internal_queries:filterRetrievableRagFileIds';

/**
 * Tier-A retrievable filter over app tables — lifecycle truth for the
 * corpus. A ref passes when a document CURRENTLY exposes it (`file_ref` =
 * ref, active lifecycle, in scope — a replaced version's ref or a trashed/
 * expired document is dark immediately, whatever the physical purge is
 * still doing) or a LIVE unbound file row holds it (thread files inside
 * their thread's scope; document-less lanes like video-link transcripts
 * keep the 0.4 same-org posture). The DECISION is `decideRetrievable`
 * (pure, tested); this wrapper only fetches its candidates.
 */
async function filterRetrievableRagFileIds(
  sql: Sql,
  args: {
    organizationId: string;
    fileIds: string[];
    access?: AccessScopeArg;
  },
): Promise<string[]> {
  if (args.fileIds.length === 0) {
    return [];
  }
  const docRows = await sql<({ fileRef: string } & DocCandidate)[]>`
    SELECT d.file_ref AS "fileRef", d.lifecycle_status AS "lifecycleStatus",
           d.project_id AS "projectId", d.team_id AS "teamId",
           d.team_tags AS "teamTags"
    FROM app.documents d
    WHERE d.org_id = ${args.organizationId}
      AND d.file_ref = ANY(${args.fileIds})
  `;
  const fileRows = await sql<({ storageRef: string } & UnboundFileCandidate)[]>`
    SELECT fm.storage_ref AS "storageRef", fm.thread_id AS "threadId",
           fm.lifecycle_status AS "lifecycleStatus"
    FROM app.file_metadata fm
    WHERE fm.org_id = ${args.organizationId}
      AND fm.storage_ref = ANY(${args.fileIds})
      AND fm.document_id IS NULL
  `;
  const docsByRef = new Map<string, DocCandidate[]>();
  for (const row of docRows) {
    const { fileRef, ...candidate } = row;
    const list = docsByRef.get(fileRef);
    if (list) list.push(candidate);
    else docsByRef.set(fileRef, [candidate]);
  }
  const filesByRef = new Map<string, UnboundFileCandidate[]>();
  for (const row of fileRows) {
    const { storageRef, ...candidate } = row;
    const list = filesByRef.get(storageRef);
    if (list) list.push(candidate);
    else filesByRef.set(storageRef, [candidate]);
  }
  const retrievable: string[] = [];
  for (const ref of args.fileIds) {
    // Conversation/email-message refs (`msg:`) deny until that domain lands.
    if (ref.startsWith('msg:')) {
      continue;
    }
    if (
      decideRetrievable(
        docsByRef.get(ref) ?? [],
        filesByRef.get(ref) ?? [],
        args.access,
      )
    ) {
      retrievable.push(ref);
    }
  }
  return retrievable;
}

/**
 * The betterAuth org-adapter read (`orgSlugFromId`'s one component ref) —
 * its own factory because every reused module that resolves an org's
 * on-disk provider tree needs it: knowledge embedding here, and the agent
 * lanes' vision-model resolution on the task shim.
 */
export function orgAdapterShimHandlers(sql: Sql): ShimHandlers {
  return {
    [ADAPTER_FIND_ONE]: async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: adapter.findOne's argument shape
      const { model, where } = raw as {
        model: string;
        where: { field: string; value: unknown }[];
      };
      if (model !== 'organization') {
        throw new Error(`[knowledge-shim] unexpected adapter model: ${model}`);
      }
      const clauseValue = (field: string): string | null => {
        const clause = where.find((entry) => entry.field === field);
        return typeof clause?.value === 'string' ? clause.value : null;
      };
      const byId = clauseValue('_id');
      const bySlug = clauseValue('slug');
      const rows = await sql<{ id: string; slug: string | null }[]>`
        SELECT "id", "slug" FROM "organization"
        WHERE (${byId}::text IS NULL OR "id" = ${byId})
          AND (${bySlug}::text IS NULL OR "slug" = ${bySlug})
        LIMIT 1
      `;
      const row = rows[0];
      return row ? { _id: row.id, slug: row.slug ?? undefined } : null;
    },
  };
}

/**
 * The handler map the reused 0.4 knowledge modules dispatch through —
 * exported so the chat lane's wider shim can spread it (the chat tools
 * call `searchKnowledge`/`fetchDocumentByFileId` on the SAME ctx).
 */
export function knowledgeShimHandlers(sql: Sql): ShimHandlers {
  return {
    ...credentialShimHandlers(sql),
    ...orgAdapterShimHandlers(sql),
    [FILTER_RETRIEVABLE]: async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the reused fetch/search callers pass exactly this shape
      const args = raw as {
        organizationId: string;
        fileIds: string[];
        access?: AccessScopeArg;
      };
      return filterRetrievableRagFileIds(sql, args);
    },
  };
}

function knowledgeShim(sql: Sql) {
  return createCtxShim(knowledgeShimHandlers(sql));
}

export class KnowledgeError extends Error {
  readonly code: string;
  readonly status: 400 | 404 | 503;

  constructor(code: string, message: string, status: 400 | 404 | 503 = 400) {
    super(message);
    this.name = 'KnowledgeError';
    this.code = code;
    this.status = status;
  }
}

async function requireOrgSlug(
  sql: Sql,
  organizationId: string,
): Promise<string> {
  const slug = await resolveOrgSlug(sql, organizationId);
  if (!slug) {
    throw new KnowledgeError('ORG_NOT_FOUND', 'Organization not found', 404);
  }
  return slug;
}

/** The reused 0.4 search over the org's corpus. */
export async function searchKnowledgeForOrg(
  sql: Sql,
  args: { organizationId: string } & Omit<
    SearchKnowledgeArgs,
    'organizationId' | 'orgSlug'
  >,
): Promise<Awaited<ReturnType<typeof searchKnowledge>>> {
  const orgSlug = await requireOrgSlug(sql, args.organizationId);
  const shim = knowledgeShim(sql);
  try {
    return await searchKnowledge(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reused 0.4 module; ctx usage covered by the shim handlers
      shim as unknown as Parameters<typeof searchKnowledge>[0],
      { ...args, orgSlug },
    );
  } catch (error) {
    if (error instanceof EmbeddingNotConfigured) {
      throw new KnowledgeError(
        'EMBEDDING_NOT_CONFIGURED',
        'No embedding model is configured for this organization',
        503,
      );
    }
    throw error;
  }
}

/** The reused 0.4 fetch (document window by file ref, scope-stamped). */
export async function fetchKnowledgeDocument(
  sql: Sql,
  args: { organizationId: string } & Omit<
    FetchDocumentByFileIdArgs,
    'organizationId' | 'orgSlug'
  >,
): Promise<FetchedDocument | null> {
  const orgSlug = await requireOrgSlug(sql, args.organizationId);
  const shim = knowledgeShim(sql);
  return fetchDocumentByFileId(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reused 0.4 module; ctx usage covered by the shim handlers
    shim as unknown as Parameters<typeof fetchDocumentByFileId>[0],
    { ...args, orgSlug },
  );
}

/** Bootstrap the DEPLOYMENT-DEFAULT corpus schema (worker boot + harness). */
export async function ensureDefaultCorpusSchema(): Promise<void> {
  const pool = getKnowledgePool();
  await applyCorpusSchema(pool);
}

/**
 * Move a file's indexing state, and TELL the surfaces watching it.
 *
 * The document list renders this column (`ragStatus`, joined onto the file
 * row by blob ref), and a browser only refetches when a hint names the entity
 * it is holding. Without the hint the row keeps whatever state the page was
 * loaded with — an upload that indexed in three seconds reads "Indexing"
 * until someone reloads by hand, which is what shipped.
 *
 * Org-wide (`entityId: null`): the status lives on the FILE row while the
 * surface is keyed by DOCUMENT, and the list is what has to re-read. Hints
 * carry identity, never data, so the extra breadth costs one refetch of a
 * page the user is already looking at.
 */
async function writeRagStatus(
  sql: Sql,
  fileId: string,
  patch: {
    ragStatus?: 'queued' | 'running' | 'completed' | 'failed' | 'unsupported';
    ragProgress?: string | null;
    ragError?: string | null;
    ragIndexedAt?: number | null;
  },
): Promise<void> {
  const rows = await sql<{ orgId: string }[]>`
    UPDATE app.file_metadata SET
      rag_status = coalesce(${patch.ragStatus ?? null}, rag_status),
      rag_progress = ${patch.ragProgress ?? null},
      rag_error = ${patch.ragError ?? null},
      rag_indexed_at_ms = coalesce(${patch.ragIndexedAt ?? null}, rag_indexed_at_ms)
    WHERE id = ${fileId}
    RETURNING org_id AS "orgId"
  `;
  const orgId = rows[0]?.orgId;
  if (orgId === undefined) return;
  await emitHintInTx(sql, { orgId, entity: 'document', entityId: null });
}

/**
 * Index one uploaded file into the org's corpus: extract → PII gate →
 * embed → upsert chunks. Idempotent (re-running replaces the document's
 * chunks); the `rag.index_file` job drives it with retries.
 */
export async function indexUploadedFile(
  sql: Sql,
  fileId: string,
): Promise<void> {
  const rows = await sql<
    {
      organizationId: string;
      storageRef: string;
      fileName: string;
      contentType: string;
      documentId: string | null;
      skipRagIndexing: boolean | null;
    }[]
  >`
    SELECT org_id AS "organizationId", storage_ref AS "storageRef",
           file_name AS "fileName", content_type AS "contentType",
           document_id AS "documentId",
           skip_rag_indexing AS "skipRagIndexing"
    FROM app.file_metadata WHERE id = ${fileId} LIMIT 1
  `;
  const file = rows[0];
  if (!file || file.skipRagIndexing === true) {
    return;
  }
  const orgSlug = await requireOrgSlug(sql, file.organizationId);

  if (!isSupported(file.fileName)) {
    await writeRagStatus(sql, fileId, {
      ragStatus: 'unsupported',
      ragError: `No text extractor exists for "${file.fileName}".`,
    });
    return;
  }

  await writeRagStatus(sql, fileId, {
    ragStatus: 'running',
    ragProgress: 'Extracting text…',
  });
  try {
    const parsed = parseBlobRef(file.storageRef);
    if (parsed.backend !== 's3') {
      throw new Error('0.5 blobs are S3 refs by construction');
    }
    const store = await resolveObjectStore(orgSlug);
    const bytes = await s3GetObjectBytes(store, parsed.key);
    const [text] = await extractText(bytes, file.fileName);

    const config = await readOrgEmbeddingConfig(orgSlug);
    const shim = knowledgeShim(sql);
    const embedder = await embedderForOrg(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reused 0.4 module; ctx usage covered by the shim handlers
      shim as unknown as Parameters<typeof embedderForOrg>[0],
      { organizationId: file.organizationId, orgSlug, config },
    );
    const pool = await getKnowledgePoolForOrg(orgSlug);
    await pinDimensions({
      sql: pool,
      dbUrl: await resolveOrgUrl(orgSlug),
      schema: PRIVATE_KNOWLEDGE_SCHEMA,
      dimensions: embedder.dimensions,
      context: `organization "${orgSlug}"`,
    });

    const piiPolicy = await readGovernancePolicy(orgSlug, 'pii_config').catch(
      () => null,
    );
    const piiConfig = parsePiiConfig(piiPolicy);

    // Scope stamp from the bound document (hub/team/project).
    let teamIds: string[] | null = null;
    let projectId: string | null = null;
    if (file.documentId !== null) {
      const docRows = await sql<
        {
          teamId: string | null;
          teamTags: string[];
          projectId: string | null;
        }[]
      >`
        SELECT team_id AS "teamId", team_tags AS "teamTags",
               project_id AS "projectId"
        FROM app.documents WHERE id = ${file.documentId} LIMIT 1
      `;
      const doc = docRows[0];
      if (doc) {
        teamIds =
          doc.teamTags.length > 0
            ? doc.teamTags
            : doc.teamId
              ? [doc.teamId]
              : null;
        projectId = doc.projectId;
      }
    }

    await writeRagStatus(sql, fileId, {
      ragStatus: 'running',
      ragProgress: 'Embedding…',
    });
    // 0.4 committed one slice per scheduled invocation (the action budget)
    // and rescheduled until `partial` cleared; the 0.5 worker owns the whole
    // job, so it drains the slices in-process. Every slice is committed and
    // resumable — a crash resumes after the stored prefix — and the
    // per-slice progress write doubles as the liveness signal the indexing
    // watchdog reads.
    const runSlice = (): ReturnType<typeof indexDocument> =>
      indexDocument({
        sql: pool,
        orgSlug,
        fileId: file.storageRef,
        filename: file.fileName,
        text,
        bytes,
        embedder,
        piiConfig,
        teamIds,
        projectId,
      });
    let result = await runSlice();
    while (result.partial) {
      if (result.chunksWritten === 0) {
        throw new Error(
          `Indexing made no progress at ${result.chunksStored}/${result.chunksTotal} chunks`,
        );
      }
      await writeRagStatus(sql, fileId, {
        ragStatus: 'running',
        ragProgress: `Embedding… ${result.chunksStored}/${result.chunksTotal}`,
      });
      result = await runSlice();
    }
    // `unchanged` means the corpus already holds ALL of this exact content —
    // that is a completed index, never a failure (a retry on an indexed
    // document lands here).
    if (result.skipped !== undefined && result.skipped !== 'unchanged') {
      await writeRagStatus(sql, fileId, {
        ragStatus: 'failed',
        ragError: result.refusal ?? `Indexing skipped (${result.skipped}).`,
      });
      return;
    }
    await writeRagStatus(sql, fileId, {
      ragStatus: 'completed',
      ragIndexedAt: Date.now(),
    });
  } catch (error) {
    if (error instanceof EmbeddingNotConfigured) {
      await writeRagStatus(sql, fileId, {
        ragStatus: 'failed',
        ragError:
          'No embedding model is configured — set knowledge/embedding.json for this organization.',
      });
      return;
    }
    await writeRagStatus(sql, fileId, {
      ragStatus: 'failed',
      ragError: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/** Enqueue-side marker so the UI shows queued state immediately. */
export async function markRagQueued(
  tx: TransactionSql,
  fileId: string,
): Promise<void> {
  await tx`
    UPDATE app.file_metadata SET
      rag_status = 'queued', rag_queued_at_ms = ${Date.now()}
    WHERE id = ${fileId} AND skip_rag_indexing IS DISTINCT FROM true
  `;
}

/**
 * Re-stamp a document's corpus scope (team/project) after a scope-only edit —
 * retrieval filters on these columns, and re-embedding would be wasted work.
 * Best-effort by contract (0.4 parity): corpus failures log; the next
 * re-index is the backstop.
 */
export async function syncRagDocumentScope(
  sql: Sql,
  organizationId: string,
  doc: {
    fileRef: string | null;
    teamId: string | null;
    teamTags: string[];
    projectId: string | null;
  },
): Promise<void> {
  if (doc.fileRef === null) return;
  try {
    const orgSlug = await requireOrgSlug(sql, organizationId);
    const pool = await getKnowledgePoolForOrg(orgSlug);
    const teamIds =
      doc.teamTags.length > 0 ? doc.teamTags : doc.teamId ? [doc.teamId] : [];
    // `team_ids` (retrieval matches ANY) + the deprecated single mirror.
    await pool.unsafe(
      `UPDATE ${PRIVATE_KNOWLEDGE_SCHEMA}.documents
          SET team_ids = $3::text[], team_id = $4, project_id = $5,
              updated_at = NOW()
        WHERE org_slug = $1 AND file_id = $2
          AND (team_ids IS DISTINCT FROM $3::text[]
            OR team_id IS DISTINCT FROM $4
            OR project_id IS DISTINCT FROM $5)`,
      [
        orgSlug,
        doc.fileRef,
        teamIds.length > 0 ? teamIds : null,
        teamIds[0] ?? null,
        doc.projectId,
      ],
    );
  } catch (error) {
    console.warn('[knowledge] corpus scope sync failed:', error);
  }
}
