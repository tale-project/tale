'use node';

/**
 * Making a document ready to index, before anything is stored: the secret
 * scan, the organization's PII policy, the chunker and the content hash.
 *
 * Everything here looks at the whole text and touches no database, which is
 * what lets it run where the text is: in this process for a mail body or a
 * page, and in the heavy slot's child for a file, whose text this process
 * then never holds (`backend/lib/heavy-slot`, tale-project/tale#4942).
 * `indexing.ts` stores what this module prepares.
 */

import type { PiiConfig } from '@tale/shared/schemas/pii';
import { computeContentHash } from '@tale/shared/utils/hashing';

import {
  chunksOf,
  type ContextualChunk,
} from '../../../lib/knowledge/chunking';
import { sanitizeExtractedText } from '../../../lib/knowledge/sanitize-text';
import {
  scanForSecrets,
  type SecretScanResult,
} from '../../../lib/knowledge/secret-scan';
import { applyPiiPolicyForIndexing, type PiiScanFailure } from './pii_gate';

/**
 * A document made ready to index: the secret scan, the PII policy, the
 * chunker and the content hash have run once over the whole text.
 *
 * Preparation is a pass over the ENTIRE document — the PII scan alone is
 * seconds of synchronous work on a large file — while one slice commits at
 * most `CHUNKS_PER_SLICE` chunks. A caller that drives a document through
 * several slices prepares it once and hands the result to every slice.
 */
export type PreparedDocument =
  /** Refused before anything is stored: a credential in the bytes, the
   * organization's PII policy said `block`, or that policy could not scan
   * the document. */
  | {
      readonly kind: 'refused';
      readonly skipped: 'secret-detected' | 'pii-blocked' | 'pii-scan-failed';
      /** The refusal, in words for the person who uploaded the file. */
      readonly reason: string | null;
    }
  /** No text to index. */
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'ready';
      /** Hash of the text the chunks were built from — the content's identity. */
      readonly contentHash: string;
      /** The name the corpus row stores — `filename` under the PII policy,
       * like the text. */
      readonly filename: string;
      readonly chunks: PreparedChunks;
    };

/** One chunk of a prepared document. */
export interface PreparedChunk {
  readonly chunk: ContextualChunk;
  /** Whether its text repeats an earlier chunk's: stored without a vector,
   * embedded and searched once through its first occurrence. */
  readonly repeat: boolean;
}

/**
 * The chunks of a prepared document, asked for a slice at a time.
 *
 * A slice is all that indexing holds at once: it embeds and stores sixty-four
 * chunks, then asks for the next. So the chunks need not be in this process's
 * memory at all — the heavy slot's child writes them to a file, and they are
 * read from it as they are stored (`backend/lib/heavy-slot`). A document
 * prepared in this process keeps them in memory, as before.
 */
export interface PreparedChunks {
  readonly total: number;
  /** The chunks from `from` up to, not including, `to`, in order. */
  window(from: number, to: number): Promise<readonly PreparedChunk[]>;
}

/** Chunks held in memory. */
export function chunksInMemory(
  chunks: readonly ContextualChunk[],
  repeats: ReadonlySet<number>,
): PreparedChunks {
  return {
    total: chunks.length,
    window: (from, to) =>
      Promise.resolve(
        chunks
          .slice(from, to)
          .map((chunk) => ({ chunk, repeat: repeats.has(chunk.index) })),
      ),
  };
}

/**
 * What {@link prepareContent} answers: a prepared document whose chunks are
 * cut as they are asked for, for a caller that stores each as it comes.
 */
export type PreparedContent =
  | Exclude<PreparedDocument, { kind: 'ready' }>
  | {
      readonly kind: 'ready';
      readonly contentHash: string;
      readonly filename: string;
      /** The chunks in order, each cut when it is asked for. They can be
       * gone through once. */
      readonly chunks: Iterable<PreparedChunk>;
    };

export interface PrepareDocumentArgs {
  /** The document's text, already extracted. */
  readonly text: string;
  /** The original bytes, scanned for credentials. Omitted when the caller has
   * already scanned them. */
  readonly bytes?: Uint8Array;
  /** The verdict of a scan already made of the original bytes, in place of
   * `bytes`: a file read as a stream is scanned as it is read
   * (`SecretScanner`). */
  readonly scanned?: SecretScanResult;
  /** The organization's PII policy, already parsed; absent or disabled
   * indexes the text as it is. */
  readonly piiConfig?: PiiConfig | null;
  readonly filename: string;
  /** What the chunk header announces when it should differ from `filename`
   * (see `IndexDocumentArgs.title`). */
  readonly title?: string;
}

/** The verdict on the original bytes: the one handed in, else a scan of the
 * bytes handed in, else none. */
function scanOf(args: {
  readonly bytes?: Uint8Array;
  readonly scanned?: SecretScanResult;
}): SecretScanResult | null {
  if (args.scanned !== undefined) return args.scanned;
  return args.bytes !== undefined ? scanForSecrets(args.bytes) : null;
}

/**
 * The refusal stored for a document the organization's PII policy could not
 * scan, one fixed sentence per cause. Fixed, because the policy save and the
 * pass that resumes the scans the protection could not start find the email
 * bodies it refused by it: they have no file row to carry `pii_scan_failed`
 * (`requeuePiiScanFailedDocuments`). Files carry it as their `rag_error`
 * too, and the pass picks its cause by it.
 */
export const PII_SCAN_FAILED_REASONS = {
  unavailable:
    "Indexing refused: the organization's PII protection could not be started, so this document could not be scanned; the cause is in the platform log.",
  incomplete:
    "Indexing refused: part of this document could not be scanned under the organization's PII policy; the cause is in the platform log.",
} as const satisfies Record<PiiScanFailure, string>;

function scanFailed(cause: PiiScanFailure): PreparedContent {
  return {
    kind: 'refused',
    skipped: 'pii-scan-failed',
    reason: PII_SCAN_FAILED_REASONS[cause],
  };
}

/**
 * Prepare a document for indexing — pure, no database.
 *
 * Runs everything that looks at the whole text, in the order the write path
 * always ran it: the secret scan first (a credential must never be chunked),
 * then the organization's PII policy, then the chunker and the hash.
 */
export function prepareDocument(args: PrepareDocumentArgs): PreparedDocument {
  const content = prepareContent(args);
  if (content.kind !== 'ready') return content;
  const chunks: ContextualChunk[] = [];
  const repeats = new Set<number>();
  for (const { chunk, repeat } of content.chunks) {
    chunks.push(chunk);
    if (repeat) repeats.add(chunk.index);
  }
  return {
    kind: 'ready',
    contentHash: content.contentHash,
    filename: content.filename,
    chunks: chunksInMemory(chunks, repeats),
  };
}

/**
 * The same preparation, with the chunks cut as they are asked for: what the
 * heavy slot's child writes to a file, a chunk at a time, for the process
 * that stores them. Everything that decides whether the document is indexed
 * has run when this returns; only the cutting is left to the reader of
 * `chunks`, so a long document is never held as a list of its chunks, which
 * is five to seven times its text (tale-project/tale#4942).
 */
export function prepareContent(args: PrepareDocumentArgs): PreparedContent {
  const scan = scanOf(args);
  if (scan?.rejected === true) {
    return {
      kind: 'refused',
      skipped: 'secret-detected',
      reason: scan.reason,
    };
  }

  // The organization's own PII policy, applied before anything is chunked or
  // embedded — so a masked identifier never reaches the vectors, and a blocked
  // document never reaches the index at all.
  // A NUL cannot be stored by the corpus (Postgres `22021`); it is stripped
  // BEFORE the policy and the chunker see the text, so a stray one never
  // fails the chunk INSERT after the embedding was paid for.
  const policy = args.piiConfig ?? null;
  const decision = applyPiiPolicyForIndexing(
    sanitizeExtractedText(args.text),
    policy,
  );
  const names = prepareNames(args, policy);
  const refusedCategories = [
    ...(decision.kind === 'refuse' ? decision.categoryIds : []),
    ...(names.kind === 'refuse' ? names.categoryIds : []),
  ];
  if (decision.kind === 'refuse' || names.kind === 'refuse') {
    return {
      kind: 'refused',
      skipped: 'pii-blocked',
      reason: `Indexing refused by the organization's PII policy (${[...new Set(refusedCategories)].join(', ')}).`,
    };
  }
  // A detection wins, as a blocked window wins across a document's windows:
  // it names what the admin can act on. Without one, a text or a name the
  // policy could not scan keeps the whole document out, in every mode.
  if (decision.kind === 'unscanned') return scanFailed(decision.cause);
  if (names.kind === 'unscanned') return scanFailed(names.cause);

  const cut = chunksOf(decision.text, { title: names.header });
  const first = cut.next();
  if (first.done === true) return { kind: 'empty' };

  // Hashed AFTER the policy, not before. The hash is the content's identity:
  // skip-if-unchanged and the duplicate-clone lookup both key on it. Hashing
  // the raw text would make a policy change invisible — the same file would
  // read as unchanged and keep its old, less-masked chunks forever. A header
  // the policy rewrote is part of that identity too — or a policy switched
  // on would leave the raw header in every chunk of a body it found nothing
  // in; a header it left alone is not, so no stored hash moves for it.
  const contentHash = computeContentHash(
    names.headerMasked ? `${names.header}\n\n${decision.text}` : decision.text,
  );

  return {
    kind: 'ready',
    contentHash,
    filename: names.filename,
    chunks: markRepeats(first.value, cut),
  };
}

/**
 * The chunks of a document, each with whether its text repeats an earlier
 * chunk's.
 *
 * One vector per DISTINCT passage of the document: a chunk whose text
 * repeats an earlier chunk's (an export of one line repeated, a templated
 * report) is stored as a repeat — text kept, so the document reassembles
 * exactly; no embedding, out of both search legs. A file of 4,500 identical
 * chunks used to put 4,500 identical vectors into the shared index, where
 * they crowded out every nearer passage and were ranked 24 times over by
 * the keyword leg (2026-09-14 evaluation, h4).
 */
function* markRepeats(
  first: ContextualChunk,
  rest: Iterable<ContextualChunk>,
): Generator<PreparedChunk, void, undefined> {
  const seen = new Set<string>();
  const marked = (chunk: ContextualChunk): PreparedChunk => {
    const hash = computeContentHash(chunk.text);
    const repeat = seen.has(hash);
    if (!repeat) seen.add(hash);
    return { chunk, repeat };
  };
  yield marked(first);
  for (const chunk of rest) yield marked(chunk);
}

/** A document's text as a reader may hand it on before its index exists. */
export type GatedDocumentText =
  | {
      readonly kind: 'refused';
      readonly skipped: 'secret-detected' | 'pii-blocked' | 'pii-scan-failed';
    }
  | { readonly kind: 'empty' }
  | { readonly kind: 'text'; readonly text: string };

/**
 * The text a reader may hand on of a file whose index is not ready — the
 * same secret scan and PII policy {@link prepareDocument} applies before
 * anything is chunked, in the same order, so text read straight from a file
 * is never less protected than the text its index would serve: a credential
 * in the bytes, or a policy that blocks the text or the file's name, refuses
 * the read; a policy that could not scan either refuses it in every mode; and
 * a masking policy hands on the masked text. The name decides only whether
 * the text may be read — it is not part of what is handed on.
 */
export function gateDocumentText(args: {
  readonly text: string;
  readonly bytes?: Uint8Array;
  /** The verdict of a scan already made of the bytes, in place of them. */
  readonly scanned?: SecretScanResult;
  readonly piiConfig?: PiiConfig | null;
  readonly filename: string;
}): GatedDocumentText {
  if (scanOf(args)?.rejected === true) {
    return { kind: 'refused', skipped: 'secret-detected' };
  }
  const policy = args.piiConfig ?? null;
  const decision = applyPiiPolicyForIndexing(
    sanitizeExtractedText(args.text),
    policy,
  );
  const names = prepareNames(
    { text: args.text, filename: args.filename },
    policy,
  );
  if (decision.kind === 'refuse' || names.kind === 'refuse') {
    return { kind: 'refused', skipped: 'pii-blocked' };
  }
  if (decision.kind === 'unscanned' || names.kind === 'unscanned') {
    return { kind: 'refused', skipped: 'pii-scan-failed' };
  }
  if (decision.text.trim() === '') return { kind: 'empty' };
  return { kind: 'text', text: decision.text };
}

/**
 * The chunk header and the stored name, under the same PII policy as the
 * text.
 *
 * The header is indexed text: it is prepended to every chunk, so it is
 * embedded, stored in `chunk_content`, matched by the keyword leg and shown
 * as the passage a search returns — and the name is what a hit is titled
 * by. An email body's header names its subject and its sender (`Subject —
 * from Name <address>`), so a policy that masks addresses in the body and
 * not in the header would still send every correspondent's address to the
 * embedding provider. `mask` masks both; `block` refuses the document when
 * either matches, as it does for the text; and a name the policy could not
 * scan refuses it in every mode — it is never stored or embedded as it is.
 */
function prepareNames(
  args: PrepareDocumentArgs,
  policy: PiiConfig | null,
):
  | {
      readonly kind: 'index';
      readonly header: string;
      readonly filename: string;
      /** Whether the policy rewrote the header. */
      readonly headerMasked: boolean;
    }
  | { readonly kind: 'refuse'; readonly categoryIds: readonly string[] }
  | { readonly kind: 'unscanned'; readonly cause: PiiScanFailure } {
  const header = args.title ?? args.filename;
  // No policy, nothing to scrub — and no scan paid for twice.
  if (policy === null) {
    return {
      kind: 'index',
      header,
      filename: args.filename,
      headerMasked: false,
    };
  }
  const headerDecision = applyPiiPolicyForIndexing(header, policy);
  const filenameDecision =
    args.title === undefined
      ? headerDecision
      : applyPiiPolicyForIndexing(args.filename, policy);
  if (headerDecision.kind === 'refuse' || filenameDecision.kind === 'refuse') {
    return {
      kind: 'refuse',
      categoryIds: [
        ...(headerDecision.kind === 'refuse' ? headerDecision.categoryIds : []),
        ...(filenameDecision.kind === 'refuse'
          ? filenameDecision.categoryIds
          : []),
      ],
    };
  }
  if (headerDecision.kind === 'unscanned') return headerDecision;
  if (filenameDecision.kind === 'unscanned') return filenameDecision;
  return {
    kind: 'index',
    header: headerDecision.text,
    filename: filenameDecision.text,
    headerMasked: headerDecision.text !== header,
  };
}
