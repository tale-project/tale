/** RAG ingestion status for a document */
export type RagStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'not_indexed'
  | 'stale';

export interface DocumentItem {
  id: string;
  name?: string;
  type: 'file' | 'folder';
  size?: number;
  folderId?: string;
  /**
   * Source provider — integration slug for integration-sourced docs
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
}
