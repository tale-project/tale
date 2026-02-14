'use node'

/**
 * Core integration execution logic.
 *
 * Executes integration connector code in a sandboxed Node.js VM environment.
 * Provides isolated execution with controlled HTTP access.
 */

import * as vm from 'vm';

import type {
  FileReference,
  HttpResponse,
  IntegrationExecutionParams,
  IntegrationExecutionResult,
  PendingFileOperation,
  PendingHttpRequest,
} from './types';

import { toConvexJsonValue } from '../../lib/type_cast_helpers';
import {
  base64Decode,
  base64Encode,
  createFilesApi,
  createHttpApi,
  createSandbox,
  createSecretsApi,
  runWithPasses,
} from './helpers';

/**
 * Execute an integration connector in Node.js VM sandbox
 *
 * Supports two connector patterns:
 * 1. Connector object pattern: `connector.execute(ctx)` - used by Shopify and similar integrations
 * 2. Function pattern: `operationName(params)` - standalone function exports
 */
export async function executeIntegrationImpl(
  params: IntegrationExecutionParams,
): Promise<IntegrationExecutionResult> {
  const startTime = Date.now();
  const logs: string[] = [];

  // Shared state for HTTP API (multi-pass)
  const httpRequests: PendingHttpRequest[] = [];
  const httpResults: Map<number, HttpResponse> = new Map();
  const httpApiState = { pendingHttpCount: 0, httpResults, httpRequests };

  // Shared state for files API (multi-pass)
  const fileRequests: PendingFileOperation[] = [];
  const fileResults: Map<number, FileReference> = new Map();
  const filesApiState = { pendingFileCount: 0, fileResults, fileRequests };

  const passesParams = {
    httpApiState,
    httpRequests,
    filesApiState,
    fileRequests,
    allowedHosts: params.allowedHosts,
    storageProvider: params.storageProvider,
  };

  try {
    const secretsApi = createSecretsApi(params.secrets);
    const sandbox = createSandbox(logs, secretsApi);

    vm.createContext(sandbox);

    // Execute the connector code and capture the result
    // We wrap the code to ensure 'connector' is accessible even if declared with const/let
    const wrappedCode = `
      ${params.code}

      // Export connector object if it exists (handles const/let declarations)
      (typeof connector !== 'undefined' ? connector : undefined)
    `;

    const evalResult = vm.runInContext(wrappedCode, sandbox, {
      timeout: params.timeoutMs ?? 30000,
      filename: 'connector.js',
    });

    // Check for connector object pattern (e.g., Shopify integration)
    // The evalResult will be the connector object if one was defined
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
    const connectorObj = evalResult as
      | {
          execute?: (ctx: unknown) => unknown;
          testConnection?: (ctx: unknown) => unknown;
          operations?: string[];
        }
      | undefined;

    // Handle __test_connection__ sentinel operation
    if (params.operation === '__test_connection__' && connectorObj) {
      if (typeof connectorObj.testConnection !== 'function') {
        return {
          success: false,
          error:
            'Connector does not define a testConnection method. ' +
            'Add testConnection(ctx) to the connector object.',
          logs,
          duration: Date.now() - startTime,
        };
      }

      const ctx = {
        http: createHttpApi(httpApiState),
        secrets: secretsApi,
        base64Encode,
        base64Decode,
        ...(params.storageProvider
          ? { files: createFilesApi(filesApiState) }
          : {}),
      };

      const result = await runWithPasses(
        connectorObj.testConnection.bind(connectorObj),
        ctx,
        passesParams,
      );

      const fileRefs = [...filesApiState.fileResults.values()];
      return {
        success: true,
        result: toConvexJsonValue(result),
        logs,
        duration: Date.now() - startTime,
        ...(fileRefs.length > 0 ? { fileReferences: fileRefs } : {}),
      };
    }

    if (connectorObj && typeof connectorObj.execute === 'function') {
      const ctx = {
        operation: params.operation,
        params: params.params,
        http: createHttpApi(httpApiState),
        secrets: secretsApi,
        base64Encode,
        base64Decode,
        ...(params.storageProvider
          ? { files: createFilesApi(filesApiState) }
          : {}),
      };

      const result = await runWithPasses(
        connectorObj.execute.bind(connectorObj),
        ctx,
        passesParams,
      );

      const fileRefs = [...filesApiState.fileResults.values()];
      return {
        success: true,
        result: toConvexJsonValue(result),
        logs,
        duration: Date.now() - startTime,
        ...(fileRefs.length > 0 ? { fileReferences: fileRefs } : {}),
      };
    }

    // Function pattern - check if operation function exists in sandbox
    if (typeof sandbox[params.operation] === 'function') {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
      const operationFn = sandbox[params.operation] as (
        p: Record<string, unknown>,
      ) => unknown;
      const result = operationFn(params.params);

      return {
        success: true,
        result: toConvexJsonValue(result),
        logs,
        duration: Date.now() - startTime,
      };
    }

    return {
      success: false,
      error: `Operation "${params.operation}" is not defined. Connector must either export a 'connector' object with an 'execute' method, or export a function named '${params.operation}'.`,
      logs,
      duration: Date.now() - startTime,
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
      logs,
      duration: Date.now() - startTime,
    };
  }
}
