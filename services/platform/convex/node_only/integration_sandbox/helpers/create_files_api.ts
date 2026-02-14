/**
 * Create synchronous files API for integration connectors.
 *
 * Uses the same multi-pass pattern as the HTTP API:
 * - First pass: connector calls download/store → queues pending operation → returns placeholder
 * - Between passes: executor performs the actual file operation (fetch+store / base64+store)
 * - Next pass: connector calls download/store again → finds cached result → returns real reference
 */

import type {
  FileDownloadRequest,
  FileReference,
  FileStoreRequest,
  PendingFileOperation,
} from '../types';

import { PendingOperationError } from '../types';

export interface FilesApiState {
  pendingFileCount: number;
  fileResults: Map<number, FileReference>;
  fileRequests: PendingFileOperation[];
}

export interface FilesApi {
  download: (
    url: string,
    options: { headers?: Record<string, string>; fileName: string },
  ) => FileReference;
  store: (
    data: string,
    options: {
      encoding: 'base64' | 'utf-8';
      contentType: string;
      fileName: string;
    },
  ) => FileReference;
}

export function createFilesApi(state: FilesApiState): FilesApi {
  return {
    download: (
      url: string,
      options: { headers?: Record<string, string>; fileName: string },
    ): FileReference => {
      const requestId = state.pendingFileCount++;

      const cachedResult = state.fileResults.get(requestId);
      if (cachedResult) {
        return cachedResult;
      }

      const request: FileDownloadRequest = {
        url,
        headers: options.headers,
        fileName: options.fileName,
      };

      state.fileRequests.push({
        type: 'download',
        request,
        callback: (result) => state.fileResults.set(requestId, result),
        errorCallback: (error) => {
          throw error;
        },
      });

      throw new PendingOperationError();
    },

    store: (
      data: string,
      options: {
        encoding: 'base64' | 'utf-8';
        contentType: string;
        fileName: string;
      },
    ): FileReference => {
      const requestId = state.pendingFileCount++;

      const cachedResult = state.fileResults.get(requestId);
      if (cachedResult) {
        return cachedResult;
      }

      const request: FileStoreRequest = {
        data,
        encoding: options.encoding,
        contentType: options.contentType,
        fileName: options.fileName,
      };

      state.fileRequests.push({
        type: 'store',
        request,
        callback: (result) => state.fileResults.set(requestId, result),
        errorCallback: (error) => {
          throw error;
        },
      });

      throw new PendingOperationError();
    },
  };
}
