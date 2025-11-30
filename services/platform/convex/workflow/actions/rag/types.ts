/**
 * RAG Action Parameters
 */
export type RagActionParams =
  | {
      operation: 'upload_document';
      documentId: string;
      organizationId: string;
      forceReupload?: boolean;
      includeMetadata?: boolean;
      timeout?: number;
    }
  | {
      operation: 'upload_text';
      content: string;
      metadata: Record<string, unknown>;
      timeout?: number;
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
  /** Caller-level document identifier (usually from metadata.documentId). */
  documentId: string;
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
