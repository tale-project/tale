/**
 * Pure formatting for the attachment appendix the chat turn injects into the
 * MODEL-facing user turn when the message carries document / text or image
 * attachments. The stored bubble keeps the typed text only; the host loads
 * `fileMetadata` and hands the rows here. This module never touches Convex.
 *
 * An image rides the wire as pixels, which name neither the file nor its
 * ref (a model without vision gets a placeholder naming only the file); the
 * image appendix names both, so a tool that starts from a file —
 * `generate_image`'s `inputImages`, `run_code`'s `files` — can be handed the
 * upload.
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

export interface ImageAppendixEntry {
  readonly fileName: string;
  /** Blob reference — the `ref` a tool that takes files is handed. */
  readonly fileId: string;
}

/**
 * Build the markdown appendix naming each attached image and its ref.
 * Empty input → empty string (caller leaves `userText` untouched).
 */
export function buildImageAppendix(
  entries: readonly ImageAppendixEntry[],
): string {
  if (entries.length === 0) return '';
  // The name in JSON's quoting: a quote or a line break in it stays inside
  // the entry instead of ending it.
  const lines = entries.map(
    (entry) => `- ${JSON.stringify(entry.fileName)} (ref: ${entry.fileId})`,
  );
  // No tool is named: the appendix rides every turn, also one that is
  // offered no tool taking files, and a model is never told about a tool
  // it was not offered (CHAT-R18).
  return `\n\n---\n**Attached images** (pass a ref to a tool that takes files)\n${lines.join('\n')}\n---\n`;
}
