/** RAG ingestion status for a document */
export type RagStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  // Terminal, non-retryable: no text extractor exists for this format.
  | 'unsupported'
  | 'not_indexed'
  | 'stale';

export interface DocumentItem {
  id: string;
  name?: string;
  type: 'file' | 'folder';
  size?: number;
  /** Authoritative content type, e.g. 'text/plain', 'application/pdf'. */
  mimeType?: string;
  /** File extension without the dot, e.g. 'txt', 'pdf'. */
  extension?: string;
  folderId?: string;
  /**
   * Source provider — connector slug for connector-sourced docs
   * (`onedrive`, `sharepoint`, `google_drive`, …) or reserved values
   * `upload` (user upload) / `agent` (AI-created).
   */
  sourceProvider?: string;
  sourceMode?: 'auto' | 'manual';
  sourceCreatedAt?: number;
  sourceModifiedAt?: number;
  lastModified?: number;
  uploadedAt?: number;
  syncConfigId?: string;
  isDirectlySelected?: boolean;
  ragStatus?: RagStatus;
  /** Timestamp when the document was indexed (for completed status) */
  ragIndexedAt?: number;
  /** Error message (for failed status) */
  ragError?: string;
  /** Machine-readable failure cause (values in convex/knowledge/rag_error_codes) */
  ragErrorCode?: string;
  /** Number of scanned pages detected in the document */
  scannedPagesDetected?: number;
  /** Whether OCR was applied during RAG indexing */
  ocrApplied?: boolean;
  teamId?: string | null;
  teamIds?: string[];
  /** User ID who created/uploaded this document */
  createdBy?: string;
  /** Display name of the user who created/uploaded this document */
  createdByName?: string;
  /** Controlled-record projection — absent for documents that never opted
   *  into the controlled lifecycle (convex/documents/records.ts). */
  record?: DocumentRecordInfo;
}

/** Controlled-record state carried on a document row. */
export interface DocumentRecordInfo {
  state: 'draft' | 'in_review' | 'approved';
  version: number;
  reviewerUserId?: string;
  /** Resolved display name of the reviewer a pending review waits on. */
  reviewerName?: string;
}
