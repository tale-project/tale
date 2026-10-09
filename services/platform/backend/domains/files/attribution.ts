import type { Sql, TransactionSql } from 'postgres';

import { AUTOMATION_SUBJECT_ID } from '../../../lib/shared/constants/usage.ts';
import { findActingMember } from '../../auth/membership.ts';

/**
 * Whose spend work on a file is, and which project it counts toward — the
 * rules a recording's transcription and a file's indexing share.
 */

/**
 * Whose spend work on a file is: the first of `candidates` — its uploader,
 * then the creator of the document holding it — that acts in the
 * organization, a member or an API key's own identity; else nobody's
 * (`__automation__`). A file an automation filed names `workflow`, and a
 * file a member who has since left uploaded names someone no limit binds
 * any more: the ledger books neither as a person.
 */
export async function fileSpenderUserId(
  sql: Sql | TransactionSql,
  organizationId: string,
  candidates: readonly (string | null | undefined)[],
): Promise<string> {
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || candidate === '') {
      continue;
    }
    if ((await findActingMember(sql, organizationId, candidate)) !== null) {
      return candidate;
    }
  }
  return AUTOMATION_SUBJECT_ID;
}

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
