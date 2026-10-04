import type { Fragment, Sql, TransactionSql } from 'postgres';

import { toJson } from '../../db/sql.ts';

export function chatUploadOwned(
  sql: Sql | TransactionSql,
  file: Fragment,
  thread: Fragment,
): Fragment {
  return sql`(${file}.document_id IS NULL AND (
    ${file}.uploaded_by = ${thread}.user_id
    OR ${file}.thread_id = ${thread}.thread_id
    OR ${file}.thread_id = ${thread}.branch_root_id
  ))`;
}

export async function preserveChatAttachmentOwnership(
  tx: Sql | TransactionSql,
  organizationId: string,
  ref: string,
): Promise<void> {
  await tx`
    UPDATE app.messages message SET attachment_ownership =
      coalesce(message.attachment_ownership, '{}'::jsonb) || jsonb_build_object(${ref}::text,
        CASE WHEN ${chatUploadOwned(tx, tx`file`, tx`thread`)}
          THEN jsonb_build_object('owned', true)
          WHEN file.document_id IS NULL THEN jsonb_build_object('fileId', file.id)
          ELSE jsonb_build_object('documentId', file.document_id) END)
    FROM app.thread_metadata thread CROSS JOIN LATERAL (
      SELECT candidate.* FROM app.file_metadata candidate
      WHERE candidate.org_id = thread.org_id AND candidate.storage_ref = ${ref}
      ORDER BY ${chatUploadOwned(tx, tx`candidate`, tx`thread`)} DESC NULLS LAST, candidate.id
      LIMIT 1
    ) file
    WHERE message.org_id = ${organizationId} AND file.org_id = message.org_id
      AND thread.org_id = message.org_id AND thread.thread_id = message.thread_id
      AND file.storage_ref = ${ref} AND message.role = 'user'
      AND NOT (coalesce(message.attachment_ownership, '{}'::jsonb) ? ${ref})
      AND message.parts @> jsonb_build_array(jsonb_build_object('type', 'attachment', 'fileId', ${ref}::text))
  `;
}

export function attachmentOwnershipForParts(
  sql: Sql | TransactionSql,
  organizationId: string,
  threadId: string,
  parts: unknown,
  source: Fragment = sql`app.file_metadata`,
  provenance: Readonly<Record<string, { documentId?: string }>> = {},
): Fragment {
  const serialized = sql.json(toJson(parts));
  const trusted = sql.json(toJson(provenance));
  return sql`(SELECT coalesce(jsonb_object_agg(binding.storage_ref, binding.proof), '{}'::jsonb)
    FROM (
      SELECT DISTINCT ON (file.storage_ref) file.storage_ref,
        CASE WHEN (${trusted}::jsonb ? file.storage_ref)
          THEN ${trusted}::jsonb -> file.storage_ref
          WHEN ${chatUploadOwned(sql, sql`file`, sql`thread`)}
          THEN jsonb_build_object('owned', true)
          WHEN file.document_id IS NULL THEN jsonb_build_object('fileId', file.id)
          ELSE jsonb_build_object('documentId', file.document_id) END AS proof
      FROM ${source} file JOIN app.thread_metadata thread
        ON thread.org_id = file.org_id AND thread.thread_id = ${threadId}
      WHERE file.org_id = ${organizationId}
        AND ${serialized}::jsonb @> jsonb_build_array(jsonb_build_object('type', 'attachment', 'fileId', file.storage_ref))
      ORDER BY file.storage_ref, ${chatUploadOwned(sql, sql`file`, sql`thread`)} DESC NULLS LAST, file.id
    ) binding)`;
}
