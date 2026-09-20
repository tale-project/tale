import type { Sql } from 'postgres';

/**
 * Ref liveness — the two questions every lane that takes content out of
 * circulation, and the one lane that puts it in, must answer the same way.
 *
 * The knowledge corpus is keyed by BLOB REF (`file_id` =
 * `app.file_metadata.storage_ref` / `app.documents.file_ref`):
 *
 *   1. corpus-liveness — may the corpus hold rows for this ref? Yes while ANY
 *      document row's CURRENT `file_ref` is the ref (any lifecycle: a trashed
 *      document is restorable and the retrievability filter hides it
 *      meanwhile), or a live UNBOUND file row holds it (thread files,
 *      video-link transcripts). A ref that is only history (`history_files`,
 *      a superseded replacement row) is corpus-dead: old versions must not
 *      answer RAG queries.
 *   2. blob-liveness — may the BYTES be deleted? Only when no document
 *      (`file_ref` or `history_files` — retained controlled-record snapshots
 *      need their bytes) and no live file row references the ref. WebDAV
 *      COPY shares one blob ref across several document rows, so a purge of
 *      one copy must never destroy the twin's bytes.
 *
 * `release.ts` acts on both verdicts. The indexer asks the first one
 * (`isCorpusRefLive`) before it pays for a download or an embedding, and
 * again once it has claimed its corpus row: a file whose ref was rotated or
 * deleted while its job waited is not indexed, and one released while the
 * job ran ends quietly instead of re-creating a row nothing references.
 *
 * Its own module because the release seam imports the knowledge service for
 * the scope reconcile, and the service needs the predicate too.
 */

export interface RefLiveness {
  ref: string;
  corpusLive: boolean;
  blobLive: boolean;
}

export interface AssessArgs {
  organizationId: string;
  refs: string[];
  /** A document being purged in the same operation — its own rows must not
   * keep its refs alive. */
  excludeDocumentId?: string;
  /** A file row being swept in the same operation (temp-file sweep). */
  excludeFileMetadataId?: string;
}

/** Both liveness verdicts for a set of refs, in one round trip. */
export async function assessRefLiveness(
  sql: Sql,
  args: AssessArgs,
): Promise<RefLiveness[]> {
  if (args.refs.length === 0) return [];
  const excludeDoc = args.excludeDocumentId ?? null;
  const excludeFile = args.excludeFileMetadataId ?? null;
  return sql<RefLiveness[]>`
    SELECT r.ref AS ref,
      (
        EXISTS(
          SELECT 1 FROM app.documents d
          WHERE d.org_id = ${args.organizationId} AND d.file_ref = r.ref
            AND (${excludeDoc}::text IS NULL OR d.id <> ${excludeDoc})
        )
        OR EXISTS(
          SELECT 1 FROM app.file_metadata fm
          WHERE fm.org_id = ${args.organizationId}
            AND fm.storage_ref = r.ref
            AND fm.document_id IS NULL
            AND (fm.lifecycle_status IS NULL
                 OR fm.lifecycle_status = 'active')
            AND (${excludeFile}::text IS NULL OR fm.id <> ${excludeFile})
        )
      ) AS "corpusLive",
      (
        EXISTS(
          SELECT 1 FROM app.documents d
          WHERE d.org_id = ${args.organizationId}
            AND (${excludeDoc}::text IS NULL OR d.id <> ${excludeDoc})
            AND (d.file_ref = r.ref
                 OR d.history_files @> ARRAY[r.ref])
        )
        OR EXISTS(
          SELECT 1 FROM app.file_metadata fm
          WHERE fm.org_id = ${args.organizationId}
            AND fm.storage_ref = r.ref
            AND (fm.lifecycle_status IS NULL
                 OR fm.lifecycle_status = 'active')
            AND (${excludeFile}::text IS NULL OR fm.id <> ${excludeFile})
            AND (${excludeDoc}::text IS NULL OR fm.document_id IS NULL
                 OR fm.document_id <> ${excludeDoc})
        )
      ) AS "blobLive"
    FROM unnest(${args.refs}::text[]) AS r(ref)
  `;
}

/**
 * May the corpus hold rows for this ref right now? The one-ref reading of
 * the corpus predicate above — what the indexer asks. Answering "no" to a
 * ref the query did not report (a double that knows nothing of it) errs on
 * the side that is recoverable: a skipped index has the retry door and the
 * daily reconcile behind it; a resurrected dead ref answers queries with
 * content nothing references.
 */
export async function isCorpusRefLive(
  sql: Sql,
  args: { organizationId: string; ref: string },
): Promise<boolean> {
  const [verdict] = await assessRefLiveness(sql, {
    organizationId: args.organizationId,
    refs: [args.ref],
  });
  return verdict?.corpusLive ?? false;
}
