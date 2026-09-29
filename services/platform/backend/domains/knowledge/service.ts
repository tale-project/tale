import type { Sql, TransactionSql } from 'postgres';

import {
  INDEXED_MESSAGE_CHANNEL,
  INDEXED_MESSAGE_DIRECTION,
  isMessageRef,
  MESSAGE_REF_LIKE_PATTERN,
  parseMessageRef,
} from '../../../lib/knowledge/message-ref.ts';
import { PRIVATE_KNOWLEDGE_SCHEMA } from '../../../lib/knowledge/types.ts';
import {
  isAudioOrVideo,
  isImage,
  shouldRagIndexOnUpload,
} from '../../../lib/shared/file-types.ts';
import { findOrganizationMember, isAdminRole } from '../../auth/membership.ts';
import { readOrgEmbeddingConfig } from '../../core/knowledge/connection.ts';
import { applyCorpusSchema } from '../../core/knowledge/ddl.ts';
import {
  EmbeddingDimensionMismatch,
  pinDimensions,
} from '../../core/knowledge/dimensions.ts';
import {
  isOnDemandReadableName,
  ON_DEMAND_TEXT_MAX_BYTES,
  type OnDemandFileRead,
} from '../../core/knowledge/document_text.ts';
import {
  classifyEmbeddingFailure,
  EmbeddingNotConfigured,
  embedderForOrg,
} from '../../core/knowledge/embedding.ts';
import {
  fetchDocumentByFileId,
  type FetchDocumentByFileIdArgs,
  type FetchedDocument,
} from '../../core/knowledge/fetch.ts';
import { KnowledgeIndexUnavailable } from '../../core/knowledge/index_health.ts';
import {
  indexWholeDocument,
  markCorpusIndexingFailed,
} from '../../core/knowledge/indexing.ts';
import { parsePiiConfig } from '../../core/knowledge/pii_gate.ts';
import {
  getKnowledgePool,
  getKnowledgePoolForOrg,
  resolveOrgUrl,
} from '../../core/knowledge/pool.ts';
import {
  RAG_ERROR_EMBEDDING_NOT_CONFIGURED,
  RAG_ERROR_EMBEDDING_PROVIDER_REFUSED,
  RAG_ERROR_EMBEDDING_UPSTREAM,
  RAG_ERROR_EMPTY,
  RAG_ERROR_INDEXER_ERROR,
  RAG_ERROR_MALFORMED,
  RAG_ERROR_NOT_TEXT,
  RAG_ERROR_PII_BLOCKED,
  RAG_ERROR_SECRET_DETECTED,
  RAG_ERROR_UNSUPPORTED_TYPE,
} from '../../core/knowledge/rag_error_codes.ts';
import {
  unsupportedByName,
  unsupportedTypeError,
} from '../../core/knowledge/rag_unsupported.ts';
import {
  searchKnowledge,
  type SearchKnowledgeArgs,
} from '../../core/knowledge/search.ts';
import { ExtractionError } from '../../core/lib/knowledge/extraction/errors.ts';
import {
  extractDocument,
  type ExtractedDocument,
  isSupported,
} from '../../core/lib/knowledge/extraction/router.ts';
import { extractTextFromTextBytes } from '../../core/lib/knowledge/extraction/text.ts';
import { conversationAssignmentAllows } from '../../core/lib/rls/helpers/conversation_assignment.ts';
import {
  parseBlobRef,
  s3KeyBelongsToOrg,
} from '../../core/lib/storage/blob_ref.ts';
import {
  s3GetObjectBytes,
  s3GetObjectBytesIfExists,
} from '../../core/lib/storage/object_store.ts';
import { credentialRefusalMessage } from '../../core/provider_credentials/resolve_credential.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { createCtxShim, type ShimHandlers } from '../../lib/ctx-shim.ts';
import { locateOrgObjectStore } from '../../lib/object-store.ts';
import { readGovernancePolicy, resolveOrgSlug } from '../../lib/org-config.ts';
import { indexingStateFrom } from '../file_metadata/indexing-state.ts';
import {
  documentFolderPathFrom,
  folderTreePaths,
  normalizeFolderPath,
  resolveDocumentFolderPath,
  subtreeDocumentFolderPaths,
} from '../folders/paths.ts';
import { credentialShimHandlers } from '../provider_credentials/service.ts';
import { isCorpusRefLive } from './liveness.ts';
import type { ReleaseOutcome } from './release.ts';
import {
  decideMessageRetrievable,
  decideRetrievable,
  type AccessScopeArg,
  type DocCandidate,
  type MessageCandidate,
  type UnboundFileCandidate,
} from './retrievable.ts';
import {
  HELD_BY_DOCUMENT_SQL,
  hintDocumentLists,
  type MovedStatusRow,
} from './status-hints.ts';

/**
 * Knowledge (RAG) — the retrieval and ingest lanes over the knowledge
 * corpus databases. The 0.4 modules already speak plain Postgres (per-org
 * BYO corpus → deployment default, pgvector + FTS), so search/fetch reuse
 * them VERBATIM through the ctx shim; only three seams re-point at 0.5:
 * the org-row lookup, the credential row loads, and the retrievable-file
 * access filter (Tier A: document and chat-thread scopes, plus MAIL — emailed
 * attachments and email-message (`msg:`) bodies — decided by the conversation
 * the mail arrived on).
 *
 * Ingest is a 0.5-native composition of the same exported pieces
 * (extractText → embedder → indexDocument) with status writes on
 * `app.file_metadata`, driven by the `rag.index_file` job; an inbound email
 * body indexes through `rag.index_message` (`message-index.ts`).
 */

const ADAPTER_FIND_ONE = '_reference/childComponent/betterAuth/adapter/findOne';
const FILTER_RETRIEVABLE =
  'documents/internal_queries:filterRetrievableRagFileIds';
const READ_TEXT_ON_DEMAND =
  'file_metadata/internal_queries:readTextOnDemandForAgent';

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
 * emailed attachment or an email body stays denied rather than defaulting to
 * org-wide.
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
 * thread's scope, and a row bound to neither is denied. MAIL — an emailed
 * attachment (an unbound file row bound to a conversation) or an email
 * message ref (`msg:`, whose inbound email must still exist) — passes only
 * when its conversation is live and not spam, the door asked for mail, and
 * the caller may read that conversation. The DECISIONS are
 * `decideRetrievable` and `decideMessageRetrievable`, both deciding mail by
 * `decideMailRetrievable` (pure, tested); this wrapper fetches their
 * candidates and, for a door that asked for mail, resolves which of THEIR
 * conversations the caller may read — attachments' and messages' together,
 * in one read.
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
     * Who is asking — needed ONLY by the conversation branches (emailed
     * attachments and email bodies), which are assignment privacy rather
     * than org scope. Absent leaves both denied: a system caller, or a
     * person the shim could not resolve to a live member.
     */
    caller?: { userId: string; isAdmin: boolean };
  },
): Promise<string[]> {
  if (args.fileIds.length === 0) {
    return [];
  }
  // Two vocabularies: blob refs resolve through documents and file rows,
  // message refs through the message table. Neither is looked up in the
  // other's tables.
  const blobRefs = args.fileIds.filter((ref) => !isMessageRef(ref));
  const messageIds = [
    ...new Set(
      args.fileIds.flatMap((ref) => {
        const messageId = parseMessageRef(ref);
        return messageId !== null ? [messageId] : [];
      }),
    ),
  ];
  const docRows =
    blobRefs.length === 0
      ? []
      : await sql<
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
            AND d.file_ref = ANY(${blobRefs})
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
  // An emailed attachment is read with its conversation's lifecycle and
  // status, which decide it the way they decide an email body.
  const fileRows =
    blobRefs.length === 0
      ? []
      : await sql<({ storageRef: string } & UnboundFileCandidate)[]>`
          SELECT fm.storage_ref AS "storageRef", fm.thread_id AS "threadId",
                 fm.conversation_id AS "conversationId",
                 fm.lifecycle_status AS "lifecycleStatus",
                 c.lifecycle_status AS "conversationLifecycleStatus",
                 c.status AS "conversationStatus"
          FROM app.file_metadata fm
          LEFT JOIN app.conversations c
            ON c.id = fm.conversation_id AND c.org_id = fm.org_id
          WHERE fm.org_id = ${args.organizationId}
            AND fm.storage_ref = ANY(${blobRefs})
            AND fm.document_id IS NULL
        `;
  // Mail is decided only for a door that asked for it — for any other the
  // decision is a deny, so the message and assignment reads would be wasted.
  const wantsMail =
    args.access?.includeConversationMessages === true &&
    args.access.includeConversationScoped !== false;
  // The inbound emails the message refs name, with the conversation each
  // decides by.
  const messageRows =
    messageIds.length === 0 || !wantsMail
      ? []
      : await sql<({ id: string } & MessageCandidate)[]>`
          SELECT m.id, m.conversation_id AS "conversationId",
                 c.lifecycle_status AS "conversationLifecycleStatus",
                 c.status AS "conversationStatus"
          FROM app.conversation_messages m
          JOIN app.conversations c
            ON c.id = m.conversation_id AND c.org_id = m.org_id
          WHERE m.org_id = ${args.organizationId}
            AND m.id = ANY(${messageIds})
            AND m.direction = ${INDEXED_MESSAGE_DIRECTION}
            AND m.channel = ${INDEXED_MESSAGE_CHANNEL}
            AND m.connector_name <> ''
        `;
  // Which of the CANDIDATES' conversations this caller may read. Bounded by
  // the candidate set, never enumerated for the caller: an admin sees every
  // conversation, so an org with a large inbox would otherwise ship
  // thousands of ids into every dispatch's scope.
  const conversationIds = await allowedConversationIds(sql, {
    organizationId: args.organizationId,
    candidates: wantsMail
      ? [
          ...new Set([
            ...fileRows.flatMap((row) =>
              row.conversationId !== null ? [row.conversationId] : [],
            ),
            ...messageRows.map((row) => row.conversationId),
          ]),
        ]
      : [],
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
  const messagesById = new Map<string, MessageCandidate>();
  for (const { id, ...candidate } of messageRows) {
    messagesById.set(id, candidate);
  }
  const retrievable: string[] = [];
  for (const ref of args.fileIds) {
    if (isMessageRef(ref)) {
      // Decided by the message's conversation. A malformed ref names no
      // message and denies — it never falls through to the blob branch.
      const messageId = parseMessageRef(ref);
      if (
        decideMessageRetrievable(
          messageId !== null ? messagesById.get(messageId) : undefined,
          access,
          folder ?? undefined,
        )
      ) {
        retrievable.push(ref);
      }
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
 * Name the document behind each documents-corpus hit. The corpus keys a
 * chunk by its BLOB reference (`source.ref` = `file_ref`), which no document
 * route takes — a caller that wanted to open, cite or delete what it found
 * had to search `GET /documents` by title. The retrievable filter has
 * already admitted the ref for this caller's scope; this reads the active
 * document that exposes it in the hit's own project scope (newest first
 * when the same blob was published twice) and stamps its id on the hit.
 * One query for the whole page; hits whose ref no document holds (a thread
 * upload, an emailed attachment) and web hits pass through unchanged.
 */
export async function withDocumentIds<
  H extends {
    readonly corpus: string;
    readonly source: {
      readonly ref: string;
      readonly projectId?: string | null;
    };
  },
>(sql: Sql, organizationId: string, hits: readonly H[]): Promise<H[]> {
  const refs = [
    ...new Set(
      hits
        .filter((hit) => hit.corpus === 'documents')
        .map((hit) => hit.source.ref),
    ),
  ];
  if (refs.length === 0) return [...hits];
  const rows = await sql<
    { id: string; fileRef: string; projectId: string | null }[]
  >`
    SELECT id, file_ref AS "fileRef", project_id AS "projectId"
    FROM app.documents
    WHERE org_id = ${organizationId}
      AND file_ref = ANY(${refs})
      AND coalesce(lifecycle_status, 'active') = 'active'
    ORDER BY created_at_ms DESC
  `;
  const byRefAndProject = new Map<string, string>();
  for (const row of rows) {
    const key = `${row.fileRef}\u0000${row.projectId ?? ''}`;
    if (!byRefAndProject.has(key)) byRefAndProject.set(key, row.id);
  }
  return hits.map((hit) => {
    if (hit.corpus !== 'documents') return hit;
    const documentId = byRefAndProject.get(
      `${hit.source.ref}\u0000${hit.source.projectId ?? ''}`,
    );
    return documentId === undefined
      ? hit
      : { ...hit, source: { ...hit.source, documentId } };
  });
}

/**
 * Who is asking, for the conversation branch of the retrievable filter: the
 * caller's member row decides whether they are an admin (every conversation)
 * or a member (their assignments). The reused search/fetch modules carry the
 * identity as `access.userId` and hand it to the filter top-level; nothing
 * else on that wire says who the person is. No member row, or a disabled
 * one, is no caller — an emailed attachment or an email body then stays
 * denied.
 */
async function retrievalCallerFor(
  sql: Sql,
  organizationId: string,
  userId: string,
): Promise<{ userId: string; isAdmin: boolean } | undefined> {
  const member = await findOrganizationMember(sql, organizationId, userId);
  if (member === null || member.role === 'disabled') return undefined;
  return { userId, isAdmin: isAdminRole(member.role) };
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
      const { userId, ...args } = raw as {
        organizationId: string;
        fileIds: string[];
        access?: AccessScopeArg;
        folder?: string;
        userId?: string;
      };
      // The identity arrives top-level (`access.userId`, lifted by the reused
      // callers); the filter wants a decided caller. Resolving it HERE is
      // what makes the #3220 conversation branch reachable from a search —
      // the cast used to drop the id, so the decision was always deny.
      const caller =
        userId === undefined
          ? undefined
          : await retrievalCallerFor(sql, args.organizationId, userId);
      return filterRetrievableRagFileIds(sql, {
        ...args,
        ...(caller !== undefined ? { caller } : {}),
      });
    },
    // The on-demand text lane behind `rag_fetch` (`core/knowledge/
    // document_text.ts`): called only for a ref the filter above admitted.
    [READ_TEXT_ON_DEMAND]: async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the shared reader passes exactly this shape
      const args = raw as { organizationId: string; storageId: string };
      return readFileTextOnDemand(sql, args);
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

/**
 * A file's text straight from its stored bytes — the lane `rag_fetch` falls
 * back to when the corpus holds nothing for a ref the caller may read (a
 * REST-bound project file skips indexing by default; a chat upload may still
 * be queued). Only the plain-text extractor's own extensions are served, and
 * only under {@link ON_DEMAND_TEXT_MAX_BYTES}: anything else needs the
 * indexer's extractors and pages through its chunks, so the answer for it is
 * the file's TRUE indexing state — whether a document holds the file, the one
 * kind of file a person can index by hand, and whether an index run could
 * read it at all — which the caller turns into the miss.
 *
 * Admission is the CALLER's job (the shared reader checks the ref through
 * `filterRetrievableRagFileIds` first); this reads the org's own row only,
 * and refuses a blob key outside the org's namespace the way every serve
 * lane does. Null when no live file row holds the ref.
 */
export async function readFileTextOnDemand(
  sql: Sql,
  args: { organizationId: string; storageId: string },
): Promise<OnDemandFileRead | null> {
  const rows = await sql<
    {
      fileName: string;
      size: number;
      lifecycleStatus: string | null;
      skipRagIndexing: boolean | null;
      ragStatus: string | null;
      ragError: string | null;
      ragErrorCode: string | null;
      heldByDocument: boolean;
    }[]
  >`
    SELECT fm.file_name AS "fileName", fm.size::float8 AS size,
           fm.lifecycle_status AS "lifecycleStatus",
           fm.skip_rag_indexing AS "skipRagIndexing",
           fm.rag_status AS "ragStatus", fm.rag_error AS "ragError",
           fm.rag_error_code AS "ragErrorCode",
           ${sql.unsafe(HELD_BY_DOCUMENT_SQL)} AS "heldByDocument"
    FROM app.file_metadata fm
    WHERE fm.org_id = ${args.organizationId}
      AND fm.storage_ref = ${args.storageId}
      AND (fm.lifecycle_status IS NULL OR fm.lifecycle_status <> 'trashed')
    ORDER BY fm.created_at_ms ASC
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  const state = indexingStateFrom(row);
  const indexing = {
    status: state.status,
    ...(state.error !== undefined ? { error: state.error } : {}),
  };
  const unreadable = (
    reason: 'binary' | 'too_large' | 'no_text',
  ): OnDemandFileRead => ({
    kind: 'unreadable',
    filename: row.fileName,
    sizeBytes: row.size,
    indexing,
    heldByDocument: row.heldByDocument,
    // False when the indexer's by-name rule already decides a run's answer.
    extractable: unsupportedByName(row.fileName) === null,
    reason,
  });
  if (!isOnDemandReadableName(row.fileName)) return unreadable('binary');
  // The bind step HEADs the landed object, so `size` is the store's own
  // figure — checked before a byte is fetched, and again on what arrived.
  if (row.size > ON_DEMAND_TEXT_MAX_BYTES) return unreadable('too_large');

  const orgSlug = await requireOrgSlug(sql, args.organizationId);
  const parsed = parseBlobRef(args.storageId);
  if (parsed.backend !== 's3' || !s3KeyBelongsToOrg(parsed.key, orgSlug)) {
    return unreadable('no_text');
  }
  const store = await locateOrgObjectStore(orgSlug, parsed.key);
  const bytes = await s3GetObjectBytesIfExists(store, parsed.key);
  if (bytes === null || bytes.byteLength === 0) return unreadable('no_text');
  if (bytes.byteLength > ON_DEMAND_TEXT_MAX_BYTES) {
    return unreadable('too_large');
  }
  const [text] = await extractTextFromTextBytes(bytes, row.fileName);
  if (text.trim() === '') return unreadable('no_text');
  return { kind: 'text', filename: row.fileName, text, indexing };
}

/** The stable code and the sentence each class of provider failure becomes
 * at the retrieval boundary. `credit`, `credential` and `unresolved` are
 * refusals an admin lifts (never a wait); `upstream` is weather worth a
 * later retry. A credential that does not resolve answers the same
 * documented code as one the provider rejects: the same admin fixes it, on
 * the same settings page. */
const EMBEDDING_FAILURE_CODE = {
  credit: 'EMBEDDING_CREDIT_EXHAUSTED',
  credential: 'EMBEDDING_CREDENTIAL_REJECTED',
  unresolved: 'EMBEDDING_CREDENTIAL_REJECTED',
  upstream: 'EMBEDDING_UPSTREAM_ERROR',
} as const;
const EMBEDDING_FAILURE_PROSE = {
  credit:
    "The organization's embedding provider refused the request for account reasons (balance, plan or billing)",
  credential:
    "The organization's embedding provider rejected its credential or refused it the model — provider settings an admin must fix",
  unresolved:
    "The organization's embedding model has no usable provider credential — an admin must add or fix it",
  upstream: "The organization's embedding provider could not serve the request",
} as const;

/** What a failure says after its class sentence: the resolver's own remedy
 * for a credential refusal (its `message` is the serialized payload), the
 * provider's words otherwise. */
function embeddingFailureDetail(error: unknown): string {
  return (
    credentialRefusalMessage(error) ??
    (error instanceof Error ? error.message : String(error))
  );
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
    const result = await searchKnowledge(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reused 0.4 module; ctx usage covered by the shim handlers
      shim as unknown as Parameters<typeof searchKnowledge>[0],
      { ...rest, orgSlug, ...(folder !== null ? { folder } : {}) },
    );
    return {
      ...result,
      hits: await withDocumentIds(sql, args.organizationId, result.hits),
    };
  } catch (error) {
    if (error instanceof EmbeddingNotConfigured) {
      throw new KnowledgeError(
        'EMBEDDING_NOT_CONFIGURED',
        'No embedding model is configured for this organization',
        503,
      );
    }
    // A provider failure while embedding the QUERY must never reach a caller
    // raw: the provider's own 429 reads as a platform rate limit (the
    // documented 429 carries Retry-After; the provider's does not), and an
    // account refusal (balance, plan) invites retries that re-bill the same
    // refusal. Both become stable platform codes here, on the one entry
    // point every retrieval surface calls — and so does a credential that
    // does not resolve, which used to escape as a bare `AppError` the REST
    // door had no status for (a 500 where the reference promises 409).
    const failure = classifyEmbeddingFailure(error);
    if (failure !== null) {
      throw new KnowledgeError(
        EMBEDDING_FAILURE_CODE[failure],
        `${EMBEDDING_FAILURE_PROSE[failure]}: ${embeddingFailureDetail(error)}`,
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
 * The document list renders this column, and a browser only refetches when a
 * hint names the entity it is holding. Without the hint the row keeps
 * whatever state the page was loaded with — an upload that indexed in three
 * seconds reads "Indexing" until someone reloads by hand, which is what
 * shipped. The write asks whether a document holds the file and hints the
 * lists only then (`status-hints.ts`): an attachment is on no list.
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
  const rows = await sql<MovedStatusRow[]>`
    UPDATE app.file_metadata fm SET
      rag_status = coalesce(${patch.ragStatus ?? null}, rag_status),
      rag_progress = ${patch.ragProgress ?? null},
      rag_error = ${patch.ragError ?? null},
      rag_error_code = ${patch.ragErrorCode ?? null},
      rag_indexed_at_ms = coalesce(${patch.ragIndexedAt ?? null}, rag_indexed_at_ms)
    WHERE fm.id = ${fileId}
    RETURNING fm.org_id AS "orgId",
              ${sql.unsafe(HELD_BY_DOCUMENT_SQL)} AS "listed"
  `;
  await hintDocumentLists(sql, rows);
}

/**
 * Land a file no text extractor reads on its terminal state: `unsupported`
 * with `unsupported_type`. The indexer writes it when such a file reaches the
 * job (`unsupportedByName`); a lane that can tell from the name alone (a sync
 * import's `.loop`, an upload's `.zip`, a replaced `.doc`) writes the same
 * state through {@link markRagUnsupportedIfNoExtractor} instead of queueing a
 * job the indexer would only refuse — and instead of leaving the status
 * empty, which the document list reads as "Not indexed" with a retry that can
 * never succeed and REST as `pending`. Both take the sentence and the code
 * from `rag_unsupported.ts`, so every lane carries the same pair.
 */
async function markRagUnsupportedType(
  sql: Sql,
  fileId: string,
  fileName: string,
): Promise<void> {
  await writeRagStatus(sql, fileId, {
    ragStatus: 'unsupported',
    ragError: unsupportedTypeError(fileName),
    ragErrorCode: RAG_ERROR_UNSUPPORTED_TYPE,
  });
}

/**
 * The status a lane leaves on a file it stores without queueing it for
 * indexing — a sync import, an upload's registration, a controlled-record
 * replacement. A file no extractor reads lands on the terminal state above.
 * A file the indexer CAN read but the platform does not index by itself
 * (`.log`) keeps its empty status: a Reindex of it succeeds, and
 * `unsupported` promises that a retry reproduces the answer. Judged by the
 * stored file name, the one the indexer reads. One decision for every such
 * lane, so a `.loop` or a `.log` reads the same whichever lane stored it.
 * True when it made the file terminal.
 */
export async function markRagUnsupportedIfNoExtractor(
  sql: Sql,
  fileId: string,
  fileName: string,
): Promise<boolean> {
  if (isSupported(fileName)) return false;
  await markRagUnsupportedType(sql, fileId, fileName);
  return true;
}

/**
 * The same decision for an UPLOAD no lane queued — the register door's, and
 * the chat turn's backstop for an attachment still without a status
 * ({@link queueRagIndexIfUnstarted}). Audio and video are left to the
 * transcription lane and an image to its vision-metadata stamp: `isSupported`
 * is false for media, so without the exclusion a recording would read "Not
 * supported" while its transcript is being made. A chat attachment and an
 * unbound one (a task's, a fresh chat's before its thread exists) get the
 * same answer, so the same `.doc` reads the same wherever it was attached.
 */
export async function markUploadUnsupportedIfNoExtractor(
  sql: Sql,
  file: { id: string; fileName: string; contentType: string },
): Promise<boolean> {
  if (isAudioOrVideo(file.contentType) || isImage(file.contentType)) {
    return false;
  }
  return markRagUnsupportedIfNoExtractor(sql, file.id, file.fileName);
}

/**
 * A failure of the indexing job, recorded on BOTH rows that describe it: the
 * file's status (what the document list shows) and the corpus document (what
 * the RAG watchdog consults). Recording only the first left the corpus row at
 * `processing` after the job had given up, and the watchdog — reading a live
 * chain — flipped the file back to `running` with no job behind it, for as
 * long as the row looked fresh. The corpus write is best-effort: a knowledge
 * database fault must not hide the failure that was just classified.
 */
async function recordIndexingFailure(
  sql: Sql,
  args: {
    fileId: string;
    orgSlug: string;
    storageRef: string;
    ragStatus: 'failed' | 'unsupported';
    ragError: string;
    ragErrorCode: string;
  },
): Promise<void> {
  await writeRagStatus(sql, args.fileId, {
    ragStatus: args.ragStatus,
    ragError: args.ragError,
    ragErrorCode: args.ragErrorCode,
  });
  try {
    const pool = await getKnowledgePoolForOrg(args.orgSlug);
    await markCorpusIndexingFailed(
      pool,
      args.orgSlug,
      args.storageRef,
      args.ragError,
    );
  } catch (error) {
    console.warn(
      '[knowledge] could not record the indexing failure on the corpus row',
      {
        fileId: args.fileId,
        orgSlug: args.orgSlug,
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

/**
 * Persist what extraction learned about the file: how many pages it has, how
 * many of them are scans, and whether OCR actually ran on them. Only the PDF
 * leg answers these today, so a format that reports nothing leaves the
 * columns as they are rather than stamping a zero that reads like a measured
 * one. `vision_required` is the operator's version of the same finding: the
 * file holds pages no text extractor can read.
 */
async function stampExtractionMetadata(
  sql: Sql,
  fileId: string,
  extracted: ExtractedDocument,
): Promise<void> {
  if (
    extracted.pageCount === undefined &&
    extracted.scannedPagesDetected === undefined
  ) {
    return;
  }
  const scanned = extracted.scannedPagesDetected;
  await sql`
    UPDATE app.file_metadata SET
      page_count = coalesce(${extracted.pageCount ?? null}, page_count),
      scanned_pages_detected = coalesce(${scanned ?? null}, scanned_pages_detected),
      ocr_applied = coalesce(${extracted.ocrApplied ?? null}, ocr_applied),
      vision_required = coalesce(
        ${scanned !== undefined ? scanned > 0 : null}, vision_required)
    WHERE id = ${fileId}
  `;
}

/**
 * The conversation an emailed attachment's corpus row is stamped with: the
 * one its file row is bound to, unless the file indexes as a document —
 * filed into one, or unbound while an active document holds its ref
 * (`heldByActiveDocument`, read by `activeDocumentHoldingRef`) — then none:
 * the row carries a document's scope instead. The indexer's rule, and the
 * one both walks of the stamp pass read (`readMailAttachments`), so the
 * backfill walks exactly the rows it stamps.
 */
export function emailedAttachmentConversation(file: {
  readonly documentId: string | null;
  readonly conversationId?: string | null;
  readonly heldByActiveDocument?: boolean;
}): string | null {
  if (file.documentId !== null || file.heldByActiveDocument === true) {
    return null;
  }
  return file.conversationId ?? null;
}

/** A document's scope as the indexer stamps it on the corpus row. */
interface DocumentScopeRow {
  teamId: string | null;
  teamTags: string[];
  projectId: string | null;
  folderId: string | null;
  folderPath: string | null;
}

/**
 * The active document that holds this ref as its file, with its scope — the
 * ref's HOLDER, the document a file holding the same ref indexes as: the
 * corpus row is the ref's. Several documents can hold one ref (a WebDAV COPY
 * shares it), so the holder is the one with the lowest id, the document
 * whose scope the scope passes write back on the row too
 * (`reconcileDocumentScopeStamps`, `syncRagDocumentScopes`,
 * `syncRagRefHolderScopes` after a write that moved the holder). The stamp
 * pass's walks exclude an attachment on the same active-document condition
 * (`readMailAttachments`).
 */
async function activeDocumentHoldingRef(
  sql: Sql,
  organizationId: string,
  ref: string,
): Promise<DocumentScopeRow | null> {
  const rows = await sql<DocumentScopeRow[]>`
    SELECT d.team_id AS "teamId", d.team_tags AS "teamTags",
           d.project_id AS "projectId", d.folder_id AS "folderId",
           d.folder_path AS "folderPath"
    FROM app.documents d
    WHERE d.org_id = ${organizationId} AND d.file_ref = ${ref}
      AND (d.lifecycle_status IS NULL OR d.lifecycle_status = 'active')
    ORDER BY d.id
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * Index one uploaded file into the org's corpus: extract → PII gate →
 * embed → upsert chunks. Idempotent (re-running replaces the document's
 * chunks); the `rag.index_file` job drives it with retries.
 *
 * `signal` is the job's: pg-boss aborts it when the run outlives the job's
 * budget, or when the worker shuts down with the job still running, and
 * fails the job either way so its retry follows. The run then stops — the
 * embedding in flight is cancelled, no further slice starts — and the retry
 * resumes after the slices already stored, so no two runs embed one
 * document at once.
 */
export async function indexUploadedFile(
  sql: Sql,
  fileId: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<void> {
  const rows = await sql<
    {
      organizationId: string;
      storageRef: string;
      fileName: string;
      contentType: string;
      documentId: string | null;
      conversationId: string | null;
      skipRagIndexing: boolean | null;
    }[]
  >`
    SELECT org_id AS "organizationId", storage_ref AS "storageRef",
           file_name AS "fileName", content_type AS "contentType",
           document_id AS "documentId", conversation_id AS "conversationId",
           skip_rag_indexing AS "skipRagIndexing"
    FROM app.file_metadata WHERE id = ${fileId} LIMIT 1
  `;
  const file = rows[0];
  if (!file || file.skipRagIndexing === true) {
    return;
  }
  const orgSlug = await requireOrgSlug(sql, file.organizationId);

  // Nothing indexes a ref nothing references. The job outlives the moment
  // that queued it: an agent that rewrites its report two seconds after
  // writing it, a replacement upload, a sync update — each rotates the
  // document's ref and releases the old one, and the job for the old one is
  // still in the queue. The corpus-liveness predicate is the release seam's
  // own (`liveness.ts`), so the two can never disagree about a ref; a
  // release that lands while this run is already embedding is caught by the
  // indexer itself (`stillWanted`, and the write path). No status write: the
  // row is out of circulation, and a stale marker on it is read by nobody —
  // or it is an emailed attachment whose conversation is marked spam, which
  // is never embedded (lifting the verdict queues it again).
  const stillLive = (): Promise<boolean> =>
    isCorpusRefLive(sql, {
      organizationId: file.organizationId,
      ref: file.storageRef,
    });
  if (!(await stillLive())) {
    console.info(
      '[knowledge] indexing skipped: nothing references the file any more',
      { fileId, orgSlug },
    );
    return;
  }

  // A file no extractor reads, and an image while no vision lane is wired,
  // land on their honest, terminal 'unsupported' before any bytes are
  // fetched — the by-name rule the `rag_fetch` miss and the data migrations
  // read too (`unsupportedByName`).
  const refused = unsupportedByName(file.fileName);
  if (refused !== null) {
    await writeRagStatus(sql, fileId, {
      ragStatus: 'unsupported',
      ragError: refused.error,
      ragErrorCode: refused.code,
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
    const store = await locateOrgObjectStore(orgSlug, parsed.key);
    const bytes = await s3GetObjectBytes(store, parsed.key);
    const extracted = await extractDocument(bytes, file.fileName);
    const text = extracted.text;
    // What the extraction learned about the file itself — the operator reads
    // it on the document row ("Image pages: 3", the OCR badge). Stamped here,
    // not on completion: a PDF whose embedding step later fails is still a
    // scanned PDF, and the answer to "why is this document empty?" is
    // exactly this pair of numbers.
    await stampExtractionMetadata(sql, fileId, extracted);

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

    // Scope stamp from the document the file indexes as (hub/team/project),
    // and its folder — the corpus filters on both; a NULL folder stamp made
    // every folder-scoped search miss the document it was filed in. The
    // corpus row is the ref's, so that is the ref's holder
    // (`activeDocumentHoldingRef`), whose scope the scope passes write back —
    // also for a file bound to a WebDAV COPY's twin — and the document the
    // file is bound to only when no active document holds the ref. An
    // unbound file indexed under no scope would blank the holder's stamps
    // until the nightly scope pass wrote them back.
    let doc = await activeDocumentHoldingRef(
      sql,
      file.organizationId,
      file.storageRef,
    );
    const heldByActiveDocument = doc !== null;
    if (doc === null && file.documentId !== null) {
      const docRows = await sql<DocumentScopeRow[]>`
        SELECT team_id AS "teamId", team_tags AS "teamTags",
               project_id AS "projectId", folder_id AS "folderId",
               folder_path AS "folderPath"
        FROM app.documents WHERE id = ${file.documentId} LIMIT 1
      `;
      doc = docRows[0] ?? null;
    }
    let teamIds: string[] | null = null;
    let projectId: string | null = null;
    let folderPath: string | null = null;
    if (doc !== null) {
      teamIds = doc.teamTags.length > 0 ? doc.teamTags : null;
      projectId = doc.projectId;
      folderPath = await resolveDocumentFolderPath(
        sql,
        file.organizationId,
        doc,
      );
    }
    // An emailed attachment is stamped with the conversation it arrived on
    // (`emailedAttachmentConversation`): the corpus pre-filter then keeps it
    // out of every door that does not wrap mail, and the chat tools label
    // and wrap it as mail. A file filed into a document is that document's,
    // and so is one whose ref an active document holds.
    const conversationId = emailedAttachmentConversation({
      documentId: file.documentId,
      conversationId: file.conversationId,
      heldByActiveDocument,
    });

    await writeRagStatus(sql, fileId, {
      ragStatus: 'running',
      ragProgress: 'Embedding…',
    });
    // The worker owns the whole job: the document is prepared once and its
    // slices drain in-process (`indexWholeDocument`). Every slice is
    // committed and resumable — a crash resumes after the stored prefix —
    // and the per-slice progress write keeps the file's indexing state
    // current while a large document embeds.
    const result = await indexWholeDocument(
      {
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
        conversationId,
        signal: options.signal,
        stillWanted: stillLive,
      },
      {
        onSlice: (slice) =>
          writeRagStatus(sql, fileId, {
            ragStatus: 'running',
            ragProgress: `Embedding… ${slice.chunksStored}/${slice.chunksTotal}`,
          }),
      },
    );
    if (result.skipped === 'released') {
      // The ref died while this run was in flight and the corpus holds
      // nothing for it — by design, not by fault: no `failed` status (a
      // retry would index a dead ref, or find no row at all), no rethrow
      // (the retry ladder has nothing to retry). The file row is out of
      // circulation or already gone.
      console.info(
        '[knowledge] indexing ended: the document was released while it ran',
        { fileId, orgSlug },
      );
      return;
    }
    // `unchanged` means the corpus already holds ALL of this exact content —
    // that is a completed index, never a failure (a retry on an indexed
    // document lands here).
    if (result.skipped === 'empty') {
      // Terminal: no text to index. It used to land on `failed` with the
      // sentence "Indexing skipped (empty)." — a status the contract calls
      // retryable, describing itself as skipped — so a correct client
      // retried a permanently empty file forever (2026-09-14 eval, g3-6).
      await writeRagStatus(sql, fileId, {
        ragStatus: 'unsupported',
        ragError:
          'The file holds no text to index — it is empty, whitespace alone, or a scanned document with no text layer.',
        ragErrorCode: RAG_ERROR_EMPTY,
      });
      return;
    }
    if (
      result.skipped === 'secret-detected' ||
      result.skipped === 'pii-blocked'
    ) {
      // A policy refusal, not a fault: `failed` with its code, so a retry
      // after the policy or the file changes is meaningful.
      await writeRagStatus(sql, fileId, {
        ragStatus: 'failed',
        ragError: result.refusal ?? `Indexing refused (${result.skipped}).`,
        ragErrorCode:
          result.skipped === 'secret-detected'
            ? RAG_ERROR_SECRET_DETECTED
            : RAG_ERROR_PII_BLOCKED,
      });
      return;
    }
    await writeRagStatus(sql, fileId, {
      ragStatus: 'completed',
      ragIndexedAt: Date.now(),
    });
  } catch (error) {
    if (options.signal?.aborted) {
      // pg-boss cancelled the job — it ran past its time budget, or the
      // worker is shutting down — and owns what happens next: it failed the
      // job, and the retry resumes after the stored slices. Not a failure of
      // the document, so no `failed` status: the row keeps its progress, and
      // a retry that never comes is settled by the RAG watchdog. The message
      // stays constant (the file is named in the warning) so the error
      // reports of every such stop group together.
      console.warn('[knowledge] indexing stopped: its job was cancelled', {
        fileId,
        orgSlug,
      });
      throw new Error(
        'Indexing stopped because its job was cancelled: the job ran past its time budget, or its worker is shutting down. The retry resumes after the stored slices.',
        { cause: error },
      );
    }
    const failure = {
      fileId,
      orgSlug,
      storageRef: file.storageRef,
      ragStatus: 'failed' as const,
    };
    if (error instanceof KnowledgeIndexUnavailable) {
      // The corpus's BM25 index is being rebuilt (or its rebuild failed): a
      // refusal, not a failure — retrying now would hit the same wall, so the
      // job ends here. A rebuild that verifies re-queues every file refused
      // while it ran; a failed one names the operator's move in the prose.
      await recordIndexingFailure(sql, {
        ...failure,
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
      await recordIndexingFailure(sql, {
        ...failure,
        ragError:
          'No embedding model is configured for this organization. An admin can set one under Settings → Data residency → Embedding model, then retry indexing.',
        ragErrorCode: RAG_ERROR_EMBEDDING_NOT_CONFIGURED,
      });
      return;
    }
    // The model answers vectors of another width than the settings state
    // (a provider that ignores the requested `dimensions`), or than the
    // database is pinned to. Nothing heals by waiting — the same call
    // answers the same width — so the job ends here with both numbers on
    // the file; an admin corrects the width or the model and saves, which
    // re-queues the document.
    if (error instanceof EmbeddingDimensionMismatch) {
      await recordIndexingFailure(sql, {
        ...failure,
        ragError: `${error.message} Correct the embedding settings under Settings → Data residency → Embedding model (the vector width, or the model) and save; indexing then resumes by itself.`,
        ragErrorCode: RAG_ERROR_EMBEDDING_PROVIDER_REFUSED,
      });
      return;
    }
    // The credential the embedding model selects does not resolve — none
    // configured, deleted, of another provider, disabled, a secret that
    // cannot be read. No call reached the provider, and every retry answers
    // the same refusal: the job used to retry five times and report each one
    // as "the platform's side". It ends here with the resolver's own remedy
    // on the file, under the code the re-queue picks up — adding or fixing
    // the credential re-queues the document.
    const refusal = classifyEmbeddingFailure(error);
    if (refusal === 'unresolved') {
      await recordIndexingFailure(sql, {
        ...failure,
        ragError: `${EMBEDDING_FAILURE_PROSE.unresolved}: ${embeddingFailureDetail(error)} Adding or fixing the credential under Settings → AI providers, or saving the embedding model under Settings → Data residency → Embedding model, re-queues this document; after a fix on the deployment itself, retry indexing.`,
        ragErrorCode: RAG_ERROR_EMBEDDING_PROVIDER_REFUSED,
      });
      return;
    }
    // A provider that refused the ACCOUNT (balance, plan, billing) or the
    // CREDENTIAL: the job's retries would re-run the same refusal, so it
    // ends here with the cause on the file; an admin fixes the provider
    // account or settings and retries indexing.
    if (refusal === 'credit' || refusal === 'credential') {
      await recordIndexingFailure(sql, {
        ...failure,
        ragError: `${EMBEDDING_FAILURE_PROSE[refusal]}. Fix the provider account or settings, then retry indexing: ${error instanceof Error ? error.message : String(error)}`,
        ragErrorCode: RAG_ERROR_EMBEDDING_PROVIDER_REFUSED,
      });
      return;
    }
    // An extractor's terminal refusal — binary bytes behind a text
    // extension, a file that does not parse as its format: the honest,
    // terminal `unsupported`, with its code, and NO rethrow: the job's five
    // retries used to re-download, re-extract and re-embed the same bytes.
    if (error instanceof ExtractionError) {
      await recordIndexingFailure(sql, {
        ...failure,
        ragStatus: 'unsupported',
        ragError: error.message,
        ragErrorCode:
          error.code === 'not_text' ? RAG_ERROR_NOT_TEXT : RAG_ERROR_MALFORMED,
      });
      return;
    }
    // Every remaining failure is stored as a sentence for a person plus a
    // stable code, never the raw error: a Postgres or provider diagnostic
    // used to reach the public `indexing.error` verbatim (`invalid byte
    // sequence for encoding "UTF8": 0x00`) — a storage-engine detail no
    // caller can act on and an information leak (2026-09-14 evaluation,
    // g3-2). The raw cause goes to the platform log with the file id, and
    // the job's retry ladder keeps running for these transient causes.
    console.error('[knowledge] indexing failed', {
      fileId,
      orgSlug,
      error: error instanceof Error ? error.message : String(error),
    });
    if (refusal === 'upstream') {
      await recordIndexingFailure(sql, {
        ...failure,
        ragError: `${EMBEDDING_FAILURE_PROSE.upstream}; indexing is retried automatically.`,
        ragErrorCode: RAG_ERROR_EMBEDDING_UPSTREAM,
      });
      throw error;
    }
    await recordIndexingFailure(sql, {
      ...failure,
      ragError:
        'Indexing failed on the platform’s side; it is retried automatically, and the cause is in the platform log.',
      ragErrorCode: RAG_ERROR_INDEXER_ERROR,
    });
    throw error;
  }
}

/**
 * Re-queue every document that failed on the embedding model — for want of
 * one, on a credential that does not resolve, on the provider refusing the
 * account or the credential, on the model answering the wrong width, or on a
 * provider that could not serve the call until the job's retries ran out.
 * Run by the two saves that can lift those causes: the embedding settings,
 * and a provider credential the embedding model resolves.
 *
 * Configuring a model did not previously fix anything: each document that
 * failed while unconfigured stayed `failed`, and the only remedy was knowing
 * to retry every one by hand. The failure text tells the operator to "set one
 * under Settings → Data residency … then retry indexing" — following it
 * exactly left them no better off, one document at a time. The same held for
 * a wrong endpoint or width: the save that corrected it re-queued nothing.
 *
 * Scoped by `rag_error_code`, not by status: the three embedding codes are
 * stamped by exactly these causes, so a document that failed for any other
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
    const rows = await tx<({ id: string } & MovedStatusRow)[]>`
      UPDATE app.file_metadata fm SET
        rag_status = 'queued',
        rag_queued_at_ms = ${Date.now()},
        rag_error = NULL,
        rag_error_code = NULL
      WHERE fm.org_id = ${args.organizationId}
        AND fm.rag_status = 'failed'
        AND fm.rag_error_code IN (
          ${RAG_ERROR_EMBEDDING_NOT_CONFIGURED},
          ${RAG_ERROR_EMBEDDING_PROVIDER_REFUSED},
          ${RAG_ERROR_EMBEDDING_UPSTREAM}
        )
        AND fm.skip_rag_indexing IS DISTINCT FROM true
      RETURNING fm.id, fm.org_id AS "orgId",
                ${tx.unsafe(HELD_BY_DOCUMENT_SQL)} AS "listed"
    `;
    for (const row of rows) {
      await addJobInTx(tx, 'rag.index_file', { fileId: row.id });
    }
    // The document lists only refetch on a hint, and the worker's first
    // 'running' write per file is minutes away behind a backlog — until then
    // every other viewer kept seeing 'failed — no embedding model' with the
    // Settings deep link for a problem the admin had just fixed. Once, and
    // only when a requeued row is on a list: a batch of chat attachments
    // tells no one.
    await hintDocumentLists(tx, rows);
    return { requeued: rows.length };
  });
}

/**
 * Start indexing a chat attachment whose upload never queued one, when a turn
 * reaches for it. Two callers-in-one: the rows an instance carries from
 * before registration queued indexing itself (they would otherwise stay
 * unreadable forever, with no retry anywhere in the chat UI), and the safety
 * net for any future lane that binds a file without queueing it.
 *
 * A file no upload would queue gets the register door's answer instead
 * ({@link markUploadUnsupportedIfNoExtractor}): one no extractor reads lands
 * on its terminal state, and the turn tells the model so. Left empty, it read
 * as indexing never started for good — the model was told to index a `.doc`
 * from a Knowledge tab that does not list it, while the same file attached in
 * a fresh chat already read "Not supported". Media, images and a `.log` keep
 * their empty status, as they do at the register door.
 *
 * The claim is the UPDATE: one row, `FOR UPDATE`, status still NULL. Two
 * turns racing the same attachment produce one job, not two embeddings of
 * one file. A row that is queued, running, done, failed, unsupported, opted
 * out, or bound to a document (that lane owns its own retry) is left exactly
 * as it is.
 */
export async function queueRagIndexIfUnstarted(
  sql: Sql,
  storageRef: string,
): Promise<'queued' | 'unsupported' | null> {
  return await sql.begin(async (tx) => {
    const rows = await tx<
      { id: string; fileName: string; contentType: string }[]
    >`
      SELECT id, file_name AS "fileName", content_type AS "contentType"
      FROM app.file_metadata
      WHERE storage_ref = ${storageRef}
        AND rag_status IS NULL
        AND skip_rag_indexing IS DISTINCT FROM true
        AND document_id IS NULL
      LIMIT 1
      FOR UPDATE
    `;
    const row = rows[0];
    if (!row) return null;
    if (!shouldRagIndexOnUpload(row.fileName, row.contentType)) {
      return (await markUploadUnsupportedIfNoExtractor(tx, row))
        ? 'unsupported'
        : null;
    }
    await markRagQueued(tx, row.id);
    await addJobInTx(tx, 'rag.index_file', { fileId: row.id });
    return 'queued';
  });
}

/** Enqueue-side marker so the UI shows queued state immediately. */
export async function markRagQueued(
  tx: TransactionSql | Sql,
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
 * same one-liner. The corpus row is the ref's, and carries its holder's
 * scope (`activeDocumentHoldingRef`): an edit of a document that shares its
 * ref with a lower-id active one writes that one's scope, as the reconcile
 * does, and a document's own scope is written only when it is the holder or
 * no active document holds its ref. Best-effort by contract (0.4 parity):
 * corpus failures log; the next re-index is the backstop.
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
    const scope =
      (await activeDocumentHoldingRef(sql, organizationId, doc.fileRef)) ?? doc;
    const folderPath = await resolveDocumentFolderPath(
      sql,
      organizationId,
      scope,
    );
    const orgSlug = await requireOrgSlug(sql, organizationId);
    const pool = await getKnowledgePoolForOrg(orgSlug);
    const teamIds = scope.teamTags;
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
        scope.projectId,
        folderPath,
      ],
    );
  } catch (error) {
    console.warn('[knowledge] corpus scope sync failed:', error);
  }
}

/**
 * Re-stamp the corpus scope (team/project) and folder of a KNOWN set of
 * documents from their current rows — the batch twin of
 * {@link syncRagDocumentScope}, for an edit that moves many documents at once
 * without re-embedding any of them. Detaching a project is the case that
 * needs it: `DELETE /api/v1/projects/{id}` with `mode:"detach"` releases every
 * document to the hub (`project_id = NULL`) in one statement, and the corpus
 * rows keep the dead project id until this re-stamps them — a hub search
 * filters `project_id IS NULL`, so a released document is unfindable while it
 * still reports `indexing.status: "completed"`, with no re-index to heal it
 * (a scope-only move never re-embeds). Reads the documents' CURRENT rows, so a
 * caller passes ids and this speaks the same one-liner every scope edit uses.
 * A document whose ref a lower-id active document holds too writes nothing:
 * the row carries its ref's holder's scope, as the reconcile writes it.
 * Best-effort by contract like its single-document sibling: a corpus failure
 * logs; {@link reconcileDocumentScopeStamps} is the backstop.
 */
export async function syncRagDocumentScopes(
  sql: Sql,
  organizationId: string,
  documentIds: readonly string[],
): Promise<void> {
  if (documentIds.length === 0) return;
  try {
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
      FROM app.documents d
      WHERE org_id = ${organizationId}
        AND id = ANY(${[...documentIds]})
        AND file_ref IS NOT NULL
        AND (lifecycle_status IS NULL OR lifecycle_status = 'active')
        AND NOT EXISTS (
          SELECT 1 FROM app.documents o
          WHERE o.org_id = d.org_id AND o.file_ref = d.file_ref
            AND (o.lifecycle_status IS NULL OR o.lifecycle_status = 'active')
            AND o.id < d.id
        )
    `;
    if (docs.length === 0) return;
    const orgSlug = await requireOrgSlug(sql, organizationId);
    await writeScopeStamps(sql, { organizationId, orgSlug }, docs);
  } catch (error) {
    console.warn('[knowledge] corpus batch scope sync failed:', error);
  }
}

/**
 * Re-stamp the corpus row of each ref whose HOLDER may have changed — the
 * set of active documents holding it moved without any document's scope
 * being edited: a copy inserted beside its source (a WebDAV COPY, whose
 * random id sorts below the source's about half the time), a holder
 * trashed, restored, hard-deleted, or moved off the ref by a new version of
 * its bytes. No per-edit sync runs for any of those, so the row kept the
 * previous holder's scope until the nightly reconcile wrote the new one's
 * back and counted it as drift — and until then a scope-filtered search
 * from the new holder's team or folder missed it.
 *
 * Each ref's row takes its holder's scope: the lowest-id active document
 * holding it, read with the clause every scope writer reads holders with
 * (`activeDocumentHoldingRef`). A ref no active document holds any more is
 * left as it is: its row is the release seam's to take out, or a trashed
 * document's, which keeps its own stamp. Call it after the commit that moved
 * the holders. Best-effort like the per-edit syncs: a corpus failure logs,
 * and {@link reconcileDocumentScopeStamps} is the backstop.
 */
export async function syncRagRefHolderScopes(
  sql: Sql,
  organizationId: string,
  refs: readonly (string | null | undefined)[],
): Promise<void> {
  const unique = [
    ...new Set(
      refs.filter(
        (ref): ref is string => typeof ref === 'string' && ref.length > 0,
      ),
    ),
  ];
  if (unique.length === 0) return;
  try {
    const holders = await sql<ScopeStampRow[]>`
      SELECT file_ref AS "fileRef", team_tags AS "teamTags",
             project_id AS "projectId", folder_id AS "folderId",
             folder_path AS "folderPath"
      FROM app.documents d
      WHERE org_id = ${organizationId}
        AND file_ref = ANY(${unique})
        AND (lifecycle_status IS NULL OR lifecycle_status = 'active')
        AND NOT EXISTS (
          SELECT 1 FROM app.documents o
          WHERE o.org_id = d.org_id AND o.file_ref = d.file_ref
            AND (o.lifecycle_status IS NULL OR o.lifecycle_status = 'active')
            AND o.id < d.id
        )
    `;
    if (holders.length === 0) return;
    const orgSlug = await requireOrgSlug(sql, organizationId);
    await writeScopeStamps(sql, { organizationId, orgSlug }, holders);
  } catch (error) {
    console.warn('[knowledge] corpus holder scope sync failed:', error);
  }
}

/** A document's scope columns, as a batch scope writer reads them. */
interface ScopeStampRow {
  fileRef: string;
  teamTags: string[];
  projectId: string | null;
  folderId: string | null;
  folderPath: string | null;
}

/**
 * Write each document's scope onto its ref's corpus row, in one statement —
 * the write the batch scope writers share (`syncRagDocumentScopes`,
 * `syncRagRefHolderScopes` and the reconcile's pages). The tag array wins
 * and the single team column is its deprecated mirror, the precedence the
 * per-edit sync applies too; the folder path is the tree's. The guard is
 * `IS DISTINCT FROM` on all four stamped columns, so a row already in step
 * is not written and the count is the drift the write corrected.
 */
async function writeScopeStamps(
  sql: Sql,
  org: { organizationId: string; orgSlug: string },
  docs: readonly ScopeStampRow[],
): Promise<number> {
  const treePaths = await folderTreePaths(
    sql,
    org.organizationId,
    docs.flatMap((doc) => (doc.folderId !== null ? [doc.folderId] : [])),
  );
  const intended = docs.map((doc) => {
    const teamIds = doc.teamTags;
    return {
      file_id: doc.fileRef,
      team_ids: teamIds.length > 0 ? teamIds : null,
      team_id: teamIds[0] ?? null,
      project_id: doc.projectId,
      folder_path: documentFolderPathFrom(doc, treePaths),
    };
  });
  const pool = await getKnowledgePoolForOrg(org.orgSlug);
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
    [org.orgSlug, pool.json(intended)],
  );
  return result.count ?? 0;
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
 * nothing. A conversation stamp on a document's ref is not scope drift — no
 * scope write failed to write it — and is the stamp pass's to take off
 * (`reconcileMailAttachmentStamps`), so the count stays what the reconcile
 * reports it as: scope writes that failed or never ran — a per-edit sync the
 * corpus refused, an edit whose sync writes less than the whole scope (a
 * WebDAV folder MOVE into a team folder re-stamps the paths alone), or a
 * shared ref's holder that changed on a lane that does not re-stamp it
 * ({@link syncRagRefHolderScopes}).
 *
 * The corpus row is the ref's, and several documents can hold one ref (a
 * WebDAV COPY shares it), so the walk reads each ref's holder alone — the
 * active document with the lowest id, the one the indexer indexes the ref as
 * (`activeDocumentHoldingRef`). Written from every document holding it, the
 * row took either twin within one statement, a later page's twin overwrote
 * an earlier one's, and the same row was drift again every night.
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
 * `afterId` in id order, each ref's holder alone, compared and corrected in
 * one corpus statement. */
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
    FROM app.documents d
    WHERE org_id = ${args.organizationId}
      AND file_ref IS NOT NULL
      AND (lifecycle_status IS NULL OR lifecycle_status = 'active')
      AND NOT EXISTS (
        SELECT 1 FROM app.documents o
        WHERE o.org_id = d.org_id AND o.file_ref = d.file_ref
          AND (o.lifecycle_status IS NULL OR o.lifecycle_status = 'active')
          AND o.id < d.id
      )
      AND (${args.afterId}::text IS NULL OR id > ${args.afterId})
    ORDER BY id
    LIMIT ${args.pageSize}
  `;
  if (docs.length === 0) return { scanned: 0, corrected: 0, lastId: null };
  const corrected = await writeScopeStamps(sql, args, docs);
  return {
    scanned: docs.length,
    corrected,
    lastId: docs.at(-1)?.id ?? null,
  };
}

/** Rows compared per statement in the stamp pass: attachment rows in its
 * first walk, stamped corpus rows in its second. */
const ATTACHMENT_STAMP_PAGE = 1000;

/** What the stamp pass reports for one organization, each walk's counts
 * apart: the first walk reads attachment rows and the second stamped corpus
 * rows, so no count of one is read against the rows of the other. */
export interface MailAttachmentStampStats {
  /** First walk: attachment rows walked. */
  scanned: number;
  /** First walk: corpus rows whose conversation stamp was missing or wrong. */
  corrected: number;
  /** First walk: corpus rows of dead attachments released (see
   * `releaseCorpus`). */
  released: number;
  /** First walk: refs whose release failed; the next run retries them. */
  failures: number;
  /** Second walk: stamped corpus rows walked. */
  stampsScanned: number;
  /** Second walk: rows no attachment backs any more that something else
   * still keeps in the corpus — a document holds the ref, in whatever
   * lifecycle (the file was filed into it), or a live file row outside any
   * conversation (a thread or chat file) — whose stamp came off. No sync
   * failed for these; they are not scope drift. */
  cleared: number;
  /** Second walk: rows whose stamp the backing recheck after the clear put
   * back, since the ref was an emailed attachment again by then — a dead
   * one's too, before its release (`recheckReleased`). */
  restamped: number;
  /** Second walk: refs no attachment backs and nothing keeps, released —
   * their bytes too when nothing references those (see `releaseUnbacked`). */
  unbackedReleased: number;
  /** Second walk: those refs whose release failed. */
  unbackedFailures: number;
  /** Second walk: attachments the backing recheck found on a conversation
   * that is gone or marked spam, whose corpus rows were released once their
   * stamp was back; the file row keeps their bytes. */
  recheckReleased: number;
  /** Second walk: those attachments whose release failed; the stamp put
   * back keeps them isolated until the next night retries them. */
  recheckFailures: number;
}

/**
 * Keep the conversation stamp on the corpus rows of emailed attachments true
 * in both directions, and report what changed.
 *
 * STAMP — the rows that lack it or carry another: the BACKFILL for every
 * attachment indexed before the indexer stamped one
 * (`emailedAttachmentConversation`), and the backstop for a stamp that
 * drifted since. An unstamped attachment is not served where it must not
 * be: the retrievable filter decides it from its file row, as mail, whatever
 * the corpus says. But every scope column NULL reads as an org-wide hub row
 * in the SQL pre-filter, so the row competes for every caller's document
 * slots until it is stamped, and a door that labels mail by the corpus stamp
 * would read it as a document.
 *
 * RELEASE — the same walk releases the corpus rows of attachments whose
 * conversation is gone or marked spam: dead by corpus-liveness
 * (`liveness.ts`), the verdict an email body gets. Every lane that kills a
 * conversation queues that release itself now, but none did before, and the
 * reconcile's blob walk restarts at its head each night with a bounded
 * budget, so in a large corpus it would never reach those rows: this pass
 * visits every attachment every night. Only refs the corpus still holds are
 * handed to `releaseCorpus` (`releaseCorpusRefs`, which re-decides each by
 * liveness and leaves the bytes to the file row), so a dead attachment costs
 * one release, not one a night.
 *
 * CLEAR — a stamp can outlive the attachment it was written for. A file
 * filed into a document indexes as that document, as does one whose ref an
 * active document holds, but a stamp that raced the filing stays on the row,
 * as does the stamp of any row that stops being an attachment without a
 * re-index, and the pre-filter keeps every stamped row out of every document
 * door: the document is hidden from all of them.
 * So a second walk reads the corpus rows that carry a stamp — email bodies
 * aside: a `msg:` ref is decided by its inbound email — and hands each ref no
 * attachment row backs to `releaseUnbacked`. A ref nothing keeps in the
 * corpus goes, and its bytes with it when nothing references those either:
 * an attachment deleted while its best-effort blob delete failed, or a
 * release job that ran out of retries, leaves just such a ref, and once its
 * row is gone nothing would enumerate it again. One something keeps (a
 * document, a thread file) loses its stamp. A dead ref's stamp is never
 * cleared: unstamped, the row would read as a hub row and be offered to
 * content-hash clones. The corpus has a database of its own, so the app's
 * rows cannot guard the clear: the walk reads the backing again for every
 * stamp it took off, and a ref that turned back into a live attachment
 * meanwhile gets its stamp back. A newly dead attachment gets its stamp
 * back too before its corpus release: a failed release must never leave it
 * available to ordinary content-hash clones. The rows a clear takes the
 * stamp off stay locked until that recheck answers, and an indexer claiming
 * one of those refs waits behind them, so a clear locks at most
 * `STAMP_CLEAR_ROWS` rows and its recheck is bounded (`clearMailStamps`); one
 * that cannot finish rolls back, its stamps still on, for the next night.
 *
 * Both walks read the attachment rows through one statement
 * (`readMailAttachments`) — unbound file rows bound to a conversation, live,
 * and not a ref an active document holds, which indexes as the document — so
 * a row the first walk stamps is never one the second clears. Keyset pages,
 * batched corpus statements per page; the guards make each row count the number
 * changed, and an in-sync corpus writes nothing. `updated_at` is left alone:
 * it is the hit's modification time for a row with no source time, and a
 * stamp, added or taken off, is not an edit of the attachment.
 */
export async function reconcileMailAttachmentStamps(
  sql: Sql,
  args: {
    organizationId: string;
    orgSlug: string;
    limit?: number;
    /** De-index the corpus rows of these refs that nothing keeps in the
     * corpus, reporting what went, what something still keeps, and what
     * failed — `releaseCorpusRefs` (`release.ts`), handed in so this module
     * does not import the release seam that imports it. The first walk's:
     * each of its refs has a live file row, whose bytes stay with it. */
    releaseCorpus: MailRelease;
    /** Release what nothing references any more of these refs — the corpus
     * rows of those nothing keeps in the corpus, and the bytes of those
     * nothing references at all — reporting the same: `releaseRefs`
     * (`release.ts`). The second walk's: no attachment backs its refs, so
     * the corpus row may be the last thing that names one (the blob walk
     * lists corpus refs only), and a corpus-only release would strand its
     * bytes for good. */
    releaseUnbacked: MailRelease;
  },
): Promise<MailAttachmentStampStats> {
  const pageSize = args.limit ?? ATTACHMENT_STAMP_PAGE;
  const stats: Pick<
    MailAttachmentStampStats,
    'scanned' | 'corrected' | 'released' | 'failures'
  > = { scanned: 0, corrected: 0, released: 0, failures: 0 };
  let afterId: string | null = null;
  for (;;) {
    const page: AttachmentStampRow[] = await readMailAttachments(sql, {
      organizationId: args.organizationId,
      afterId,
      limit: pageSize,
    });
    if (page.length === 0) break;
    stats.scanned += page.length;
    const pool = await getKnowledgePoolForOrg(args.orgSlug);
    const live = page.filter((row) => row.conversationLive);
    if (live.length > 0) {
      stats.corrected += await stampMailAttachments(pool, args.orgSlug, live);
    }
    const dead = page
      .filter((row) => !row.conversationLive)
      .map((row) => row.storageRef);
    if (dead.length > 0) {
      const held = await pool.unsafe<{ fileId: string }[]>(
        `SELECT DISTINCT file_id AS "fileId"
           FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.documents
          WHERE org_slug = $1 AND file_id = ANY($2::text[])`,
        [args.orgSlug, dead],
      );
      if (held.length > 0) {
        const outcome = await args.releaseCorpus(held.map((row) => row.fileId));
        stats.released += outcome.released.length;
        stats.failures += outcome.failures.length;
      }
    }
    if (page.length < pageSize) break;
    afterId = page.at(-1)?.id ?? null;
  }
  return {
    ...stats,
    ...(await clearUnbackedMailStamps(sql, args, pageSize)),
  };
}

/** A release as the stamp pass is handed it: `releaseCorpusRefs` for its
 * first walk, `releaseRefs` for its second (`release.ts`). */
type MailRelease = (
  refs: string[],
) => Promise<Pick<ReleaseOutcome, 'released' | 'kept' | 'failures'>>;

/**
 * Stamp the corpus rows of emailed attachments with their conversation
 * — only a row that lacks the stamp or carries another is written. The
 * first walk's statement, and the one that puts back a stamp the second
 * walk took off from a ref that turned back into an attachment. A dead
 * attachment's restored stamp keeps it isolated until its release succeeds.
 * Answers the rows written.
 */
async function stampMailAttachments(
  pool: Sql | TransactionSql,
  orgSlug: string,
  rows: readonly AttachmentStampRow[],
): Promise<number> {
  const result = await pool.unsafe(
    `UPDATE ${PRIVATE_KNOWLEDGE_SCHEMA}.documents d
        SET conversation_id = v.conversation_id
       FROM jsonb_to_recordset($2::jsonb)
            AS v(file_id text, conversation_id text)
      WHERE d.org_slug = $1 AND d.file_id = v.file_id
        AND d.conversation_id IS DISTINCT FROM v.conversation_id`,
    [
      orgSlug,
      pool.json(
        rows.map((row) => ({
          file_id: row.storageRef,
          conversation_id: row.conversationId,
        })),
      ),
    ],
  );
  return result.count ?? 0;
}

/** One emailed attachment as the stamp pass reads it. */
interface AttachmentStampRow {
  id: string;
  storageRef: string;
  conversationId: string;
  /** Its conversation exists and is not marked spam — corpus-liveness. */
  conversationLive: boolean;
}

/**
 * The organization's emailed attachments as the stamp pass reads them — the
 * ONE statement both of its walks decide by: unbound file rows bound to a
 * conversation, live, and not a ref an active document holds, each read with
 * its conversation (corpus-liveness: it exists and is not marked spam).
 * Either a keyset page, `limit` rows after `afterId`, or every row holding
 * one of `refs`.
 */
async function readMailAttachments(
  sql: Sql | TransactionSql,
  args: {
    organizationId: string;
    afterId?: string | null;
    limit?: number;
    refs?: readonly string[];
  },
): Promise<AttachmentStampRow[]> {
  const afterId = args.afterId ?? null;
  const refs = args.refs === undefined ? null : [...args.refs];
  return sql<AttachmentStampRow[]>`
    SELECT fm.id, fm.storage_ref AS "storageRef",
           fm.conversation_id AS "conversationId",
           (c.id IS NOT NULL AND c.status IS DISTINCT FROM 'spam')
             AS "conversationLive"
    FROM app.file_metadata fm
    LEFT JOIN app.conversations c
      ON c.id = fm.conversation_id AND c.org_id = fm.org_id
    WHERE fm.org_id = ${args.organizationId}
      AND fm.document_id IS NULL
      AND fm.conversation_id IS NOT NULL
      AND fm.storage_ref IS NOT NULL
      AND (fm.lifecycle_status IS NULL OR fm.lifecycle_status = 'active')
      AND NOT EXISTS (
        SELECT 1 FROM app.documents d
        WHERE d.org_id = fm.org_id AND d.file_ref = fm.storage_ref
          AND (d.lifecycle_status IS NULL OR d.lifecycle_status = 'active')
      )
      AND (${afterId}::text IS NULL OR fm.id > ${afterId})
      AND (${refs}::text[] IS NULL OR fm.storage_ref = ANY(${refs}::text[]))
    ORDER BY fm.id
    LIMIT ${args.limit ?? null}
  `;
}

/** A corpus row that carries a conversation stamp. */
interface StampedCorpusRow {
  fileId: string;
  conversationId: string;
}

/**
 * The stamp pass's second walk (CLEAR in `reconcileMailAttachmentStamps`):
 * the organization's stamped corpus rows, email bodies aside, a keyset page
 * at a time by ref. Every ref no attachment row backs goes to
 * `releaseUnbacked`; the stamp comes off each one it keeps.
 */
async function clearUnbackedMailStamps(
  sql: Sql,
  args: {
    organizationId: string;
    orgSlug: string;
    releaseUnbacked: MailRelease;
  },
  pageSize: number,
): Promise<
  Pick<
    MailAttachmentStampStats,
    | 'stampsScanned'
    | 'cleared'
    | 'restamped'
    | 'unbackedReleased'
    | 'unbackedFailures'
    | 'recheckReleased'
    | 'recheckFailures'
  >
> {
  const counts = {
    stampsScanned: 0,
    cleared: 0,
    restamped: 0,
    unbackedReleased: 0,
    unbackedFailures: 0,
    recheckReleased: 0,
    recheckFailures: 0,
  };
  const pool = await getKnowledgePoolForOrg(args.orgSlug);
  let afterRef: string | null = null;
  for (;;) {
    const stamped: StampedCorpusRow[] = await pool.unsafe<StampedCorpusRow[]>(
      `SELECT file_id AS "fileId", conversation_id AS "conversationId"
         FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.documents
        WHERE org_slug = $1 AND conversation_id IS NOT NULL
          AND file_id NOT LIKE $2
          AND ($3::text IS NULL OR file_id > $3)
        ORDER BY file_id
        LIMIT $4`,
      [args.orgSlug, MESSAGE_REF_LIKE_PATTERN, afterRef, pageSize],
    );
    if (stamped.length === 0) break;
    counts.stampsScanned += stamped.length;
    const backed = new Set(
      (
        await readMailAttachments(sql, {
          organizationId: args.organizationId,
          refs: stamped.map((row) => row.fileId),
        })
      ).map((row) => row.storageRef),
    );
    const unbacked = stamped.filter((row) => !backed.has(row.fileId));
    if (unbacked.length > 0) {
      const outcome = await args.releaseUnbacked(
        unbacked.map((row) => row.fileId),
      );
      counts.unbackedReleased += outcome.released.length;
      counts.unbackedFailures += outcome.failures.length;
      const kept = new Set(outcome.kept);
      const stale = unbacked.filter((row) => kept.has(row.fileId));
      if (stale.length > 0) {
        const cleared = await clearMailStamps(sql, pool, args, stale);
        counts.cleared += cleared.cleared;
        counts.restamped += cleared.restamped;
        counts.recheckReleased += cleared.recheckReleased;
        counts.recheckFailures += cleared.recheckFailures;
      }
    }
    if (stamped.length < pageSize) break;
    afterRef = stamped.at(-1)?.fileId ?? null;
  }
  return counts;
}

/** Stale stamps one clear takes off, in a corpus transaction of its own:
 * the rows it clears stay locked until its backing recheck answers. */
const STAMP_CLEAR_ROWS = 100;

/** How long a clear waits on the app connection of its recheck — for the
 * read, then for the transaction around it to end — before it takes that
 * connection for gone. Above the recheck's own statement timeout (10 s),
 * which answers first while the connection is sound: this bound is for one
 * that no longer answers at all, a half-open socket, which the server's
 * timeout never reaches and TCP gives up on only minutes later. */
const STAMP_RECHECK_ANSWER_MS = 15_000;

/**
 * Take the stamp off rows no attachment backs, then read their backing
 * again. The corpus lives in a database of its own, so the clear cannot be
 * guarded by the app rows it was decided on, and a ref can turn back into an
 * emailed attachment after the walk read it as
 * none: the document holding it trashed or deleted while the file row stays
 * unbound, the file unfiled, a trashed file row restored. Each such row
 * gets its stamp back straight away rather than reading as a hub row until
 * the next night. A dead conversation's attachment is then released, with
 * its stamp still protecting it if that release fails.
 *
 * The rows stay locked from the clear until that recheck answers, and an
 * indexer claiming one of those refs, or a release, waits behind them. So a
 * clear takes at most `STAMP_CLEAR_ROWS` rows, and its recheck is bounded
 * (`clearMailStampRows`). One that cannot finish rolls back with its stamps
 * still on, and the next night retries it.
 */
async function clearMailStamps(
  sql: Sql,
  pool: Sql,
  args: {
    organizationId: string;
    orgSlug: string;
    releaseUnbacked: MailRelease;
  },
  stale: readonly StampedCorpusRow[],
): Promise<
  Pick<
    MailAttachmentStampStats,
    'cleared' | 'restamped' | 'recheckReleased' | 'recheckFailures'
  >
> {
  const counts = {
    cleared: 0,
    restamped: 0,
    recheckReleased: 0,
    recheckFailures: 0,
  };
  for (let at = 0; at < stale.length; at += STAMP_CLEAR_ROWS) {
    const rows = stale.slice(at, at + STAMP_CLEAR_ROWS);
    let settled: ClearedStamps;
    try {
      settled = await clearMailStampRows(sql, pool, args, rows);
    } catch (error) {
      console.warn(
        `[knowledge] stale conversation stamps for ${args.orgSlug}: a clear did not finish (rows=${rows.length}), the next night retries it:`,
        error,
      );
      continue;
    }
    // The release takes its own corpus locks. Run it after the transaction
    // commits, while its restored stamp already keeps the row out of clones.
    const dead = settled.backedAgain
      .filter((row) => !row.conversationLive)
      .map((row) => row.storageRef);
    if (dead.length > 0) {
      const outcome = await args.releaseUnbacked(dead);
      counts.recheckReleased += outcome.released.length;
      counts.recheckFailures += outcome.failures.length;
    }
    const backed = new Set(settled.backedAgain.map((row) => row.storageRef));
    const restamped = settled.cleared.filter((row) =>
      backed.has(row.fileId),
    ).length;
    counts.restamped += restamped;
    counts.cleared += settled.cleared.length - restamped;
  }
  return counts;
}

/** What one clear committed: the rows it took the stamp off, and the
 * attachments its recheck found backing them again. */
interface ClearedStamps {
  cleared: readonly { fileId: string }[];
  backedAgain: readonly AttachmentStampRow[];
}

/**
 * One clear of `clearMailStamps`: take the stamps off, read the backing
 * again, and put back each one an attachment backs again, in one corpus
 * transaction. The app connection the recheck reads on is taken, and its
 * statement timeout set, before a corpus row is locked, so the rows stay
 * locked for the clear, one bounded read and the stamps put back — never for
 * a wait on the app pool. The read is bounded on this side too
 * (`STAMP_RECHECK_ANSWER_MS`): a connection that no longer answers never
 * delivers the server's timeout, and the clear rolls back without it.
 *
 * The clear is what its corpus transaction did. The app transaction around
 * it only reads: once the corpus side has committed, a failure to end it
 * undoes nothing and the clear stands. Whichever way the corpus side went,
 * the end of the app transaction is waited for only so long
 * (`STAMP_RECHECK_ANSWER_MS`), so a connection that stops answering during
 * the clear holds up neither its corpus rows nor the pass. One already gone
 * when the clear opens its app transaction locks no corpus row, and holds
 * the pass as it would hold any other read of it.
 */
async function clearMailStampRows(
  sql: Sql,
  pool: Sql,
  args: { organizationId: string; orgSlug: string },
  rows: readonly StampedCorpusRow[],
): Promise<ClearedStamps> {
  const corpus = Promise.withResolvers<ClearedStamps>();
  let corpusBegun = false;
  const app = sql.begin(async (atx) => {
    await atx`SET LOCAL statement_timeout = '10s'`;
    corpusBegun = true;
    // A restored stamp must commit with the clear: another indexer must
    // never see its temporary NULL and clone mail context into an ordinary file.
    pool
      .begin(async (tx): Promise<ClearedStamps> => {
        // Only the stamp this walk read comes off; a row stamped with another
        // conversation meanwhile is left for the next night to judge.
        const cleared = await tx.unsafe<{ fileId: string }[]>(
          `UPDATE ${PRIVATE_KNOWLEDGE_SCHEMA}.documents d
        SET conversation_id = NULL
       FROM jsonb_to_recordset($2::jsonb)
            AS v(file_id text, conversation_id text)
      WHERE d.org_slug = $1 AND d.file_id = v.file_id
        AND d.conversation_id = v.conversation_id
      RETURNING d.file_id AS "fileId"`,
          [
            args.orgSlug,
            tx.json(
              rows.map((row) => ({
                file_id: row.fileId,
                conversation_id: row.conversationId,
              })),
            ),
          ],
        );
        const backedAgain =
          cleared.length === 0
            ? []
            : await answeredWithin(
                readMailAttachments(atx, {
                  organizationId: args.organizationId,
                  refs: cleared.map((row) => row.fileId),
                }),
                'the recheck',
              );
        if (backedAgain.length > 0) {
          // Restore every attachment before a release can fail. Even dead mail
          // must not donate its contextual headers to an ordinary content-hash clone.
          await stampMailAttachments(tx, args.orgSlug, backedAgain);
        }
        return { cleared, backedAgain };
      })
      .then(corpus.resolve, corpus.reject);
    // The app transaction ends as the corpus side did: committed with it,
    // or rolled back.
    return corpus.promise;
  });
  // Before the corpus side begins, the app transaction failing (its BEGIN,
  // the timeout) fails the clear; from then on the corpus side decides it.
  app.catch((error: unknown) => {
    if (!corpusBegun) corpus.reject(error);
  });
  let committed: ClearedStamps;
  try {
    committed = await corpus.promise;
  } catch (error) {
    // Rolled back, its stamps still on: how its app transaction ended adds
    // nothing to that, so it is only waited for.
    await appTransactionEnd(app);
    throw error;
  }
  const failure = await appTransactionEnd(app);
  if (failure !== null) {
    console.warn(
      `[knowledge] stale conversation stamps for ${args.orgSlug}: a clear committed (rows=${rows.length}), but its recheck's app transaction did not end cleanly:`,
      failure,
    );
  }
  return committed;
}

/** `work`'s answer, or a rejection once `STAMP_RECHECK_ANSWER_MS` have
 * passed without one. The query it stops waiting for settles on its own. */
async function answeredWithin<T>(work: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              `${what} did not answer within ${STAMP_RECHECK_ANSWER_MS} ms`,
            ),
          );
        }, STAMP_RECHECK_ANSWER_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** The end of a clear's app transaction: `null` once it ended cleanly, else
 * what failed — its own error, or the answer bound lapsing on a connection
 * that no longer answers. */
async function appTransactionEnd(app: Promise<unknown>): Promise<unknown> {
  try {
    await answeredWithin(app, "the recheck's app transaction");
    return null;
  } catch (error) {
    return error;
  }
}

/**
 * Re-stamp the corpus folder path of every live, file-backed document under a
 * folder after the folder itself was renamed or moved — the path of each
 * document changed without any document row being touched. A ref's row
 * carries its holder's path, so a document that is not its ref's holder is
 * not read (`subtreeDocumentFolderPaths`). One read of the subtree, one
 * corpus update; best-effort like the per-document sync.
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
