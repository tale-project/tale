'use node';

/**
 * Execute SQL query - Convex action entry point
 *
 * This is the Convex action wrapper that delegates to the executeQuery helper.
 */
import { jsonRecordValidator, jsonValueValidator } from '../../lib/shared/schemas/utils/json-value';

import { v } from 'convex/values';
import { internalAction } from '../../_generated/server';
import type { SqlExecutionResult } from './types';
import { executeQuery } from './helpers/execute_query';

/**
 * Convex action wrapper for SQL query execution
 */
export const executeQueryInternal = internalAction({
  args: {
    engine: v.union(
      v.literal('mssql'),
      v.literal('postgres'),
      v.literal('mysql'),
    ),
    credentials: v.object({
      server: v.string(),
      port: v.optional(v.number()),
      database: v.string(),
      user: v.string(),
      password: v.string(),
      options: v.optional(
        v.object({
          encrypt: v.optional(v.boolean()),
          trustServerCertificate: v.optional(v.boolean()),
          connectionTimeout: v.optional(v.number()),
          requestTimeout: v.optional(v.number()),
        }),
      ),
    }),
    query: v.string(),
    params: v.optional(jsonRecordValidator),
    security: v.optional(
      v.object({
        maxResultRows: v.optional(v.number()),
        queryTimeoutMs: v.optional(v.number()),
      }),
    ),
    // Allow write operations (UPDATE, INSERT, DELETE) when explicitly enabled
    allowWrite: v.optional(v.boolean()),
  },
  returns: v.object({
    success: v.boolean(),
    data: v.optional(jsonValueValidator),
    rowCount: v.optional(v.number()),
    error: v.optional(v.string()),
    duration: v.optional(v.number()),
  }),
  handler: async (_ctx, args): Promise<SqlExecutionResult> => {
    return await executeQuery({
      engine: args.engine,
      credentials: args.credentials,
      query: args.query,
      params: args.params as Record<string, unknown> | undefined,
      security: args.security,
      allowWrite: args.allowWrite,
    });
  },
});
