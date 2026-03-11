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
  sourceProvider?: 'onedrive' | 'upload' | 'sharepoint';
  sourceMode?: 'auto' | 'manual';
  lastModified?: number;
  syncConfigId?: string;
  isDirectlySelected?: boolean;
  ragStatus?: RagStatus;
  /** Timestamp when the document was indexed (for completed status) */
  ragIndexedAt?: number;
  /** Error message (for failed status) */
  ragError?: string;
  teamId?: string | null;
  teamIds?: string[];
  /** User ID who created/uploaded this document */
  createdBy?: string;
  /** Display name of the user who created/uploaded this document */
  createdByName?: string;
}
