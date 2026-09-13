/**
 * Where a stored file stands in the search corpus — ONE reading of the
 * `app.file_metadata` indexing columns, shared by every surface that shows
 * or relays it: the REST `indexing` field, the agent document listing, and
 * the chat `rag_fetch` miss that names the true state instead of guessing
 * "may not be indexed yet".
 *
 * A persisted opt-out (`skip_rag_indexing`) reads as `skipped` whatever the
 * status column says — a REST-bound project file carries `NULL` there, and
 * "pending" would promise an index run that will never start. A file that
 * was never queued and never opted out is `pending`.
 *
 * Pure: no SQL, no imports — the domains that read the row map it here.
 */

export interface DocumentIndexingState {
  status:
    | 'pending'
    | 'queued'
    | 'running'
    | 'completed'
    | 'failed'
    | 'unsupported'
    | 'skipped';
  indexedAt?: number;
  error?: string;
  errorCode?: string;
}

/** The indexing columns of one `app.file_metadata` row, as a reader selects
 * them (the optional ones may be left unselected). */
export interface IndexingStateRow {
  skipRagIndexing: boolean | null;
  ragStatus: string | null;
  ragIndexedAt?: number | null;
  ragError?: string | null;
  ragErrorCode?: string | null;
}

export function indexingStateFrom(
  row: IndexingStateRow,
): DocumentIndexingState {
  const status = ((): DocumentIndexingState['status'] => {
    if (row.skipRagIndexing === true) return 'skipped';
    switch (row.ragStatus) {
      case 'queued':
      case 'running':
      case 'completed':
      case 'failed':
      case 'unsupported':
        return row.ragStatus;
      default:
        return 'pending';
    }
  })();
  return {
    status,
    ...(row.ragIndexedAt != null ? { indexedAt: row.ragIndexedAt } : {}),
    ...(row.ragError != null ? { error: row.ragError } : {}),
    ...(row.ragErrorCode != null ? { errorCode: row.ragErrorCode } : {}),
  };
}
