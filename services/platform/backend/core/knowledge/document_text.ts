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
 *  3. the text a read on a worker checked and kept for the file
 *     (`domains/knowledge/read-text.ts`) while the corpus has nothing for
 *     it — an upload is read right after it lands, through the indexer's own
 *     extractors and behind the organization's secret scan and PII policy
 *     exactly as the index's text is, so what a person attached never waits
 *     on the embedding server. A file nothing has read yet — a REST-bound
 *     project file skips indexing by default — is read when it is first
 *     fetched, and the fetch waits for the read's verdict
 *     ({@link READ_WAIT_MS}). Nothing is extracted or scanned here: an app
 *     chat turn runs in the api process, beside every other request.

 * An email body (a `msg:` ref) has only the first: what the indexer stored,
 * after its secret scan and the organization's PII policy.
 *
 * When none serves, the miss states the TRUE indexing state of the file —
 * skipped, queued, running, failed with its error, unsupported, or indexed
 * with no text — and names the file, so the model relays a fact and the
 * timeline shows a filename instead of a raw `s3:` ref. It names a remedy
 * only where one exists: a document can be indexed by hand, an attachment
 * cannot, and a file an index run could not read (a `.doc`, an image) is not
 * worth indexing. A ref the caller may not read answers the SAME miss as a
 * ref that does not exist: the file name and its state are only ever spoken
 * for an admitted ref.
 *
 * Admission for the on-demand lane is the live-truth check every corpus hit
 * already passes (`filterRetrievableRagFileIds`): a project file inside the
 * caller's project scope, a hub file under its team rules, a thread upload
 * inside its own thread, an emailed attachment inside the conversation the
 * caller may read and only for a door that asked for mail — nothing wider.
 */

import { formatFileSize } from '@tale/ui/format';

import { isMessageRef } from '../../../lib/knowledge/message-ref';
import {
  knowledgeScopeAllows,
  type KnowledgeAccessScope,
} from '../../../lib/knowledge/types';
import {
  READ_WITHOUT_INDEX_MAX_TEXT,
  readWithoutIndexCap,
} from '../../../lib/shared/file-types';
import type { ActionCtx } from '../lib/ctx';
import { internal } from '../lib/handler_names';
import { fetchDocumentByFileId, retrievableFilterArgs } from './fetch';

/** How long a fetch waits for a pending read of its file to be decided, and
 * how often it looks. A read takes seconds; past the wait, the fetch says
 * the file is still being read. */
export const READ_WAIT_MS = 20_000;
const READ_POLL_MS = 500;

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
      /** Nothing has read the file yet, and nothing has decided it cannot
       * be read: the caller may ask for its read and wait for it. */
      readonly kind: 'unread';
      readonly filename: string;
      readonly indexing: OnDemandIndexingState;
    }
  | {
      /** A picture: no text to read, so its stored facts instead. */
      readonly kind: 'image';
      readonly filename: string;
      readonly contentType: string;
      readonly sizeBytes: number;
    }
  | {
      readonly kind: 'unreadable';
      readonly filename: string;
      readonly sizeBytes: number;
      readonly indexing: OnDemandIndexingState;
      /** A document holds the file, so a person can start its index run
       * (Index now, Reindex, a REST bind). False for an attachment — a
       * chat, task or email file — which no door indexes. */
      readonly heldByDocument: boolean;
      /** An index run could read the file. False when its name alone
       * decides the run's answer (`unsupportedByName`): no extractor reads
       * the type, or it is an image and no vision lane reads images — then
       * no door that indexes it helps. */
      readonly extractable: boolean;
      /** `binary`: no extractor reads the type; `too_large`: the file is
       * over the byte cap of a read before its index; `too_much_text`: its
       * text is over a read's; `read_failed`: its read failed on the
       * platform's side, so only its index can serve it; `pending`: its read
       * is still running; `no_text`: the bytes are empty or gone, or hold no
       * text (a scan with no text layer); `malformed`: the file does not
       * open as its type; `refused`: the organization's secret scan or PII
       * policy refuses its text ({@link refusal} says which). */
      readonly reason:
        | 'binary'
        | 'too_large'
        | 'too_much_text'
        | 'read_failed'
        | 'pending'
        | 'no_text'
        | 'malformed'
        | 'refused';
      readonly refusal?: 'secret-detected' | 'pii-blocked' | 'pii-scan-failed';
    };

/** One read, resolved. */
export type DocumentTextRead =
  | {
      readonly status: 'ok';
      readonly text: string;
      readonly filename: string | null;
      /** The conversation an emailed attachment or an email body arrived
       * on, as its corpus row is stamped — the caller wraps such text as
       * untrusted. Null for everything else, and for an attachment the
       * stamp has not reached or one read on demand: a door that serves mail
       * confirms provenance from the file rows
       * (`lookupMailAttachmentConversations`). */
      readonly conversationId: string | null;
      readonly source: 'corpus' | 'inline' | 'file';
    }
  | {
      /** The ref names a picture the caller may read. A picture holds no
       * text, and pixels are not read through this reader; its stored type
       * and size answer instead, so a question about them is no failure. */
      readonly status: 'image';
      readonly filename: string;
      readonly contentType: string;
      readonly sizeBytes: number;
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

/** The same, for an email ref: denied, deleted, or not indexed — one
 * sentence for every case, so a fetch cannot probe for a message. */
export const MISSING_EMAIL_MESSAGE =
  'No readable email with that ref in this organization. Re-run ' +
  'rag_search and use a ref from its results.';

const MISSING_EMAIL: DocumentTextRead = {
  status: 'not_found',
  message: MISSING_EMAIL_MESSAGE,
};

/**
 * What a `rag_fetch` of a picture answers, at both doors: its stored type
 * and size, and where its content is — in the message it was attached to,
 * as pixels a model that reads pictures sees. Not a failure: asked about an
 * attached picture's format or size, a model used to fetch it as a document
 * and show the person a failed step.
 */
export function pictureFacts(
  read: Extract<DocumentTextRead, { status: 'image' }>,
  ref: string,
) {
  return {
    kind: 'image' as const,
    ref,
    filename: read.filename,
    contentType: read.contentType,
    sizeBytes: read.sizeBytes,
    size: formatFileSize(read.sizeBytes),
    note:
      'A picture holds no text for rag_fetch to read. The picture itself ' +
      'reaches you in the message it was attached to when you can see ' +
      'pictures: describe it from there, and never guess at what it shows ' +
      'otherwise.',
  };
}

const SAY_SO = 'Say so instead of guessing at its contents.';

/** The remedy for a document that will never index on its own. Only a
 * document has one: an attachment — a chat, task or email file — is on no
 * list and no Index now reaches it, so its misses end at {@link SAY_SO}
 * rather than send the model to a door that cannot open. */
const INDEX_IT =
  "Index it from the project's Knowledge tab (or bind it over the API with " +
  'skipRagIndexing: false), then fetch it again.';

function mib(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MiB`;
}

/** What the organization's own checks refused, in the model's words. */
export const REFUSED_BY = {
  'secret-detected':
    "the organization's secret scan found what looks like a credential in it",
  'pii-blocked': "the organization's PII policy blocks its content",
  'pii-scan-failed': "the organization's PII policy could not scan it",
} as const;

/** What a file too large to read before its index can still expect of that
 * index, by the index's true state. */
function indexTail(
  file: Extract<OnDemandFileRead, { kind: 'unreadable' }>,
): string {
  const { status, error } = file.indexing;
  const because = error !== undefined ? ` (${error})` : '';
  switch (status) {
    case 'queued':
    case 'running':
      return 'It is being indexed — try again shortly, or say so.';
    case 'skipped':
    case 'pending':
      return file.heldByDocument ? INDEX_IT : SAY_SO;
    case 'failed':
      return file.heldByDocument
        ? `Indexing it failed${because}. Say so; it can be re-indexed from the project's Knowledge tab or the Documents page.`
        : `Indexing it failed${because}. ${SAY_SO}`;
    default:
      return SAY_SO;
  }
}

/** The model-facing sentence for a file whose text cannot be served. */
function describeUnreadable(
  file: Extract<OnDemandFileRead, { kind: 'unreadable' }>,
): string {
  const name = `"${file.filename}"`;
  switch (file.reason) {
    case 'binary':
      return `${name} is a file type indexing cannot read, so its content cannot be read here. ${SAY_SO}`;
    case 'no_text':
      return `${name} holds no readable text — the file is empty, or a scan with no text layer. ${SAY_SO}`;
    case 'malformed':
      return `${name} does not open as its file type — it may be damaged or password-protected. ${SAY_SO}`;
    case 'refused':
      return `${name} cannot be read here: ${REFUSED_BY[file.refusal ?? 'pii-blocked']}. ${SAY_SO}`;
    case 'pending':
      return `${name} is still being read. Fetch it again in a moment, or say so instead of guessing at its contents.`;
    case 'read_failed':
      return `${name} could not be read before it is indexed. ${indexTail(file)}`;
    case 'too_much_text':
      return `${name} holds more text than can be read before it is indexed (the limit is ${mib(READ_WITHOUT_INDEX_MAX_TEXT)} of text). ${indexTail(file)}`;
    default:
      // `too_large`: over the byte cap of a read before the index.
      return `${name} is ${mib(file.sizeBytes)} — too large to read before it is indexed (the limit is ${mib(readWithoutIndexCap(file.filename))}). ${indexTail(file)}`;
  }
}

/**
 * The on-demand lane for an admitted ref: the kept read's text or verdict,
 * after asking for the read of a file nothing has read yet and waiting up to
 * {@link READ_WAIT_MS} for one still to come.
 */
async function readKeptText(
  ctx: ActionCtx,
  args: ReadDocumentTextArgs,
): Promise<OnDemandFileRead | null> {
  const ask = { organizationId: args.organizationId, storageId: args.fileId };
  let file: OnDemandFileRead | null = await ctx.runQuery(
    internal.file_metadata.internal_queries.readTextOnDemandForAgent,
    ask,
  );
  if (file?.kind === 'unread') {
    const queued: boolean = await ctx.runMutation(
      internal.file_metadata.internal_mutations.requestTextRead,
      ask,
    );
    if (!queued) return file;
  } else if (file?.kind !== 'unreadable' || file.reason !== 'pending') {
    return file;
  }
  const deadline = Date.now() + READ_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, READ_POLL_MS));
    file = await ctx.runQuery(
      internal.file_metadata.internal_queries.readTextOnDemandForAgent,
      ask,
    );
    const waiting =
      file?.kind === 'unread' ||
      (file?.kind === 'unreadable' && file.reason === 'pending');
    if (!waiting) return file;
  }
  return file;
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

  // An email body is served from the corpus or not at all. It has no
  // document row and no stored bytes for the lanes below, and reading the
  // message row instead would serve the very text the indexer's secret scan
  // or the organization's PII policy refused.
  if (isMessageRef(args.fileId)) return MISSING_EMAIL;

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

  const file = await readKeptText(ctx, args);
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
  if (file.kind === 'image') {
    return {
      status: 'image',
      filename: file.filename,
      contentType: file.contentType,
      sizeBytes: file.sizeBytes,
    };
  }
  if (file.kind === 'unread') {
    // Asked for, and no read came — none could be queued for it.
    return {
      status: 'not_found',
      message: `"${file.filename}" could not be read. ${SAY_SO}`,
      filename: file.filename,
    };
  }
  return {
    status: 'not_found',
    message: describeUnreadable(file),
    filename: file.filename,
  };
}
