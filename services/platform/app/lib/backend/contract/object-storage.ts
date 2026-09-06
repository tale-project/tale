/**
 * `object_storage` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../object_storage.ts` are what
 * actually serve them.
 */

export interface ObjectStorageContract {
  'object_storage/actions:deleteObjectStorageConnection': {
    kind: 'action';
    args: { organizationId: string };
    returns: null;
  };
  'object_storage/actions:getObjectStorageConnection': {
    kind: 'action';
    args: { organizationId: string };
    returns: {
      configured: boolean;
      region?: string;
      endpoint?: string;
      forcePathStyle?: boolean;
      bucket?: string;
      prefix?: string;
      hasCredentials?: boolean;
    };
  };
  'object_storage/actions:saveObjectStorageConnection': {
    kind: 'action';
    args: {
      prefix?: string;
      endpoint?: string;
      forcePathStyle?: boolean;
      accessKeyId?: string;
      secretAccessKey?: string;
      organizationId: string;
      region: string;
      bucket: string;
    };
    returns: null;
  };
  'object_storage/actions:startObjectStorageBlobBackfill': {
    kind: 'action';
    args: { dryRun?: boolean; organizationId: string };
    returns: { runId: string };
  };
  'object_storage/actions:testObjectStorageConnection': {
    kind: 'action';
    args: {
      prefix?: string;
      endpoint?: string;
      forcePathStyle?: boolean;
      accessKeyId?: string;
      secretAccessKey?: string;
      organizationId: string;
      region: string;
      bucket: string;
    };
    returns: { ok: boolean; error?: string };
  };
  'object_storage/backfill_queries:getObjectStorageBackfillStatus': {
    kind: 'query';
    args: { organizationId: string };
    returns: null | {
      runId: string;
      status: 'running' | 'failed' | 'completed';
      dryRun: boolean;
      phase: 'documents' | 'done' | 'fileMetadata' | 'ttsChunks' | 'videoLinks';
      continuation: number;
      rowsScanned: number;
      migrated: number;
      skipped: number;
      failed: number;
      bytesMigrated: number;
      candidates: number;
      candidateBytes: number;
      sample: Array<{
        name?: string;
        size?: number;
        ref: string;
        table: string;
      }>;
      startedAt: number;
      updatedAt: number;
      finishedAt: undefined | number;
      lastError: undefined | string;
    };
  };
}
