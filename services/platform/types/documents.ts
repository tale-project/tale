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

/**
 * One cloud-sync config's health as the listings ship it (the backend's
 * `SyncHealthView`). `failed` is a config whose last run did not reach the
 * source; `needsReauth` narrows that to a dead grant — only the owner
 * reconnecting (or a re-import under another account) resumes it.
 */
export interface DocumentSyncHealth {
  configId: string;
  provider: 'onedrive' | 'google_drive';
  status: 'healthy' | 'failed';
  needsReauth: boolean;
  /** Last run, successful or not. */
  lastSyncAt?: number;
  /** First failed run of the open failure episode. */
  errorSince?: number;
  errorMessage?: string;
  ownerUserId: string;
  ownerName?: string;
}

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
  /** Health of the cloud sync this row runs under: a synced folder, or a
   *  file picked directly for sync (a folder member shows it on the folder
   *  row). Absent for anything that is not synced. */
  syncHealth?: DocumentSyncHealth;
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
  /** Project scope, mutually exclusive with the team stamps. Classify scope
   *  through `documentScopeKind`, never by testing these fields directly. */
  projectId?: string | null;
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
  /** Current blob identity used as the draft replacement CAS token. */
  currentFileId?: string;
  reviewerUserId?: string;
  /** Resolved display name of the reviewer a pending review waits on. */
  reviewerName?: string;
  /** An approved version exists in history — the record is retained and the
   * server refuses deletion in every state, drafts included. */
  hasApprovedVersions?: boolean;
}
