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
 * `convex/documents/filter_retrievable_rag_file_ids.ts`), and the model
 * reads their content through its `rag_fetch` tool rather than inline
 * bytes — from the index, or, while the index is not ready, from the text
 * the platform read and checked right after the upload. Every entry names
 * the stored file's type and size, so a question about them needs no tool
 * at all.
 */

import { formatFileSize } from '@tale/ui/format';

/** The stored file's own media type and size — the store's figures, never
 * the ones a client sent along. */
interface StoredFacts {
  readonly contentType?: string;
  readonly sizeBytes?: number;
}

export interface DocumentAppendixEntry extends StoredFacts {
  readonly fileName: string;
  /** Blob reference — the `ref` a `rag_fetch` call takes for documents. */
  readonly fileId: string;
  /** How the assistant can read the document now, as the host decided it:
   * `fetch` — `rag_fetch` serves its text, from its index or, while the
   * index is not ready, from the text read and checked after the upload
   * (CHAT-R48); `indexing` — only its index can serve it (too large to read
   * before), and the index is still being built; `refused` — the
   * organization's secret scan or PII policy refuses its content;
   * `unreadable` — it holds no text a reader finds, or only its index could
   * serve it and the index failed. */
  readonly reading: 'fetch' | 'indexing' | 'refused' | 'unreadable';
  /** The index's state, named when the text cannot be read. */
  readonly ragStatus?:
    | 'queued'
    | 'running'
    | 'completed'
    | 'failed'
    | 'unsupported';
}

/** A file's type and size in words a person reads them in: the size as the
 * attachment chip shows it, and the exact byte count beside it. Empty when
 * the host knows neither. */
function describeFacts(entry: StoredFacts): string {
  const facts: string[] = [];
  if (entry.contentType !== undefined && entry.contentType.length > 0) {
    facts.push(entry.contentType);
  }
  if (
    entry.sizeBytes !== undefined &&
    Number.isFinite(entry.sizeBytes) &&
    entry.sizeBytes >= 0
  ) {
    facts.push(
      `${formatFileSize(entry.sizeBytes)}, ${Math.round(entry.sizeBytes).toLocaleString('en-US')} bytes`,
    );
  }
  return facts.join(', ');
}

/**
 * Build the markdown appendix for one or more document attachments.
 * Empty input → empty string (caller leaves `userText` untouched).
 * Every entry names the file's type and size; a readable one points the
 * model at its retrieval tool, everything else gets an honest marker so the
 * model never pretends to have read the file.
 */
export function buildDocumentAppendix(
  entries: readonly DocumentAppendixEntry[],
): string {
  if (entries.length === 0) return '';

  const lines: string[] = [];
  for (const entry of entries) {
    const facts = describeFacts(entry);
    const name = `"${entry.fileName}"${facts.length > 0 ? ` (${facts})` : ''}`;
    switch (entry.reading) {
      case 'fetch':
        // rag_fetch ONLY: the ref is in hand, so searching the whole
        // organization for a file the model already holds is never the move.
        lines.push(
          `- ${name} — read it with rag_fetch (ref: ${entry.fileId}).`,
        );
        break;
      case 'indexing':
        lines.push(
          `- ${name} — can be read only once its index is built, which is still running (ref: ${entry.fileId}). rag_fetch may return nothing yet; say so instead of guessing.`,
        );
        break;
      case 'refused':
        // No ref: a tool that takes files would hand the model the very
        // bytes the organization's checks refused.
        lines.push(
          `- ${name} — the organization's secret scan or PII policy refuses its content, so it cannot be read here. Say so instead of guessing at it.`,
        );
        break;
      default:
        lines.push(
          `- ${name} — its content is not machine-readable in this chat (indexing ${entry.ragStatus ?? 'unavailable'}). Ask the user to paste the content or convert the file if you need it (ref: ${entry.fileId}).`,
        );
    }
  }
  return `\n\n---\n**Attached documents** (read with rag_fetch)\n${lines.join('\n')}\n---\n`;
}

export interface ImageAppendixEntry extends StoredFacts {
  readonly fileName: string;
  /** Blob reference — the `ref` a tool that takes files is handed. */
  readonly fileId: string;
}

/**
 * Build the markdown appendix naming each attached image, its type and size,
 * and its ref. Empty input → empty string (caller leaves `userText`
 * untouched).
 */
export function buildImageAppendix(
  entries: readonly ImageAppendixEntry[],
): string {
  if (entries.length === 0) return '';
  // The name in JSON's quoting: a quote or a line break in it stays inside
  // the entry instead of ending it.
  const lines = entries.map((entry) => {
    const facts = describeFacts(entry);
    return `- ${JSON.stringify(entry.fileName)} (${facts.length > 0 ? `${facts}; ` : ''}ref: ${entry.fileId})`;
  });
  // No tool is named: the appendix rides every turn, also one that is
  // offered no tool taking files, and a model is never told about a tool
  // it was not offered (CHAT-R18).
  return `\n\n---\n**Attached images** (pass a ref to a tool that takes files)\n${lines.join('\n')}\n---\n`;
}
