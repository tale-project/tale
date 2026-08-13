/**
 * Pure formatting for the document appendix the chat turn injects into the
 * MODEL-facing user turn when the message carries document / text
 * attachments. The stored bubble keeps the typed text only; the host loads
 * `fileMetadata` and hands the rows here. This module never touches Convex.
 *
 * The 0.3 lane enriched every attachment marker with a retrieval hint; the
 * 0.4 equivalent is this appendix. Chat-uploaded documents are RAG-indexed
 * on upload (thread-scoped retrieval — see
 * `convex/documents/filter_retrievable_rag_file_ids.ts`), so the model
 * reads their content through its `rag_search` / `rag_fetch` tools rather
 * than inline bytes.
 */

export interface DocumentAppendixEntry {
  readonly fileName: string;
  /** Blob reference — the `ref` a `rag_fetch` call takes for documents. */
  readonly fileId: string;
  readonly ragStatus?:
    | 'queued'
    | 'running'
    | 'completed'
    | 'failed'
    | 'unsupported';
}

/**
 * Build the markdown appendix for one or more document attachments.
 * Empty input → empty string (caller leaves `userText` untouched).
 * Indexed rows point the model at its retrieval tools; everything else gets
 * an honest marker so the model never pretends to have read the file.
 */
export function buildDocumentAppendix(
  entries: readonly DocumentAppendixEntry[],
): string {
  if (entries.length === 0) return '';

  const lines: string[] = [];
  for (const entry of entries) {
    if (entry.ragStatus === 'completed') {
      // rag_fetch ONLY: the ref is in hand, so searching the whole
      // organization for a file the model already holds is never the move.
      lines.push(
        `- "${entry.fileName}" — indexed. Read it with rag_fetch (ref: ${entry.fileId}).`,
      );
    } else if (entry.ragStatus === 'queued' || entry.ragStatus === 'running') {
      lines.push(
        `- "${entry.fileName}" — still being indexed (ref: ${entry.fileId}). rag_fetch may return nothing yet; say so instead of guessing.`,
      );
    } else {
      lines.push(
        `- "${entry.fileName}" — its content is not machine-readable in this chat (indexing ${entry.ragStatus ?? 'unavailable'}). Ask the user to paste the content or convert the file if you need it.`,
      );
    }
  }
  return `\n\n---\n**Attached documents** (read with rag_fetch)\n${lines.join('\n')}\n---\n`;
}
