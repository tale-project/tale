'use node';

/**
 * The ONE document-text reader behind every `rag_fetch` of a file ref — the
 * chat assistant's executor (`chat/assistant_tools.ts`) and the sandbox
 * bridge (`node_only/sandbox/workspace_tools_bridge.ts`) both read through
 * here, so the two can never disagree about what a miss means.
 *
 * Three sources, in order, each behind the caller's scope:
 *
 *  1. the corpus — the indexed text (`fetchDocumentByFileId`), which is what
 *     a search hit's ref promises;
 *  2. the document row's inline `content` — a hub-authored document whose
 *     text never had a blob;
 *  3. the stored bytes, read ON DEMAND — a text-like file (the plain-text
 *     extractor's own extension set) under {@link ON_DEMAND_TEXT_MAX_BYTES}
 *     is decoded straight from the object store. A REST-bound project file
 *     skips indexing by default, and "may not be indexed yet" was the wrong
 *     answer for a `.txt` whose bytes were right there.
 *
 * When none serves, the miss states the TRUE indexing state of the file —
 * skipped, queued, running, failed with its error, unsupported, or indexed
 * with no text — and names the file, so the model relays a fact and the
 * timeline shows a filename instead of a raw `s3:` ref. A ref the caller may
 * not read answers the SAME miss as a ref that does not exist: the file name
 * and its state are only ever spoken for an admitted ref.
 *
 * Admission for the on-demand lane is the live-truth check every corpus hit
 * already passes (`filterRetrievableRagFileIds`): a project file inside the
 * caller's project scope, a hub file under its team rules, a thread upload
 * inside its own thread, an emailed attachment inside the conversation the
 * caller may read — nothing wider.
 */

import {
  knowledgeScopeAllows,
  type KnowledgeAccessScope,
} from '../../../lib/knowledge/types';
import type { ActionCtx } from '../lib/ctx';
import { internal } from '../lib/handler_names';
import { SUPPORTED_TEXT_EXTENSIONS } from '../lib/knowledge/extraction/text';
import { fetchDocumentByFileId, retrievableFilterArgs } from './fetch';

/** The largest file read on demand, without an index run. Text this size is
 * already far past one `rag_fetch` window; anything bigger goes through the
 * indexer, whose chunks page. Sized to the web-fetch response cap. */
export const ON_DEMAND_TEXT_MAX_BYTES = 4 * 1024 * 1024;

/** True when the plain-text extractor owns this file name — the same set
 * the indexer routes to it, so "readable on demand" and "readable by the
 * indexer without a heavy extractor" are one fact. */
export function isOnDemandReadableName(fileName: string): boolean {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0 || dot === fileName.length - 1) return false;
  return SUPPORTED_TEXT_EXTENSIONS.has(fileName.slice(dot).toLowerCase());
}

/** Where a file stands in the search corpus, as the domain reads it
 * (`file_metadata/indexing-state.ts`) — relayed here for the miss message. */
export interface OnDemandIndexingState {
  readonly status:
    | 'pending'
    | 'queued'
    | 'running'
    | 'completed'
    | 'failed'
    | 'unsupported'
    | 'skipped';
  readonly error?: string;
}

/**
 * What the on-demand lane (`file_metadata/internal_queries:
 * readTextOnDemandForAgent`) answers for an ADMITTED ref: the decoded text,
 * or why the bytes cannot be served as text — with the file's name and its
 * indexing state either way. `null` when no live file row holds the ref.
 */
export type OnDemandFileRead =
  | {
      readonly kind: 'text';
      readonly filename: string;
      readonly text: string;
      readonly indexing: OnDemandIndexingState;
    }
  | {
      readonly kind: 'unreadable';
      readonly filename: string;
      readonly sizeBytes: number;
      readonly indexing: OnDemandIndexingState;
      /** `binary`: not a text-like name (needs the indexer's extractors);
       * `too_large`: text-like but over the cap; `no_text`: the bytes are
       * empty or gone. */
      readonly reason: 'binary' | 'too_large' | 'no_text';
    };

/** One read, resolved. */
export type DocumentTextRead =
  | {
      readonly status: 'ok';
      readonly text: string;
      readonly filename: string | null;
      /** The conversation an emailed attachment arrived on — the caller
       * wraps such text as untrusted. Null for everything else. */
      readonly conversationId: string | null;
      readonly source: 'corpus' | 'inline' | 'file';
    }
  | {
      readonly status: 'not_found';
      /** Written FOR THE MODEL: the fact, then what to do about it. */
      readonly message: string;
      /** The file's name when the caller may know it — never on the
       * denied/unknown miss, which must not distinguish the two. */
      readonly filename?: string;
    };

export interface ReadDocumentTextArgs {
  readonly organizationId: string;
  readonly orgSlug: string;
  readonly fileId: string;
  /** The caller's document visibility, derived server-side. Required: this
   * reader serves people and sessions, never an org-wide credential. */
  readonly access: KnowledgeAccessScope;
}

/** The miss for a ref the caller may not read AND for a ref nothing holds —
 * byte-identical on purpose, so a fetch can never probe for existence. */
const MISSING: DocumentTextRead = {
  status: 'not_found',
  message:
    'No readable document with that file id in this organization. Re-run ' +
    'rag_search and use a ref from its results.',
};

const SAY_SO = 'Say so instead of guessing at its contents.';

/** The remedy for a file that will never index on its own. */
const INDEX_IT =
  "Index it from the project's Knowledge tab (or bind it over the API with " +
  'skipRagIndexing: false), then fetch it again.';

function mib(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MiB`;
}

/** The model-facing sentence for bytes that cannot be served as text. */
export function describeUnreadable(
  file: Extract<OnDemandFileRead, { kind: 'unreadable' }>,
): string {
  const name = `"${file.filename}"`;
  const { status, error } = file.indexing;
  const because = error !== undefined ? ` (${error})` : '';
  if (file.reason === 'no_text') {
    return `${name} holds no readable text — its stored bytes are empty or gone. ${SAY_SO}`;
  }
  if (file.reason === 'too_large') {
    const size = `${name} is ${mib(file.sizeBytes)} — too large to read without indexing (the limit is ${mib(ON_DEMAND_TEXT_MAX_BYTES)}).`;
    return status === 'skipped' || status === 'pending'
      ? `${size} ${INDEX_IT}`
      : `${size} ${SAY_SO}`;
  }
  switch (status) {
    case 'skipped':
    case 'pending':
      return `${name} was uploaded without indexing, and only its indexed text can be read here. ${INDEX_IT}`;
    case 'queued':
      return `${name} is queued for indexing and has no readable text yet — try again shortly, or say so.`;
    case 'running':
      return `${name} is being indexed right now — try again shortly, or say so.`;
    case 'failed':
      return `Indexing ${name} failed${because}, so its text cannot be read. Say so; it can be re-indexed from the project's Knowledge tab or the Documents page.`;
    case 'unsupported':
      return `${name} has no text extractor${because} — its content cannot be read here. ${SAY_SO}`;
    default:
      // `completed`: the corpus was asked first and had nothing to serve.
      return `${name} is indexed but holds no readable text (an empty or image-only file). ${SAY_SO}`;
  }
}

/**
 * Read one document's text by the ref a search hit, an attachment list, or
 * a document listing carried. Never throws for a miss; a store or corpus
 * failure propagates so the caller answers its own "unavailable".
 */
export async function readDocumentText(
  ctx: ActionCtx,
  args: ReadDocumentTextArgs,
): Promise<DocumentTextRead> {
  const fromCorpus = await fetchDocumentByFileId(ctx, {
    organizationId: args.organizationId,
    orgSlug: args.orgSlug,
    fileId: args.fileId,
    access: args.access,
  });
  if (fromCorpus !== null && fromCorpus.text.length > 0) {
    return {
      status: 'ok',
      text: fromCorpus.text,
      filename: fromCorpus.filename,
      conversationId: fromCorpus.conversationId,
      source: 'corpus',
    };
  }

  // The document row: its scope stamp gates its inline content exactly as
  // the corpus row's stamp gated the chunks — `teamTags` is the FULL team
  // list (multi-team sharing), the legacy single `teamId` the fallback.
  const row: {
    title?: string | null;
    content?: string | null;
    projectId?: string | null;
    teamId?: string | null;
    teamTags?: string[] | null;
  } | null = await ctx.runQuery(
    internal.documents.internal_queries.findDocumentByFileId,
    { organizationId: args.organizationId, fileId: args.fileId },
  );
  const rowVisible =
    row !== null &&
    knowledgeScopeAllows(args.access, {
      teamIds: row.teamTags ?? null,
      teamId: row.teamId ?? null,
      projectId: row.projectId ?? null,
    });
  if (rowVisible && typeof row.content === 'string' && row.content.length > 0) {
    return {
      status: 'ok',
      text: row.content,
      filename: fromCorpus?.filename ?? row.title ?? null,
      conversationId: fromCorpus?.conversationId ?? null,
      source: 'inline',
    };
  }

  // The on-demand lane, behind the SAME admission every corpus hit passes.
  // Decided before the file row is read, so a denied ref never learns the
  // file's name, size or state.
  const retrievable: string[] = await ctx.runQuery(
    internal.documents.internal_queries.filterRetrievableRagFileIds,
    retrievableFilterArgs(args.organizationId, [args.fileId], args.access),
  );
  if (!retrievable.includes(args.fileId)) return MISSING;

  const file: OnDemandFileRead | null = await ctx.runQuery(
    internal.file_metadata.internal_queries.readTextOnDemandForAgent,
    { organizationId: args.organizationId, storageId: args.fileId },
  );
  if (file === null) {
    // Admitted, but no live file row holds the ref: a document row whose
    // blob the platform never tracked. The row's title is all there is.
    const title = rowVisible ? row.title : undefined;
    return {
      status: 'not_found',
      message:
        `${title ? `"${title}"` : 'That document'} holds no readable text — ` +
        `nothing is indexed for it and its file is not on record. ${SAY_SO}`,
      ...(title ? { filename: title } : {}),
    };
  }
  if (file.kind === 'text') {
    return {
      status: 'ok',
      text: file.text,
      filename: file.filename,
      conversationId: fromCorpus?.conversationId ?? null,
      source: 'file',
    };
  }
  return {
    status: 'not_found',
    message: describeUnreadable(file),
    filename: file.filename,
  };
}
