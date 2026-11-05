import type { Sql } from 'postgres';

import type { ToolArtifact } from '../../../lib/chat/tools.ts';
import { REFUSED_BY } from '../../core/knowledge/document_text.ts';
import {
  RAG_ERROR_PII_BLOCKED,
  RAG_ERROR_PII_SCAN_FAILED,
  RAG_ERROR_SECRET_DETECTED,
} from '../../core/knowledge/rag_error_codes.ts';
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
  /** Why no tool may take the file ({@link withheldFile}). */
  readonly withheld?: WithheldFile;
}

/** Why a tool may not take a file the conversation holds: the
 * organization's secret scan or PII policy refused its text, or that check
 * is still running. */
export type WithheldFile =
  | 'secret-detected'
  | 'pii-blocked'
  | 'pii-scan-failed'
  | 'checking';

const REFUSALS: Readonly<
  Record<string, Exclude<WithheldFile, 'checking'> | undefined>
> = {
  [RAG_ERROR_SECRET_DETECTED]: 'secret-detected',
  [RAG_ERROR_PII_BLOCKED]: 'pii-blocked',
  [RAG_ERROR_PII_SCAN_FAILED]: 'pii-scan-failed',
};

/** What a tool says of a withheld file, in the model's words. */
export function withheldFileMessage(name: string, why: WithheldFile): string {
  return why === 'checking'
    ? `"${name}" is still being checked against the organization's secret scan and PII policy. Try again in a moment.`
    : `"${name}" cannot be used here: ${REFUSED_BY[why]}. Say so instead of working around it.`;
}

/**
 * Whether a tool that takes files must leave this one out, and why. The
 * organization's checks guard a file's text on its way to the model, and a
 * tool that copies the file into a sandbox would hand the model the very
 * bytes they refused — so a refused file is withheld, by its read
 * (`text_status`) or by its index, and so is a file whose check is still
 * running: its read, or the index a read left the file to (a file too large
 * to read first, or one uploaded before reads existed).
 */
export function withheldFile(row: {
  readonly textStatus: string | null;
  readonly textErrorCode: string | null;
  readonly ragStatus: string | null;
  readonly ragErrorCode: string | null;
}): WithheldFile | undefined {
  if (row.textStatus === 'refused') {
    return REFUSALS[row.textErrorCode ?? ''] ?? 'pii-blocked';
  }
  if (row.ragStatus === 'failed' && row.ragErrorCode !== null) {
    const refused = REFUSALS[row.ragErrorCode];
    // A PII scan that could not run at the index decided nothing; a read
    // that checked the text since has the word.
    const checkedSince =
      refused === 'pii-scan-failed' && row.textStatus === 'ready';
    if (refused !== undefined && !checkedSince) return refused;
  }
  if (row.textStatus === 'queued' || row.textStatus === 'running') {
    return 'checking';
  }
  const readChecked =
    row.textStatus === 'ready' ||
    row.textStatus === 'refused' ||
    row.textStatus === 'unreadable';
  if (
    !readChecked &&
    (row.ragStatus === 'queued' || row.ragStatus === 'running')
  ) {
    return 'checking';
  }
  return undefined;
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
    ({
      ref: string;
      name: string;
      mediaType: string;
      sizeBytes: number;
    } & Parameters<typeof withheldFile>[0])[]
  >`
    SELECT storage_ref AS ref, file_name AS name,
           content_type AS "mediaType", size::float8 AS "sizeBytes",
           text_status AS "textStatus", text_error_code AS "textErrorCode",
           rag_status AS "ragStatus", rag_error_code AS "ragErrorCode"
    FROM app.file_metadata
    WHERE org_id = ${scope.organizationId}
      AND thread_id = ANY(${[...scope.threadIds]})
      AND storage_ref = ANY(${[...refs]})
  `;
  for (const row of rows) {
    if (found.has(row.ref)) continue;
    const withheld = withheldFile(row);
    found.set(row.ref, {
      ref: row.ref,
      name: row.name,
      mediaType: row.mediaType,
      sizeBytes: row.sizeBytes,
      ...(withheld !== undefined ? { withheld } : {}),
    });
  }
  return found;
}
