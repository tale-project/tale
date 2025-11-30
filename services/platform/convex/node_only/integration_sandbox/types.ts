/**
 * Integration Sandbox Types
 */

export interface IntegrationExecutionParams {
  code: string;
  operation: string;
  params: Record<string, unknown>;
  variables: Record<string, unknown>;
  secrets: Record<string, string>;
  allowedHosts?: string[];
  timeoutMs?: number;
}

export interface IntegrationExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
  logs?: string[];
  duration?: number;
}

export interface HttpRequest {
  url: string;
  options: RequestInit;
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
