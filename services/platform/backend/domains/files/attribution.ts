import type { Sql, TransactionSql } from 'postgres';

/**
 * The project a file was added in, before any document holds it: the one
 * the composer named when it registered the upload — a project's new chat,
 * whose thread did not exist yet — else the project of the chat it was
 * added to, when the uploader owns that chat. A thread id on a file is the
 * uploader's claim, not proof of the project, so a stranger's thread names
 * none. What the file costs to transcribe or to index counts toward it.
 */
export async function fileAttachmentProjectId(
  sql: Sql | TransactionSql,
  file: {
    organizationId: string;
    uploadedBy: string | null;
    projectId: string | null;
    threadId: string | null;
  },
): Promise<string | null> {
  if (file.projectId !== null) return file.projectId;
  if (file.threadId === null || file.uploadedBy === null) return null;
  const rows = await sql<{ projectId: string | null }[]>`
    SELECT project_id AS "projectId" FROM app.thread_metadata
    WHERE thread_id = ${file.threadId} AND org_id = ${file.organizationId}
      AND user_id = ${file.uploadedBy}
    LIMIT 1
  `;
  return rows[0]?.projectId ?? null;
}
