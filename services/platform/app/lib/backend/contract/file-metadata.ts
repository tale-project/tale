/**
 * `file_metadata` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../file_metadata.ts` are what
 * actually serve them.
 */

export interface FileMetadataContract {
  'file_metadata/mutations:retryTranscription': {
    kind: 'mutation';
    args: { organizationId: string; storageId: string };
    returns: null;
  };
  'file_metadata/mutations:saveFileMetadata': {
    kind: 'mutation';
    args: {
      threadId?: string;
      source?: string;
      documentId?: string;
      skipRagIndexing?: boolean;
      organizationId: string;
      storageId: string;
      fileName: string;
      size: number;
      contentType: string;
    };
    returns: string;
  };
  'file_metadata/mutations:skipTranscription': {
    kind: 'mutation';
    args: { organizationId: string; storageId: string };
    returns: null;
  };
  'file_metadata/queries:getByStorageIds': {
    kind: 'query';
    args: { organizationId: string; storageIds: string[] };
    returns: Array<{
      storageId: string;
      documentId: undefined | string;
      fileName: string;
      contentType: string;
      size: number;
      ragStatus:
        | undefined
        | 'queued'
        | 'running'
        | 'failed'
        | 'completed'
        | 'unsupported';
      ragError: undefined | string;
      ragProgress: undefined | string;
      pageCount: undefined | number;
      scannedPagesDetected: undefined | number;
      visionRequired: undefined | boolean;
      transcript: undefined | string;
      transcriptionStatus:
        | undefined
        | 'queued'
        | 'running'
        | 'failed'
        | 'completed'
        | 'skipped';
      transcriptionError: undefined | string;
      transcriptionDurationSec: undefined | number;
      transcriptionProgress: undefined | string;
      transcriptRagStatus:
        | undefined
        | 'queued'
        | 'running'
        | 'failed'
        | 'completed';
      transcriptRagError: undefined | string;
      _creationTime: number;
    }>;
  };
}
