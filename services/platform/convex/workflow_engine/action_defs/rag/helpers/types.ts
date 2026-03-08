/**
 * RAG Action Parameters
 */
export type RagActionParams =
  | {
      operation: 'upload_document';
      recordId: string;
      sync?: boolean;
    }
  | {
      operation: 'delete_document';
      recordId: string;
    }
  | {
      operation: 'search';
      query: string;
      documentIds: string[];
      topK?: number;
      similarityThreshold?: number;
    };

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
}

/**
 * RAG Delete Result
 */
export interface RagDeleteResult {
  /** Whether the deletion was successful. */
  success: boolean;
  /** Number of documents deleted. */
  deletedCount: number;
  /** List of data IDs that were deleted from the RAG knowledge base. */
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
