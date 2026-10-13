import type { Sql } from 'postgres';

import type { ToolArtifact } from '../../../lib/chat/tools.ts';
import { putOrgBlobBytes } from '../files/service.ts';

/**
 * The files an agent turn produces — a document the light sandbox wrote, a
 * file the model typed out, a generated image — stored the way a chat
 * upload is: one blob in the organization's own store and one file row
 * bound to the turn's conversation. A chat's conversation is its thread; a
 * task run's is the run's transcript thread, so a run's files are stored by
 * the same code.
 *
 * The binding is what makes the file the conversation's: a thread-bound
 * row reads for the person who owns the chat and for the members of a
 * project it is shared with (`files/access.ts`), exactly like the files
 * that person attached, and for nobody else — a run's file reads for
 * everyone who can read the task. The row names the person as its
 * uploader, so their erasure takes it, and its source is `agent`, so the
 * organization's retention rule for agent-produced files covers it. It is
 * not indexed: the model reads a file it made through the sandbox, by its
 * ref, never through a search.
 */

/** The largest file a turn stores — the size the sandbox delivers one
 * output at, and well above any document a chat produces. */
export const ARTIFACT_MAX_BYTES = 20 * 1024 * 1024;

export interface ThreadArtifactScope {
  readonly organizationId: string;
  /** The person whose turn produced the file — the chat's owner. */
  readonly userId: string;
  /** The conversation's lineage root: the thread every version of the chat
   * shares, which uploads bind to as well. */
  readonly threadId: string;
  /** The project the chat is filed in, when it is. */
  readonly projectId?: string;
}

/** Store one produced file and bind it to the conversation. Throws on an
 * empty or oversized file and on a store or database failure — the caller
 * reports the failure to the model as the tool's result. */
export async function storeThreadArtifact(
  sql: Sql,
  scope: ThreadArtifactScope,
  file: { name: string; mediaType: string; bytes: Uint8Array },
): Promise<ToolArtifact> {
  if (file.bytes.byteLength === 0) {
    throw new Error(`"${file.name}" is empty`);
  }
  if (file.bytes.byteLength > ARTIFACT_MAX_BYTES) {
    throw new Error(
      `"${file.name}" is ${Math.ceil(file.bytes.byteLength / (1024 * 1024))} MB; a file of at most ${ARTIFACT_MAX_BYTES / (1024 * 1024)} MB can be attached`,
    );
  }
  const ref = await putOrgBlobBytes(sql, scope.organizationId, {
    bytes: file.bytes,
    contentType: file.mediaType,
  });
  await sql`
    INSERT INTO app.file_metadata (
      org_id, storage_ref, file_name, content_type, size, source,
      uploaded_by, thread_id, project_id, skip_rag_indexing, created_at_ms
    ) VALUES (
      ${scope.organizationId}, ${ref}, ${file.name}, ${file.mediaType},
      ${file.bytes.byteLength}, 'agent', ${scope.userId}, ${scope.threadId},
      ${scope.projectId ?? null}, true, ${Date.now()}
    )
  `;
  return {
    ref,
    name: file.name,
    mediaType: file.mediaType,
    sizeBytes: file.bytes.byteLength,
  };
}

/** A file of the conversation a tool may read back: an upload or a file a
 * turn produced, by its ref. */
export interface ThreadFile {
  readonly ref: string;
  readonly name: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
}

/**
 * The conversation's files among `refs` — uploads and produced files bound
 * to any thread of the lineage — keyed by ref. A ref that names no such row
 * (another chat's file, a document, a typo) is simply absent: a tool may
 * only read what the conversation itself holds.
 */
export async function readThreadFiles(
  sql: Sql,
  scope: { organizationId: string; threadIds: readonly string[] },
  refs: readonly string[],
): Promise<Map<string, ThreadFile>> {
  const found = new Map<string, ThreadFile>();
  if (refs.length === 0 || scope.threadIds.length === 0) return found;
  const rows = await sql<
    { ref: string; name: string; mediaType: string; sizeBytes: number }[]
  >`
    SELECT storage_ref AS ref, file_name AS name,
           content_type AS "mediaType", size::float8 AS "sizeBytes"
    FROM app.file_metadata
    WHERE org_id = ${scope.organizationId}
      AND thread_id = ANY(${[...scope.threadIds]})
      AND storage_ref = ANY(${[...refs]})
  `;
  for (const row of rows) {
    if (!found.has(row.ref)) found.set(row.ref, row);
  }
  return found;
}
