import type { Fragment, Sql } from 'postgres';

export function replayableChatParts(
  sql: Sql,
  organizationId: string,
  message: Fragment,
): Fragment {
  return sql`CASE WHEN jsonb_typeof(${message}.parts) = 'array' THEN (
    SELECT jsonb_agg(CASE WHEN part->>'type' = 'attachment' AND NOT coalesce((
      ${message}.attachment_ownership->(part->>'fileId') @> '{"owned":true}'::jsonb
      OR EXISTS (
        SELECT 1 FROM app.file_metadata binding
        WHERE binding.org_id = ${organizationId}
          AND binding.id = ${message}.attachment_ownership->(part->>'fileId')->>'fileId'
          AND binding.storage_ref = part->>'fileId'
          AND (binding.lifecycle_status IS NULL OR binding.lifecycle_status = 'active')
      )
      OR EXISTS (
        SELECT 1 FROM app.documents doc
        WHERE doc.org_id = ${organizationId}
          AND doc.id = ${message}.attachment_ownership->(part->>'fileId')->>'documentId'
          AND (doc.lifecycle_status IS NULL OR doc.lifecycle_status = 'active')
      )
      OR (
        NOT (coalesce(${message}.attachment_ownership, '{}'::jsonb) ? (part->>'fileId'))
        AND EXISTS (
          SELECT 1 FROM app.file_metadata file
          WHERE file.org_id = ${organizationId} AND file.storage_ref = part->>'fileId'
            AND file.document_id IS NULL
            AND (file.lifecycle_status IS NULL OR file.lifecycle_status = 'active')
        )
      )
    ), FALSE) THEN jsonb_build_object('type', 'text', 'text', '[attachment unavailable]') ELSE part END
    ORDER BY position)
    FROM jsonb_array_elements(${message}.parts) WITH ORDINALITY AS items(part, position)
  ) ELSE ${message}.parts END`;
}
