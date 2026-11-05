'use node';

/**
 * The text a document's read checked and kept (`domains/knowledge/
 * read-text.ts`), held in the organization's knowledge database beside the
 * index's own text (`private_knowledge.document_reads`). It is extracted
 * text, so it lives where the data-residency settings put extracted text —
 * an organization with a knowledge database of its own keeps it there — and
 * the application database records only where each read stands
 * (`app.file_metadata.text_status`).
 *
 * A row is keyed by the file's blob ref, as the corpus keys its documents. It
 * lives until the file's index is complete, or until the file is released:
 * the release purge (`core/legacy/knowledge_delete.ts`) and an
 * organization's teardown (`teardown.ts`) remove it with the corpus rows.
 */

import { PRIVATE_KNOWLEDGE_SCHEMA } from '../../../lib/knowledge/types';
import { getKnowledgePoolForOrg } from './pool';

const DOCUMENT_READS = `${PRIVATE_KNOWLEDGE_SCHEMA}.document_reads`;

/** Keep a read's checked text for a file, replacing an earlier read's. */
export async function keepReadText(
  orgSlug: string,
  fileRef: string,
  text: string,
): Promise<void> {
  const sql = await getKnowledgePoolForOrg(orgSlug);
  await sql.unsafe(
    `INSERT INTO ${DOCUMENT_READS} (org_slug, file_id, content, read_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (org_slug, file_id)
     DO UPDATE SET content = EXCLUDED.content, read_at = EXCLUDED.read_at`,
    [orgSlug, fileRef, text],
  );
}

/** The checked text a read keeps for a file, or null when it keeps none. */
export async function readKeptText(
  orgSlug: string,
  fileRef: string,
): Promise<string | null> {
  const sql = await getKnowledgePoolForOrg(orgSlug);
  const rows = await sql.unsafe<{ content: string }[]>(
    `SELECT content FROM ${DOCUMENT_READS}
      WHERE org_slug = $1 AND file_id = $2`,
    [orgSlug, fileRef],
  );
  return rows[0]?.content ?? null;
}

/** Drop the text reads keep for these files. A file with none is no fault. */
export async function dropKeptText(
  orgSlug: string,
  fileRefs: readonly string[],
): Promise<void> {
  if (fileRefs.length === 0) return;
  const sql = await getKnowledgePoolForOrg(orgSlug);
  await sql.unsafe(
    `DELETE FROM ${DOCUMENT_READS} WHERE org_slug = $1 AND file_id = ANY($2)`,
    [orgSlug, [...fileRefs]],
  );
}
