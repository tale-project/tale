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

/** A pinned folder (display metadata; its files ride `KbReferencedFile[]`). */
export interface KbReferencedFolder {
  folderId: string;
  name: string;
  fileCount: number;
  /** Files considered but not RAG-indexed — see `ResolvedKbFolder.skippedCount`
   *  (resolve_referenced_folders.ts). Surfaced on the folder chip so an
   *  all-unindexed folder never silently reads "0 files" (issue #2598). */
  skippedCount: number;
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

/**
 * Folder marker — deliberately shaped so `ENRICHED_ATTACHMENT_MARKER`
 * cannot match it (different key names); the client extracts it with its
 * own `KB_FOLDER_MARKER` regex to render a folder chip, and strips it from
 * the visible prose the same way.
 */
export function buildKbFolderBlock(
  folders: readonly KbReferencedFolder[],
): string {
  return folders
    .map(
      (folder) =>
        `📁 Referenced folder from the knowledge base: ${folder.name}\n*(kbFolderId: ${folder.folderId} | folderName: ${folder.name} | folderFileCount: ${folder.fileCount} | folderSkippedCount: ${folder.skippedCount})*`,
    )
    .join('\n\n');
}

export function appendKbReferenceBlock(
  message: string,
  refs: readonly KbReferencedFile[],
  folders: readonly KbReferencedFolder[] = [],
): string {
  const parts = [message];
  if (folders.length > 0) parts.push(buildKbFolderBlock(folders));
  if (refs.length > 0) parts.push(buildKbReferenceBlock(refs));
  return parts.filter(Boolean).join('\n\n');
}
