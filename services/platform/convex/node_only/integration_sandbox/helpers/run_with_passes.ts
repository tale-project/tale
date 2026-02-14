/**
 * Multi-pass execution loop for integration connectors.
 *
 * Each pass: run the function → collect pending HTTP/file operations → execute them.
 * Repeat until no new pending operations are generated (all results cached).
 * Supports dependent sequential calls (e.g. search → reply based on result).
 */

import type {
  PendingFileOperation,
  PendingHttpRequest,
  StorageProvider,
} from '../types';
import type { FilesApiState } from './create_files_api';
import type { HttpApiState } from './create_http_api';

import { PendingOperationError } from '../types';
import { createFilesApi } from './create_files_api';
import { createHttpApi } from './create_http_api';
import { executeFileOperation } from './execute_file_operation';
import { executeHttpRequest } from './execute_http_request';

const MAX_PASSES = 10;

export interface RunWithPassesParams {
  httpApiState: HttpApiState;
  httpRequests: PendingHttpRequest[];
  filesApiState: FilesApiState;
  fileRequests: PendingFileOperation[];
  allowedHosts?: string[];
  storageProvider?: StorageProvider;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30000;

export async function runWithPasses(
  fn: (ctx: unknown) => unknown,
  ctx: Record<string, unknown>,
  params: RunWithPassesParams,
): Promise<unknown> {
  const {
    httpApiState,
    httpRequests,
    filesApiState,
    fileRequests,
    allowedHosts,
    storageProvider,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = params;

  const deadline = Date.now() + timeoutMs;

  const executeLoop = async () => {
    let result: unknown;

    for (let pass = 0; pass < MAX_PASSES; pass++) {
      if (Date.now() > deadline) {
        throw new Error(`Integration execution timed out after ${timeoutMs}ms`);
      }

      httpApiState.pendingHttpCount = 0;
      httpRequests.length = 0;
      filesApiState.pendingFileCount = 0;
      fileRequests.length = 0;

      const currentCtx =
        pass === 0
          ? ctx
          : {
              ...ctx,
              http: createHttpApi(httpApiState),
              ...(storageProvider
                ? { files: createFilesApi(filesApiState) }
                : {}),
            };

      try {
        result = fn(currentCtx);
      } catch (e) {
        if (!(e instanceof PendingOperationError)) {
          throw e;
        }
      }

      if (httpRequests.length === 0 && fileRequests.length === 0) break;

      for (let i = 0; i < httpRequests.length; i++) {
        if (Date.now() > deadline) {
          throw new Error(
            `Integration execution timed out after ${timeoutMs}ms`,
          );
        }

        try {
          const response = await executeHttpRequest(
            httpRequests[i].request,
            allowedHosts,
          );
          httpRequests[i].callback(response);
        } catch (e) {
          httpRequests[i].errorCallback(
            e instanceof Error ? e : new Error(String(e)),
          );
        }
      }

      if (storageProvider) {
        for (let i = 0; i < fileRequests.length; i++) {
          if (Date.now() > deadline) {
            throw new Error(
              `Integration execution timed out after ${timeoutMs}ms`,
            );
          }

          try {
            const ref = await executeFileOperation(
              fileRequests[i],
              storageProvider,
              allowedHosts,
            );
            fileRequests[i].callback(ref);
          } catch (e) {
            fileRequests[i].errorCallback(
              e instanceof Error ? e : new Error(String(e)),
            );
          }
        }
      }
    }

    if (httpRequests.length > 0 || fileRequests.length > 0) {
      console.warn(
        `[runWithPasses] Reached MAX_PASSES (${MAX_PASSES}) with ${httpRequests.length} HTTP and ${fileRequests.length} file operations still pending`,
      );
    }

    return result;
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      executeLoop(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(`Integration execution timed out after ${timeoutMs}ms`),
            ),
          Math.max(0, deadline - Date.now()),
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
