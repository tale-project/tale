/**
 * `files` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../files.ts` are what
 * actually serve them.
 */

export interface FilesContract {
  'files/blob_actions:generateBlobUpload': {
    kind: 'action';
    args: { contentType?: string; organizationId: string };
    returns: { url: string; method: 'POST' | 'PUT'; s3Ref?: string };
  };
  'files/mutations:deleteRejectedUploadBlob': {
    kind: 'mutation';
    args: { organizationId?: string; storageId: string };
    returns: { deleted: boolean };
  };
  'files/mutations:generateUploadUrl': {
    kind: 'mutation';
    args: Record<string, never>;
    returns: string;
  };
  'files/queries:getFileUrl': {
    kind: 'query';
    args: { fileName?: string; fileId: string };
    returns: null | string;
  };
  'files/queries:getFileUrls': {
    kind: 'query';
    args: { fileIds: string[] };
    returns: Array<{ fileId: string; url: null | string }>;
  };
}
