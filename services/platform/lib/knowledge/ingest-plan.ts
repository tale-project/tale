/**
 * What to do with a document that is being indexed — decided as a pure
 * function, so the two behaviours that were hardest to get right can be tested
 * exhaustively without a database.
 *
 * **Content-hash dedup.** Indexing is the expensive part of the system: text
 * extraction, optional OCR, and one embedding call per chunk. Re-uploading an
 * unchanged file, re-syncing a folder, or retrying a failed request must not
 * pay that again. A document whose content hash matches what is already stored,
 * and which is stored COMPLETELY, is skipped.
 *
 * **Resumable slicing.** A large document takes longer to index than one
 * invocation is allowed to run, so indexing commits chunks in slices and the
 * committed prefix IS the checkpoint. When the same content comes back, storing
 * resumes after the last committed chunk instead of starting over — without
 * that, a document big enough to exceed the window could never finish, because
 * every attempt would redo the work the previous attempt had already done and
 * run out of time at the same place.
 *
 * The subtlety that makes these two interact correctly: only a COMPLETED row
 * counts as "already indexed". A row still marked `processing` with a matching
 * hash is an interrupted slice, not a finished document — treating it as a
 * duplicate would leave the document permanently half-indexed, silently missing
 * its tail from every search. And a CHANGED hash discards the stored prefix
 * entirely, because the chunk boundaries of the new content have nothing to do
 * with the old ones.
 */

/** The row already in the corpus for this document reference, if any. */
export interface StoredDocumentState {
  /** Hash of the content the stored chunks were built from. */
  readonly contentHash: string | null;
  readonly status: 'processing' | 'completed' | 'failed';
  /** How many chunks are committed — the resume checkpoint. */
  readonly storedChunks: number;
}

export interface IngestPlanInput {
  /** Hash of the content being indexed now. */
  readonly contentHash: string;
  /** How many chunks the new content produces. */
  readonly totalChunks: number;
  /** What is already stored, or `null` when this reference is new. */
  readonly stored: StoredDocumentState | null;
  /**
   * Another COMPLETED document in the SAME organization with the same content
   * hash, if one exists. Its chunks and embeddings can be copied instead of
   * recomputed. Never a document of another organization: a corpus row is
   * tenant data, and reusing one across organizations would leak both the
   * content and the fact that the other organization has it.
   */
  readonly duplicateOf?: string | null;
}

export type IngestPlan =
  /** Already indexed, completely, from this exact content. Nothing to do. */
  | { readonly action: 'skip'; readonly reason: 'unchanged' }
  /** Identical content is already embedded elsewhere in this organization —
   * copy its chunks rather than paying for the embeddings again. */
  | { readonly action: 'clone'; readonly sourceDocumentId: string }
  /** An interrupted slice of this exact content — continue after the committed
   * prefix. */
  | { readonly action: 'resume'; readonly fromChunk: number }
  /** New content for a reference that already has chunks — discard them and
   * store from the start. */
  | { readonly action: 'rewrite' }
  /** Nothing stored for this reference yet. */
  | { readonly action: 'index' };

/**
 * Decide how to index a document.
 *
 * Order matters: an unchanged complete document is cheapest, then a clone of an
 * identical document, then a resume of an interrupted one. Only a genuinely
 * different — or genuinely absent — document is indexed from scratch.
 */
export function planIngest(input: IngestPlanInput): IngestPlan {
  const stored = input.stored;

  if (stored !== null && stored.contentHash === input.contentHash) {
    // Complete means: marked completed AND every chunk the current content
    // produces is committed. The second half matters because a document can be
    // stamped completed and later have its chunk count grow if the chunker
    // changes; treating it as done would leave the tail unsearchable.
    if (
      stored.status === 'completed' &&
      stored.storedChunks >= input.totalChunks
    ) {
      return { action: 'skip', reason: 'unchanged' };
    }
    if (stored.storedChunks > 0) {
      return { action: 'resume', fromChunk: stored.storedChunks };
    }
  }

  // A clone is only safe when nothing of this document is stored yet under this
  // reference — otherwise the resume path above owns the decision and copying
  // would overwrite a prefix that is already correct.
  if (
    input.duplicateOf !== undefined &&
    input.duplicateOf !== null &&
    (stored === null || stored.contentHash !== input.contentHash)
  ) {
    return { action: 'clone', sourceDocumentId: input.duplicateOf };
  }

  if (stored !== null) return { action: 'rewrite' };
  return { action: 'index' };
}

/**
 * The chunks one invocation should store, given where it is resuming from.
 *
 * Returned as a window rather than a filtered copy so a caller can report
 * progress against the whole document, and so an empty window is an obvious
 * "nothing left to do" rather than an ambiguous empty array.
 */
export function sliceToStore(
  totalChunks: number,
  fromChunk: number,
  maxPerSlice: number,
): { readonly from: number; readonly to: number; readonly done: boolean } {
  const from = Math.max(0, Math.min(fromChunk, totalChunks));
  const to = Math.min(totalChunks, from + Math.max(1, maxPerSlice));
  return { from, to, done: to >= totalChunks };
}
