'use node';

/**
 * Convex internal actions for integration execution.
 *
 * Thin wrappers that delegate to the core logic in execute_integration_impl.ts.
 */

import { v } from 'convex/values';

import type { IntegrationExecutionResult } from './types';

import {
  jsonRecordValidator,
  jsonValueValidator,
} from '../../../lib/shared/schemas/utils/json-value';
import { internalAction } from '../../_generated/server';
import { executeIntegrationImpl } from './execute_integration_impl';
import { createConvexStorageProvider } from './helpers';

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
    fileReferences: v.optional(
      v.array(
        v.object({
          fileId: v.string(),
          url: v.string(),
          fileName: v.string(),
          contentType: v.string(),
          size: v.number(),
        }),
      ),
    ),
  }),
  handler: async (ctx, args): Promise<IntegrationExecutionResult> => {
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
      storageProvider: createConvexStorageProvider(ctx),
    });
  },
});
