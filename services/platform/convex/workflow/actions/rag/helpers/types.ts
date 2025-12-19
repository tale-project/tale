/**
 * RAG Action Parameters
 */
export type RagActionParams =
  | {
      operation: 'upload_document';
      recordId: string;
    }
  | {
      operation: 'upload_text';
      /** Optional for upload_text; when provided, also used as endpoint document_id. */
      recordId?: string;
      content: string;
      metadata: Record<string, unknown>;
    }
  | {
      operation: 'delete_document';
      /** Document record ID from the platform */
      recordId: string;
    };

/**
 * Document Content
 */
export interface DocumentContent {
  type: 'text' | 'file';
  content: string | ArrayBuffer;
  filename?: string;
  contentType?: string;
  metadata: Record<string, unknown>;
}

/**
 * RAG Upload Result
 */
export interface RagUploadResult {
  /** Whether the request to RAG succeeded (enqueue + basic validation). */
  success: boolean;
  /** Caller-level record identifier (usually from metadata.recordId). */
  recordId: string;
  /** Identifier returned by the RAG service for the ingested/queued document. */
  ragDocumentId?: string;
  /** Number of chunks created. For async ingestion this will typically be 0. */
  chunksCreated?: number;
  /** Time spent in the local HTTP call to the RAG service. */
  processingTimeMs?: number;
  /** Optional error message when the request fails before enqueue. */
  error?: string;
  /** Client-side timestamp when the upload finished (request-level). */
  timestamp: number;
  /** Total execution time of the Convex action step wrapping the upload. */
  executionTimeMs?: number;
  /** Type of document that was uploaded (text/file). */
  documentType?: string;
  /** Whether the RAG service queued ingestion for background processing. */
  queued?: boolean;
  /** Background job identifier if provided by the RAG service. */
  jobId?: string;
}

/**
 * RAG Delete Result
 */
export interface RagDeleteResult {
  /** Whether the deletion was successful. */
  success: boolean;
  /** Number of documents deleted. */
  deletedCount: number;
  /** List of Cognee Data IDs that were deleted. */
  deletedDataIds: Array<string>;
  /** Status message from the RAG service. */
  message: string;
  /** Time spent in the local HTTP call to the RAG service. */
  processingTimeMs?: number;
  /** Optional error message when the request fails. */
  error?: string;
  /** Client-side timestamp when the deletion finished. */
  timestamp: number;
  /** Total execution time of the Convex action step. */
  executionTimeMs?: number;
}
