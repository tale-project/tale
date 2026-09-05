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
import { KnowledgeIndexUnavailable } from '../../core/knowledge/index_health.ts';
import { indexDocument } from '../../core/knowledge/indexing.ts';
import { parsePiiConfig } from '../../core/knowledge/pii_gate.ts';
import {
  getKnowledgePool,
  getKnowledgePoolForOrg,
  resolveOrgUrl,
} from '../../core/knowledge/pool.ts';
import { RAG_ERROR_EMBEDDING_NOT_CONFIGURED } from '../../core/knowledge/rag_error_codes.ts';
import {
  searchKnowledge,
  type SearchKnowledgeArgs,
} from '../../core/knowledge/search.ts';
import {
  extractText,
  isImageFile,
  isSupported,
} from '../../core/lib/knowledge/extraction/router.ts';
import { conversationAssignmentAllows } from '../../core/lib/rls/helpers/conversation_assignment.ts';
import { parseBlobRef } from '../../core/lib/storage/blob_ref.ts';
import { s3GetObjectBytes } from '../../core/lib/storage/object_store.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { createCtxShim, type ShimHandlers } from '../../lib/ctx-shim.ts';
import { resolveObjectStore } from '../../lib/object-store.ts';
import { readGovernancePolicy, resolveOrgSlug } from '../../lib/org-config.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import {
  documentFolderPathFrom,
  folderTreePaths,
  normalizeFolderPath,
  resolveDocumentFolderPath,
  subtreeDocumentFolderPaths,
} from '../folders/paths.ts';
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
 * access filter (Tier A: document, chat-thread and CONVERSATION scopes; the
 * email-message (`msg:`) branch returns deny until something writes such a
 * ref — ledger).
 *
 * Ingest is a 0.5-native composition of the same exported pieces
 * (extractText → embedder → indexDocument) with status writes on
 * `app.file_metadata`, driven by the `rag.index_file` job.
 */

const ADAPTER_FIND_ONE = '_reference/childComponent/betterAuth/adapter/findOne';
const FILTER_RETRIEVABLE =
  'documents/internal_queries:filterRetrievableRagFileIds';

/**
 * Which of these conversations the caller may read.
 *
 * Delegates to `conversationAssignmentAllows` — the ONE definition of inbox
 * visibility — rather than restating it. A second copy is how a reader ends
 * up subtly wider than the rule it mirrors, and the failure mode here is
 * publishing an entire inbox into a chat answer.
 *
 * Bounded by the CANDIDATES, not by the caller: an admin may read every
 * conversation, so enumerating the caller's would ship thousands of ids into
 * every dispatch. One read of the candidates' assignment stamps, then the
 * shared predicate per row.
 *
 * No caller identity means no person is asking through this path — an
 * emailed attachment stays denied rather than defaulting to org-wide.
 */
async function allowedConversationIds(
  sql: Sql,
  args: {
    organizationId: string;
    candidates: readonly string[];
    teamIds: readonly string[];
    caller?: { userId: string; isAdmin: boolean };
  },
): Promise<string[]> {
  if (args.candidates.length === 0 || args.caller === undefined) return [];
  const rows = await sql<
    {
      id: string;
      assigneeUserId: string | null;
      assigneeTeamId: string | null;
    }[]
  >`
    SELECT id, assignee_user_id AS "assigneeUserId",
           assignee_team_id AS "assigneeTeamId"
    FROM app.conversations
    WHERE org_id = ${args.organizationId}
      AND id = ANY(${[...args.candidates]})
  `;
  const teams = new Set(args.teamIds);
  const allowed: string[] = [];
  for (const row of rows) {
    const visible = await conversationAssignmentAllows(
      {
        ...(row.assigneeUserId !== null
          ? { assigneeUserId: row.assigneeUserId }
          : {}),
        ...(row.assigneeTeamId !== null
          ? { assigneeTeamId: row.assigneeTeamId }
          : {}),
      },
      {
        isAdmin: args.caller.isAdmin,
        userId: args.caller.userId,
        // Already resolved for the document branches, so the team lookup
        // this predicate defers costs nothing here.
        hasTeam: (teamId: string) => teams.has(teamId),
      },
    );
    if (visible) allowed.push(row.id);
  }
  return allowed;
}

/**
 * Tier-A retrievable filter over app tables — lifecycle truth for the
 * corpus. A ref passes when a document CURRENTLY exposes it (`file_ref` =
 * ref, active lifecycle, in scope — a replaced version's ref or a trashed/
 * expired document is dark immediately, whatever the physical purge is
 * still doing) or a LIVE unbound file row holds it: a thread file inside its
 * thread's scope, an emailed attachment inside the scope of the conversation
 * it arrived on, and a row bound to neither is denied. The DECISION is
 * `decideRetrievable` (pure, tested); this wrapper fetches its candidates
 * and resolves which of THEIR conversations the caller may read.
 *
 * `folder` (canonical spelling) re-checks the folder filter against each
 * document's CURRENT folder — the corpus row's stamp is a copy that can lag
 * a move, so the SQL pre-filter admits and this decides.
 */
async function filterRetrievableRagFileIds(
  sql: Sql,
  args: {
    organizationId: string;
    fileIds: string[];
    access?: AccessScopeArg;
    folder?: string;
    /**
     * Who is asking — needed ONLY by the conversation branch, which is
     * assignment privacy rather than org scope. Absent leaves an emailed
     * attachment denied, which is the posture until a caller supplies it.
     */
    caller?: { userId: string; isAdmin: boolean };
  },
): Promise<string[]> {
  if (args.fileIds.length === 0) {
    return [];
  }
  const docRows = await sql<
    ({
      fileRef: string;
      folderId: string | null;
      folderPath: string | null;
    } & Omit<DocCandidate, 'folderPath'>)[]
  >`
    SELECT d.file_ref AS "fileRef", d.lifecycle_status AS "lifecycleStatus",
           d.project_id AS "projectId", d.team_id AS "teamId",
           d.team_tags AS "teamTags", d.folder_id AS "folderId",
           d.folder_path AS "folderPath"
    FROM app.documents d
    WHERE d.org_id = ${args.organizationId}
      AND d.file_ref = ANY(${args.fileIds})
  `;
  // A candidate's folder is decisive only under a folder filter, so the
  // tree is read only then (one recursive query for every candidate).
  const folder = normalizeFolderPath(args.folder);
  const treePaths =
    folder !== null
      ? await folderTreePaths(
          sql,
          args.organizationId,
          docRows.flatMap((row) =>
            row.folderId !== null ? [row.folderId] : [],
          ),
        )
      : new Map<string, string>();
  const fileRows = await sql<({ storageRef: string } & UnboundFileCandidate)[]>`
    SELECT fm.storage_ref AS "storageRef", fm.thread_id AS "threadId",
           fm.conversation_id AS "conversationId",
           fm.lifecycle_status AS "lifecycleStatus"
    FROM app.file_metadata fm
    WHERE fm.org_id = ${args.organizationId}
      AND fm.storage_ref = ANY(${args.fileIds})
      AND fm.document_id IS NULL
  `;
  // Which of the CANDIDATES' conversations this caller may read. Bounded by
  // the candidate set, never enumerated for the caller: an admin sees every
  // conversation, so an org with a large inbox would otherwise ship
  // thousands of ids into every dispatch's scope.
  const conversationIds = await allowedConversationIds(sql, {
    organizationId: args.organizationId,
    candidates: [
      ...new Set(
        fileRows.flatMap((row) =>
          row.conversationId !== null ? [row.conversationId] : [],
        ),
      ),
    ],
    teamIds: args.access?.teamIds ?? [],
    ...(args.caller !== undefined ? { caller: args.caller } : {}),
  });
  const access =
    args.access === undefined ? undefined : { ...args.access, conversationIds };
  const docsByRef = new Map<string, DocCandidate[]>();
  for (const row of docRows) {
    const { fileRef, folderId, folderPath, ...scope } = row;
    const candidate: DocCandidate = {
      ...scope,
      folderPath:
        folder !== null
          ? documentFolderPathFrom({ folderId, folderPath }, treePaths)
          : null,
    };
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
        access,
        folder ?? undefined,
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
        folder?: string;
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
  // The folder filter in canonical spelling — the one the corpus stamp is
  // written in — so `/Reports/` and `Reports` name the same folder.
  const { folder: rawFolder, ...rest } = args;
  const folder = normalizeFolderPath(rawFolder);
  try {
    return await searchKnowledge(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reused 0.4 module; ctx usage covered by the shim handlers
      shim as unknown as Parameters<typeof searchKnowledge>[0],
      { ...rest, orgSlug, ...(folder !== null ? { folder } : {}) },
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
 *
 * `ragError` and `ragErrorCode` travel together: the prose is what the failed-
 * indexing dialog prints, the code (`rag_error_codes.ts`) is what it branches
 * on to attach guidance — the Settings deep link for a missing embedding
 * model. Both are cleared by any write that does not set them, so a retry
 * that succeeds leaves no stale cause behind.
 */
async function writeRagStatus(
  sql: Sql,
  fileId: string,
  patch: {
    ragStatus?: 'queued' | 'running' | 'completed' | 'failed' | 'unsupported';
    ragProgress?: string | null;
    ragError?: string | null;
    ragErrorCode?: string | null;
    ragIndexedAt?: number | null;
  },
): Promise<void> {
  const rows = await sql<{ orgId: string }[]>`
    UPDATE app.file_metadata SET
      rag_status = coalesce(${patch.ragStatus ?? null}, rag_status),
      rag_progress = ${patch.ragProgress ?? null},
      rag_error = ${patch.ragError ?? null},
      rag_error_code = ${patch.ragErrorCode ?? null},
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
  // Images route to the vision extractor, and the vision seam is retired
  // (`extraction/vision_client.ts`): `extractText` below is called with no
  // vision client, so an image can only ever yield '' — which used to land as
  // 'failed — Indexing skipped (empty)', a badge that invites the user to
  // retry a capability that does not exist. An image with nothing to index is
  // the honest, terminal 'unsupported', decided before any bytes are fetched.
  // Drop this branch when the vision lane returns and a client is wired in.
  if (isImageFile(file.fileName)) {
    await writeRagStatus(sql, fileId, {
      ragStatus: 'unsupported',
      ragError:
        `Images cannot be indexed for search: no vision (OCR) model lane is ` +
        `available to read "${file.fileName}".`,
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
    const dbUrl = await resolveOrgUrl(orgSlug);
    await pinDimensions({
      sql: pool,
      dbUrl,
      schema: PRIVATE_KNOWLEDGE_SCHEMA,
      dimensions: embedder.dimensions,
      context: `organization "${orgSlug}"`,
    });

    const piiPolicy = await readGovernancePolicy(orgSlug, 'pii_config').catch(
      () => null,
    );
    const piiConfig = parsePiiConfig(piiPolicy);

    // Scope stamp from the bound document (hub/team/project), and its folder
    // — the corpus filters on both; a NULL folder stamp made every
    // folder-scoped search miss the document it was filed in.
    let teamIds: string[] | null = null;
    let projectId: string | null = null;
    let folderPath: string | null = null;
    if (file.documentId !== null) {
      const docRows = await sql<
        {
          teamId: string | null;
          teamTags: string[];
          projectId: string | null;
          folderId: string | null;
          folderPath: string | null;
        }[]
      >`
        SELECT team_id AS "teamId", team_tags AS "teamTags",
               project_id AS "projectId", folder_id AS "folderId",
               folder_path AS "folderPath"
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
        folderPath = await resolveDocumentFolderPath(
          sql,
          file.organizationId,
          doc,
        );
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
        dbUrl,
        orgSlug,
        fileId: file.storageRef,
        filename: file.fileName,
        text,
        bytes,
        embedder,
        piiConfig,
        folderPath,
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
    if (error instanceof KnowledgeIndexUnavailable) {
      // The corpus's BM25 index is being rebuilt (or its rebuild failed): a
      // refusal, not a failure — retrying now would hit the same wall, so the
      // job ends here. A rebuild that verifies re-queues every file refused
      // while it ran; a failed one names the operator's move in the prose.
      await writeRagStatus(sql, fileId, {
        ragStatus: 'failed',
        ragError: error.message,
        ragErrorCode: error.code,
      });
      return;
    }
    if (error instanceof EmbeddingNotConfigured) {
      // The one failure a member can route to a fix: the code makes the
      // dialog show the Settings → Data residency deep link (or "ask an
      // admin"), and the prose says the same for everyone reading the raw
      // status — an operator file path is not something a member can act on.
      await writeRagStatus(sql, fileId, {
        ragStatus: 'failed',
        ragError:
          'No embedding model is configured for this organization. An admin can set one under Settings → Data residency → Embedding model, then retry indexing.',
        ragErrorCode: RAG_ERROR_EMBEDDING_NOT_CONFIGURED,
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

/**
 * Re-queue every document that failed for want of an embedding model.
 *
 * Configuring one did not previously fix anything: each document that failed
 * while unconfigured stayed `failed`, and the only remedy was knowing to
 * retry every one by hand. The failure text tells the operator to "set one
 * under Settings → Data residency … then retry indexing" — following it
 * exactly left them no better off, one document at a time.
 *
 * Scoped by `rag_error_code`, not by status: `embedding_not_configured` is
 * stamped by exactly this cause, so a document that failed for any other
 * reason (a secret, a PII block, an unreadable file) is left alone — its
 * operator still has the per-document Retry.
 *
 * The flip and the enqueues share ONE transaction, so a crash between them
 * cannot leave a row `queued` with no job to drain it — the state the
 * watchdog would then have to guess about.
 *
 * Enqueued at DEFAULT priority: this is a backlog drain, not the one file
 * somebody is watching, so it must not push ahead of a live upload.
 */
export async function requeueEmbeddingBlockedDocuments(
  sql: Sql,
  args: { organizationId: string },
): Promise<{ requeued: number }> {
  return await sql.begin(async (tx) => {
    const rows = await tx<{ id: string }[]>`
      UPDATE app.file_metadata SET
        rag_status = 'queued',
        rag_queued_at_ms = ${Date.now()},
        rag_error = NULL,
        rag_error_code = NULL
      WHERE org_id = ${args.organizationId}
        AND rag_status = 'failed'
        AND rag_error_code = ${RAG_ERROR_EMBEDDING_NOT_CONFIGURED}
        AND skip_rag_indexing IS DISTINCT FROM true
      RETURNING id
    `;
    for (const row of rows) {
      await addJobInTx(tx, 'rag.index_file', { fileId: row.id });
    }
    return { requeued: rows.length };
  });
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
 * Re-stamp a document's corpus scope (team/project) and folder after an
 * edit that moved either — retrieval filters on these columns, and
 * re-embedding would be wasted work. Reads the document's CURRENT row, so
 * every caller (the app update, REST, WebDAV MOVE, a sync engine) speaks the
 * same one-liner. Best-effort by contract (0.4 parity): corpus failures log;
 * the next re-index is the backstop.
 */
export async function syncRagDocumentScope(
  sql: Sql,
  organizationId: string,
  documentId: string,
): Promise<void> {
  try {
    const rows = await sql<
      {
        fileRef: string | null;
        teamId: string | null;
        teamTags: string[];
        projectId: string | null;
        folderId: string | null;
        folderPath: string | null;
      }[]
    >`
      SELECT file_ref AS "fileRef", team_id AS "teamId",
             team_tags AS "teamTags", project_id AS "projectId",
             folder_id AS "folderId", folder_path AS "folderPath"
      FROM app.documents
      WHERE id = ${documentId} AND org_id = ${organizationId}
      LIMIT 1
    `;
    const doc = rows[0];
    if (!doc || doc.fileRef === null) return;
    const folderPath = await resolveDocumentFolderPath(
      sql,
      organizationId,
      doc,
    );
    const orgSlug = await requireOrgSlug(sql, organizationId);
    const pool = await getKnowledgePoolForOrg(orgSlug);
    const teamIds =
      doc.teamTags.length > 0 ? doc.teamTags : doc.teamId ? [doc.teamId] : [];
    // `team_ids` (retrieval matches ANY) + the deprecated single mirror.
    await pool.unsafe(
      `UPDATE ${PRIVATE_KNOWLEDGE_SCHEMA}.documents
          SET team_ids = $3::text[], team_id = $4, project_id = $5,
              folder_path = $6, updated_at = NOW()
        WHERE org_slug = $1 AND file_id = $2
          AND (team_ids IS DISTINCT FROM $3::text[]
            OR team_id IS DISTINCT FROM $4
            OR project_id IS DISTINCT FROM $5
            OR folder_path IS DISTINCT FROM $6)`,
      [
        orgSlug,
        doc.fileRef,
        teamIds.length > 0 ? teamIds : null,
        teamIds[0] ?? null,
        doc.projectId,
        folderPath,
      ],
    );
  } catch (error) {
    console.warn('[knowledge] corpus scope sync failed:', error);
  }
}

/** Documents compared per corpus statement — one document read, one folder
 * tree read and one corpus UPDATE per page. */
const SCOPE_RECONCILE_PAGE = 1000;

/**
 * Correct corpus scope stamps that drifted away from the documents they
 * describe, and report how many had.
 *
 * The per-edit syncs are best-effort BY CONTRACT: `syncRagDocumentScope` and
 * `syncRagFolderSubtree` catch a corpus failure so an unreachable corpus
 * cannot fail the edit that committed. Their note names the next re-index as
 * the backstop — but a scope or folder change never re-embeds, so for exactly
 * this class of edit there is no next re-index, and a corpus that was
 * unreachable for one edit leaves that row mis-stamped indefinitely.
 *
 * A stale stamp is not a leak: retrieval re-checks every hit against live
 * truth (`decideRetrievable`), so a wrongly-scoped row is rejected after the
 * fact. It is a silent cost. Every scope column NULL reads as an ORG-WIDE hub
 * row in the SQL pre-filter, so the row is handed to every caller and thrown
 * away afterwards — the pre-filter stops pre-filtering, and nothing reports
 * that it has.
 *
 * Walks the WHOLE live corpus, a keyset page (`id > last`) at a time, so a
 * corpus larger than one page is reconciled past it: a fixed `LIMIT` with no
 * cursor re-checked the same first page every run and never visited the
 * rest. Document ids are uuids, so that page was an arbitrary but stable
 * subset — the drift it missed stayed missed forever.
 *
 * One statement per page: the guard is `IS DISTINCT FROM` on all four stamped
 * columns, so the row count IS the drift count and an in-sync corpus writes
 * nothing.
 */
export async function reconcileDocumentScopeStamps(
  sql: Sql,
  args: { organizationId: string; orgSlug: string; limit?: number },
): Promise<{ scanned: number; corrected: number }> {
  const pageSize = args.limit ?? SCOPE_RECONCILE_PAGE;
  let scanned = 0;
  let corrected = 0;
  let afterId: string | null = null;
  for (;;) {
    const page: ScopeReconcilePage = await reconcileScopeStampPage(sql, {
      organizationId: args.organizationId,
      orgSlug: args.orgSlug,
      afterId,
      pageSize,
    });
    scanned += page.scanned;
    corrected += page.corrected;
    if (page.lastId === null || page.scanned < pageSize) break;
    afterId = page.lastId;
  }
  return { scanned, corrected };
}

interface ScopeReconcilePage {
  scanned: number;
  corrected: number;
  /** The keyset cursor for the next page; null when this page was empty. */
  lastId: string | null;
}

/** One page of {@link reconcileDocumentScopeStamps}: the documents after
 * `afterId` in id order, compared and corrected in one corpus statement. */
async function reconcileScopeStampPage(
  sql: Sql,
  args: {
    organizationId: string;
    orgSlug: string;
    afterId: string | null;
    pageSize: number;
  },
): Promise<ScopeReconcilePage> {
  const docs = await sql<
    {
      id: string;
      fileRef: string;
      teamId: string | null;
      teamTags: string[];
      projectId: string | null;
      folderId: string | null;
      folderPath: string | null;
    }[]
  >`
    SELECT id, file_ref AS "fileRef", team_id AS "teamId",
           team_tags AS "teamTags", project_id AS "projectId",
           folder_id AS "folderId", folder_path AS "folderPath"
    FROM app.documents
    WHERE org_id = ${args.organizationId}
      AND file_ref IS NOT NULL
      AND (lifecycle_status IS NULL OR lifecycle_status = 'active')
      AND (${args.afterId}::text IS NULL OR id > ${args.afterId})
    ORDER BY id
    LIMIT ${args.pageSize}
  `;
  if (docs.length === 0) return { scanned: 0, corrected: 0, lastId: null };

  const treePaths = await folderTreePaths(
    sql,
    args.organizationId,
    docs.flatMap((doc) => (doc.folderId !== null ? [doc.folderId] : [])),
  );
  const intended = docs.map((doc) => {
    // Same precedence as the per-edit sync: the tag array wins, the single
    // column is its deprecated mirror.
    const teamIds =
      doc.teamTags.length > 0 ? doc.teamTags : doc.teamId ? [doc.teamId] : [];
    return {
      file_id: doc.fileRef,
      team_ids: teamIds.length > 0 ? teamIds : null,
      team_id: teamIds[0] ?? null,
      project_id: doc.projectId,
      folder_path: documentFolderPathFrom(doc, treePaths),
    };
  });

  const pool = await getKnowledgePoolForOrg(args.orgSlug);
  // `pool.json` hands postgres.js the rows as ONE jsonb parameter. A
  // pre-serialized string would be JSON-encoded a second time once the server
  // reports the parameter as jsonb, and `jsonb_to_recordset` then refuses the
  // resulting JSON string ("cannot call jsonb_to_recordset on a non-array").
  const result = await pool.unsafe(
    `UPDATE ${PRIVATE_KNOWLEDGE_SCHEMA}.documents d
        SET team_ids = v.team_ids, team_id = v.team_id,
            project_id = v.project_id, folder_path = v.folder_path,
            updated_at = NOW()
       FROM jsonb_to_recordset($2::jsonb)
            AS v(file_id text, team_ids text[], team_id text,
                 project_id text, folder_path text)
      WHERE d.org_slug = $1 AND d.file_id = v.file_id
        AND (d.team_ids IS DISTINCT FROM v.team_ids
          OR d.team_id IS DISTINCT FROM v.team_id
          OR d.project_id IS DISTINCT FROM v.project_id
          OR d.folder_path IS DISTINCT FROM v.folder_path)`,
    [args.orgSlug, pool.json(intended)],
  );
  return {
    scanned: docs.length,
    corrected: result.count ?? 0,
    lastId: docs.at(-1)?.id ?? null,
  };
}

/**
 * Re-stamp the corpus folder path of every live, file-backed document under a
 * folder after the folder itself was renamed or moved — the path of each
 * document changed without any document row being touched. One read of the
 * subtree, one corpus update; best-effort like the per-document sync.
 */
export async function syncRagFolderSubtree(
  sql: Sql,
  organizationId: string,
  folderId: string,
): Promise<void> {
  try {
    const docs = await subtreeDocumentFolderPaths(
      sql,
      organizationId,
      folderId,
    );
    if (docs.length === 0) return;
    const orgSlug = await requireOrgSlug(sql, organizationId);
    const pool = await getKnowledgePoolForOrg(orgSlug);
    await pool.unsafe(
      `UPDATE ${PRIVATE_KNOWLEDGE_SCHEMA}.documents d
          SET folder_path = v.folder_path, updated_at = NOW()
         FROM unnest($2::text[], $3::text[]) AS v(file_id, folder_path)
        WHERE d.org_slug = $1 AND d.file_id = v.file_id
          AND d.folder_path IS DISTINCT FROM v.folder_path`,
      [
        orgSlug,
        docs.map((doc) => doc.fileRef),
        docs.map((doc) => doc.folderPath),
      ],
    );
  } catch (error) {
    console.warn('[knowledge] corpus folder sync failed:', error);
  }
}
