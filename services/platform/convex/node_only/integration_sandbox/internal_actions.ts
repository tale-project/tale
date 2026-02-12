'use node';

/**
 * Integration Executor using Node.js VM
 *
 * Executes integration connector code in a sandboxed Node.js VM environment.
 * Provides isolated execution with controlled HTTP access.
 *
 * Uses Node.js built-in `vm` module which works in Convex's Node.js runtime
 * without requiring external WASM files.
 */

import { v } from 'convex/values';
import * as vm from 'vm';

import type {
  HttpResponse,
  IntegrationExecutionParams,
  IntegrationExecutionResult,
  PendingHttpRequest,
} from './types';

import {
  jsonRecordValidator,
  jsonValueValidator,
} from '../../../lib/shared/schemas/utils/json-value';
import { internalAction } from '../../_generated/server';
import { toConvexJsonValue } from '../../lib/type_cast_helpers';
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
export async function executeIntegrationImpl(
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
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
    const connectorObj = evalResult as
      | {
          execute?: (ctx: unknown) => unknown;
          testConnection?: (ctx: unknown) => unknown;
          operations?: string[];
        }
      | undefined;

    // Helper: run a connector method with multi-pass HTTP pattern.
    // Each pass: run the function → collect pending HTTP calls → execute them.
    // Repeat until no new pending calls are generated (all results cached).
    // Supports dependent sequential calls (e.g. search → reply based on result).
    const MAX_HTTP_PASSES = 10;

    async function runWithHttpPasses(
      fn: (ctx: unknown) => unknown,
      ctx: Record<string, unknown>,
    ): Promise<unknown> {
      let result: unknown;

      for (let pass = 0; pass < MAX_HTTP_PASSES; pass++) {
        httpApiState.pendingHttpCount = 0;
        httpRequests.length = 0;

        const currentCtx =
          pass === 0 ? ctx : { ...ctx, http: createHttpApi(httpApiState) };

        try {
          result = fn(currentCtx);
        } catch (e) {
          if (httpRequests.length === 0) {
            throw e;
          }
          logs.push(
            `[pass ${pass}] Swallowed error pending HTTP: ${e instanceof Error ? e.message : String(e)}`,
          );
        }

        if (httpRequests.length === 0) break;

        for (let i = 0; i < httpRequests.length; i++) {
          try {
            const response = await executeHttpRequest(
              httpRequests[i].request,
              params.allowedHosts,
            );
            httpRequests[i].callback(response);
          } catch (e) {
            httpRequests[i].errorCallback(
              e instanceof Error ? e : new Error(String(e)),
            );
          }
        }
      }

      return result;
    }

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
      };

      const result = await runWithHttpPasses(
        connectorObj.testConnection.bind(connectorObj),
        ctx,
      );

      return {
        success: true,
        result: toConvexJsonValue(result),
        logs,
        duration: Date.now() - startTime,
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
      };

      const result = await runWithHttpPasses(
        connectorObj.execute.bind(connectorObj),
        ctx,
      );

      return {
        success: true,
        result: toConvexJsonValue(result),
        logs,
        duration: Date.now() - startTime,
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

/**
 * Execute an integration connector in a sandboxed Node.js VM environment.
 *
 * This action runs in Node.js runtime and provides:
 * - Isolated execution via Node.js VM module
 * - Controlled HTTP access through http.get/post API
 * - Secrets access through secrets.get API
 * - Console logging capture
 */
export const executeIntegration = internalAction({
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
    return await executeIntegrationImpl({
      code: args.code,
      operation: args.operation,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
      params: args.params as Record<string, unknown>,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
      variables: args.variables as Record<string, unknown>,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
      secrets: args.secrets as Record<string, string>,
      allowedHosts: args.allowedHosts,
      timeoutMs: args.timeoutMs,
    });
  },
});
