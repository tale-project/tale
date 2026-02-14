/**
 * Integration Sandbox Types
 */

import type { ConvexJsonValue } from '../../../lib/shared/schemas/utils/json-value';

// =============================================================================
// Sentinel error thrown to halt VM execution when an async operation is pending
// =============================================================================

export class PendingOperationError extends Error {
  constructor() {
    super('Pending async operation');
    this.name = 'PendingOperationError';
  }
}

// =============================================================================
// Storage Provider (injected by Convex action, mockable in tests)
// =============================================================================

export interface StorageProvider {
  download(
    args: FileDownloadRequest & { allowedHosts?: string[] },
  ): Promise<FileReference>;
  store(args: FileStoreRequest): Promise<FileReference>;
}

// =============================================================================
// Integration Execution
// =============================================================================

export interface IntegrationExecutionParams {
  code: string;
  operation: string;
  params: Record<string, unknown>;
  variables: Record<string, unknown>;
  secrets: Record<string, string>;
  allowedHosts?: string[];
  timeoutMs?: number;
  storageProvider?: StorageProvider;
}

export interface IntegrationExecutionResult {
  success: boolean;
  result?: ConvexJsonValue;
  error?: string;
  logs?: string[];
  duration?: number;
  fileReferences?: FileReference[];
}

// =============================================================================
// HTTP
// =============================================================================

export interface HttpRequest {
  url: string;
  options: RequestInit;
  binaryBody?: string;
}

export interface HttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
  text: () => string;
  json: () => unknown;
}

export interface PendingHttpRequest {
  request: HttpRequest;
  callback: (response: HttpResponse) => void;
  errorCallback: (error: Error) => void;
}

// =============================================================================
// Files
// =============================================================================

export interface FileReference {
  fileId: string;
  url: string;
  fileName: string;
  contentType: string;
  size: number;
}

export interface FileDownloadRequest {
  url: string;
  headers?: Record<string, string>;
  fileName: string;
}

export interface FileStoreRequest {
  data: string;
  encoding: 'base64' | 'utf-8';
  contentType: string;
  fileName: string;
}

export interface PendingFileOperation {
  type: 'download' | 'store';
  request: FileDownloadRequest | FileStoreRequest;
  callback: (result: FileReference) => void;
  errorCallback: (error: Error) => void;
}
