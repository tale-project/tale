/**
 * Knowledge-base reference block appended to a user message when the composer
 * pins documents via `@`-mention.
 *
 * The `*(fileId: … | fileName: … | fileType: … | fileSize: …)*` marker line
 * MUST byte-match the enriched attachment marker emitted by
 * `buildMessageWithAttachments` (start_agent_chat.ts): the client extracts it
 * with `ENRICHED_ATTACHMENT_MARKER` / strips it with `INTERNAL_ENRICHED_BLOCK`
 * (app/features/chat/hooks/use-message-processing.ts) to render file chips on
 * the sent bubble, and the `rag_search` tool's prompt tells the model to
 * prioritize fileIds found in the message. The round-trip is locked by a test
 * in use-message-processing.test.ts.
 *
 * Kept dependency-free so app-side tests can import it without pulling the
 * Convex runtime.
 */

export interface KbReferencedFile {
  documentId: string;
  fileId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
}

export function buildKbReferenceBlock(
  refs: readonly KbReferencedFile[],
): string {
  return refs
    .map(
      (ref) =>
        `📚 Referenced from the knowledge base: ${ref.fileName}\n*(fileId: ${ref.fileId} | fileName: ${ref.fileName} | fileType: ${ref.fileType} | fileSize: ${ref.fileSize})*`,
    )
    .join('\n\n');
}

export function appendKbReferenceBlock(
  message: string,
  refs: readonly KbReferencedFile[],
): string {
  if (refs.length === 0) return message;
  const block = buildKbReferenceBlock(refs);
  return message ? `${message}\n\n${block}` : block;
}
