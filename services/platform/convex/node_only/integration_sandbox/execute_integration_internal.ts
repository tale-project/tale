'use node';

/**
 * Integration Executor using Node.js VM
import { jsonRecordValidator, jsonValueValidator } from '../../lib/shared/schemas/utils/json-value';
 *
 * Executes integration connector code in a sandboxed Node.js VM environment.
 * Provides isolated execution with controlled HTTP access.
 *
 * Uses Node.js built-in `vm` module which works in Convex's Node.js runtime
 * without requiring external WASM files.
 */

import { v } from 'convex/values';
import { internalAction } from '../../_generated/server';
import * as vm from 'vm';
import type {
  IntegrationExecutionParams,
  IntegrationExecutionResult,
  HttpResponse,
  PendingHttpRequest,
} from './types';
import {
  executeHttpRequest,
  createHttpApi,
  createSandbox,
  createSecretsApi,
  base64Encode,
  base64Decode,
} from './helpers';

/**
 * Execute an integration connector in Node.js VM sandbox
 *
 * Supports two connector patterns:
 * 1. Connector object pattern: `connector.execute(ctx)` - used by Shopify and similar integrations
 * 2. Function pattern: `operationName(params)` - standalone function exports
 */
async function executeIntegration(
  params: IntegrationExecutionParams,
): Promise<IntegrationExecutionResult> {
  const startTime = Date.now();
  const logs: string[] = [];

  // Collect HTTP requests during VM execution
  const httpRequests: PendingHttpRequest[] = [];

  // Track if we need to re-run with HTTP results
  const httpResults: Map<number, HttpResponse> = new Map();

  // Shared state for HTTP API
  const httpApiState = {
    pendingHttpCount: 0,
    httpResults,
    httpRequests,
  };

  try {
    // Create secrets API
    const secretsApi = createSecretsApi(params.secrets);

    // Create sandbox context with controlled globals
    const sandbox = createSandbox(logs, secretsApi);

    // Create the VM context
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
    const connectorObj = evalResult as
      | {
          execute?: (ctx: unknown) => unknown;
          operations?: string[];
        }
      | undefined;

    if (connectorObj && typeof connectorObj.execute === 'function') {
      // Connector object pattern - execute with context
      // First pass: collect HTTP requests
      const ctx = {
        operation: params.operation,
        params: params.params,
        http: createHttpApi(httpApiState),
        secrets: secretsApi,
        base64Encode,
        base64Decode,
      };

      // Run once to collect HTTP requests
      let result: unknown;
      try {
        result = connectorObj.execute(ctx);
      } catch (e) {
        // If execution failed due to missing HTTP results, that's expected
        if (httpRequests.length === 0) {
          throw e;
        }
      }

      // If we have pending HTTP requests, execute them and re-run
      if (httpRequests.length > 0) {
        // Execute all HTTP requests
        for (let i = 0; i < httpRequests.length; i++) {
          try {
            const response = await executeHttpRequest(httpRequests[i].request);
            httpRequests[i].callback(response);
          } catch (e) {
            httpRequests[i].errorCallback(
              e instanceof Error ? e : new Error(String(e)),
            );
          }
        }

        // Re-run with HTTP results available
        httpApiState.pendingHttpCount = 0;
        httpRequests.length = 0;

        const ctx2 = {
          operation: params.operation,
          params: params.params,
          http: createHttpApi(httpApiState),
          secrets: secretsApi,
          base64Encode,
          base64Decode,
        };

        result = connectorObj.execute(ctx2);
      }

      return {
        success: true,
        result,
        logs,
        duration: Date.now() - startTime,
      };
    }

    // Function pattern - check if operation function exists in sandbox
    if (typeof sandbox[params.operation] === 'function') {
      const operationFn = sandbox[params.operation] as (
        p: Record<string, unknown>,
      ) => unknown;
      const result = operationFn(params.params);

      return {
        success: true,
        result,
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

/**
 * Execute an integration connector in a sandboxed Node.js VM environment.
 *
 * This action runs in Node.js runtime and provides:
 * - Isolated execution via Node.js VM module
 * - Controlled HTTP access through http.get/post API
 * - Secrets access through secrets.get API
 * - Console logging capture
 */
export const executeIntegrationInternal = internalAction({
  args: {
    code: v.string(),
    operation: v.string(),
    params: jsonRecordValidator,
    variables: jsonRecordValidator,
    secrets: jsonRecordValidator,
    allowedHosts: v.optional(v.array(v.string())),
    timeoutMs: v.optional(v.number()),
  },
  returns: v.object({
    success: v.boolean(),
    result: v.optional(jsonValueValidator),
    error: v.optional(v.string()),
    logs: v.optional(v.array(v.string())),
    duration: v.optional(v.number()),
  }),
  handler: async (_ctx, args): Promise<IntegrationExecutionResult> => {
    return await executeIntegration({
      code: args.code,
      operation: args.operation,
      params: args.params as Record<string, unknown>,
      variables: args.variables as Record<string, unknown>,
      secrets: args.secrets as Record<string, string>,
      allowedHosts: args.allowedHosts,
      timeoutMs: args.timeoutMs,
    });
  },
});
