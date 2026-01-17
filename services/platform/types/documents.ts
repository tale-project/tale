/** RAG ingestion status for a document */
export type RagStatus = 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'not_indexed' | 'stale';

export interface DocumentItem {
  id: string;
  name?: string;
  type: 'file' | 'folder';
  size?: number;
  storagePath?: string;
  sourceProvider?: 'onedrive' | 'upload';
  sourceMode?: 'auto' | 'manual';
  lastModified?: number;
  syncConfigId?: string;
  isDirectlySelected?: boolean;
  ragStatus?: RagStatus;
  /** Timestamp when the document was indexed (for completed status) */
  ragIndexedAt?: number;
  /** Error message (for failed status) */
  ragError?: string;
  /** Team tags for multi-tenancy support - Better Auth team IDs */
  teamTags?: string[];
  /** User ID who created/uploaded this document */
  createdBy?: string;
  /** Display name of the user who created/uploaded this document */
  createdByName?: string;
}

interface DocumentListResponse {
  success: boolean;
  items: DocumentItem[];
  totalItems: number;
  pagination?: {
    hasNextPage: boolean;
    currentPage: number;
    pageSize: number;
  };
  error?: string;
}

interface UploadResult {
  success: boolean;
  fileInfo?: {
    name: string;
    storagePath: string;
    size: number;
    url?: string;
  };
  error?: string;
}
