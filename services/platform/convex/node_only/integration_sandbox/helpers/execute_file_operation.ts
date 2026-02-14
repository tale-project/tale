/**
 * Execute a pending file operation (download or store) via the StorageProvider.
 */

import type {
  FileDownloadRequest,
  FileReference,
  FileStoreRequest,
  PendingFileOperation,
  StorageProvider,
} from '../types';

export async function executeFileOperation(
  operation: PendingFileOperation,
  storageProvider: StorageProvider,
  allowedHosts?: string[],
): Promise<FileReference> {
  if (operation.type === 'download') {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- discriminated by type
    const request = operation.request as FileDownloadRequest;
    return await storageProvider.download({
      ...request,
      allowedHosts,
    });
  }

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- discriminated by type
  const request = operation.request as FileStoreRequest;
  return await storageProvider.store(request);
}
