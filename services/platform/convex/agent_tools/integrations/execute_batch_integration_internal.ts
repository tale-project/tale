/**
 * Internal Action: Execute Batch Integration
 *
 * Executes multiple integration operations in parallel.
 * Optimized to load integration and decrypt credentials only once,
 * then reuse for all operations in the batch.
 */

import { internalAction, type ActionCtx } from '../../_generated/server';
import { v } from 'convex/values';
import { internal } from '../../_generated/api';
import { jsonValueValidator, jsonRecordValidator } from '../../lib/shared/validators/utils/json-value';
import type { SqlExecutionResult } from '../../node_only/sql/types';
import { isIntrospectionOperation } from '../../workflow/actions/integration/helpers/is_introspection_operation';
import { getIntrospectTablesQuery } from '../../workflow/actions/integration/helpers/get_introspect_tables_query';
import { getIntrospectColumnsQuery } from '../../workflow/actions/integration/helpers/get_introspect_columns_query';
import { getIntrospectionOperations } from '../../workflow/actions/integration/helpers/get_introspection_operations';
import { decryptSqlCredentials } from '../../workflow/actions/integration/helpers/decrypt_sql_credentials';
import { requiresApproval, getOperationType } from '../../workflow/actions/integration/helpers/detect_write_operation';
import { validateRequiredParameters } from '../../workflow/actions/integration/helpers/validate_required_parameters';
import type { Integration, SqlIntegration, SqlOperation } from '../../model/integrations/types';
import { getIntegrationType } from '../../model/integrations/utils/get_integration_type';
import { isSqlIntegration } from '../../model/integrations/guards/is_sql_integration';

/** Single operation result validator */
const operationResultValidator = v.object({
  id: v.optional(v.string()),
  operation: v.string(),
  success: v.boolean(),
  data: v.optional(jsonValueValidator),
  error: v.optional(v.string()),
  duration: v.optional(v.number()),
  rowCount: v.optional(v.number()),
  requiresApproval: v.optional(v.boolean()),
  approvalId: v.optional(v.string()),
});

/** Batch result validator */
const batchResultValidator = v.object({
  success: v.boolean(),
  integration: v.string(),
  results: v.array(operationResultValidator),
  stats: v.object({
    totalTime: v.number(),
    successCount: v.number(),
    failureCount: v.number(),
    approvalCount: v.number(),
  }),
});

/** Single operation result */
interface OperationResult {
  id?: string;
  operation: string;
  success: boolean;
  data?: unknown;
  error?: string;
  duration?: number;
  rowCount?: number;
  requiresApproval?: boolean;
  approvalId?: string;
}

/** Batch result type */
interface BatchResult {
  success: boolean;
  integration: string;
  results: OperationResult[];
  stats: {
    totalTime: number;
    successCount: number;
    failureCount: number;
    approvalCount: number;
  };
}

/**
 * Execute multiple integration operations in parallel
 *
 * Optimized for SQL integrations:
 * - Loads integration config once
 * - Decrypts credentials once
 * - Executes all queries in parallel with shared credentials
 */
export const executeBatchIntegrationInternal = internalAction({
  args: {
    organizationId: v.string(),
    integrationName: v.string(),
    operations: v.array(
      v.object({
        id: v.optional(v.string()),
        operation: v.string(),
        params: v.optional(jsonRecordValidator),
      }),
    ),
    threadId: v.optional(v.string()),
    messageId: v.optional(v.string()),
  },
  returns: batchResultValidator,
  handler: async (ctx, args): Promise<BatchResult> => {
    const { organizationId, integrationName, operations, threadId, messageId } = args;
    const startTime = Date.now();

    console.log('[execute_batch_integration_internal] Starting batch:', {
      integrationName,
      operationCount: operations.length,
      operations: operations.map((op) => op.operation),
    });

    // 1. Load integration config ONCE
    const integration = await ctx.runQuery(
      internal.integrations.queries.get_by_name.getByNameInternal,
      { organizationId, name: integrationName },
    );

    if (!integration) {
      return {
        success: false,
        integration: integrationName,
        results: operations.map((op) => ({
          id: op.id,
          operation: op.operation,
          success: false,
          error: `Integration not found: "${integrationName}"`,
        })),
        stats: {
          totalTime: Date.now() - startTime,
          successCount: 0,
          failureCount: operations.length,
          approvalCount: 0,
        },
      };
    }

    const integrationType = getIntegrationType(integration);

    // For SQL integrations, optimize by decrypting credentials once
    if (integrationType === 'sql' && isSqlIntegration(integration)) {
      return executeSqlBatch(ctx, integration, operations, threadId, messageId, startTime);
    }

    // For REST API integrations, fall back to sequential execution
    // (REST APIs may have different rate limits per operation)
    return executeRestApiBatch(ctx, integration, operations, organizationId, threadId, messageId, startTime);
  },
});

/**
 * Execute batch SQL operations with shared credentials
 */
async function executeSqlBatch(
  ctx: ActionCtx,
  integration: SqlIntegration,
  operations: Array<{ id?: string; operation: string; params?: Record<string, unknown> }>,
  threadId: string | undefined,
  messageId: string | undefined,
  startTime: number,
) {
  const { sqlConnectionConfig, sqlOperations } = integration;

  // 2. Decrypt credentials ONCE
  let credentials: { username: string; password: string };
  try {
    credentials = await decryptSqlCredentials(ctx, integration);
  } catch (error) {
    return {
      success: false,
      integration: integration.name,
      results: operations.map((op) => ({
        id: op.id,
        operation: op.operation,
        success: false,
        error: `Failed to decrypt credentials: ${error instanceof Error ? error.message : String(error)}`,
      })),
      stats: {
        totalTime: Date.now() - startTime,
        successCount: 0,
        failureCount: operations.length,
        approvalCount: 0,
      },
    };
  }

  // 3. Execute all operations in parallel
  const results = await Promise.allSettled(
    operations.map(async (op) => {
      const opStartTime = Date.now();
      const params = op.params || {};

      try {
        // Handle introspection operations
        let query: string;
        let queryParams: Record<string, unknown> = params;
        let operationConfig: SqlOperation | undefined;

        if (isIntrospectionOperation(op.operation)) {
          if (op.operation === 'introspect_tables') {
            query = getIntrospectTablesQuery(sqlConnectionConfig.engine);
            queryParams = {};
          } else if (op.operation === 'introspect_columns') {
            if (!params.schemaName || !params.tableName) {
              throw new Error('introspect_columns requires schemaName and tableName parameters');
            }
            const introspectionQuery = getIntrospectColumnsQuery(
              sqlConnectionConfig.engine,
              params.schemaName as string,
              params.tableName as string,
            );
            query = introspectionQuery.query;
            queryParams = introspectionQuery.params;
          } else {
            throw new Error(`Unknown introspection operation: ${op.operation}`);
          }
        } else {
          // User-defined operation
          operationConfig = sqlOperations.find((sqlOp) => sqlOp.name === op.operation);

          if (!operationConfig) {
            const availableOps = [
              ...getIntrospectionOperations(),
              ...sqlOperations.map((sqlOp) => sqlOp.name),
            ].join(', ');
            throw new Error(`Operation "${op.operation}" not found. Available: ${availableOps}`);
          }

          query = operationConfig.query;
          validateRequiredParameters(operationConfig, params, op.operation);

          // Check if requires approval
          if (requiresApproval(operationConfig)) {
            const operationType = getOperationType(operationConfig);

            const approvalId = await ctx.runMutation(
              internal.agent_tools.integrations.create_integration_approval.createIntegrationApproval,
              {
                organizationId: integration.organizationId,
                integrationId: integration._id,
                integrationName: integration.name,
                integrationType: 'sql',
                operationName: op.operation,
                operationTitle: operationConfig.title || op.operation,
                operationType,
                parameters: params,
                threadId,
                messageId,
                estimatedImpact: `This ${operationType} operation will modify data in ${sqlConnectionConfig.database}`,
              },
            );

            return {
              id: op.id,
              operation: op.operation,
              success: true,
              requiresApproval: true,
              approvalId,
              duration: Date.now() - opStartTime,
            };
          }
        }

        // Execute SQL query
        const isWriteOperation = operationConfig ? getOperationType(operationConfig) === 'write' : false;

        // Cast result from runAction - type validated by action's returns validator
        const result = (await ctx.runAction(
          internal.node_only.sql.execute_query_internal.executeQueryInternal,
          {
            engine: sqlConnectionConfig.engine,
            credentials: {
              server: sqlConnectionConfig.server,
              port: sqlConnectionConfig.port,
              database: sqlConnectionConfig.database,
              user: credentials.username,
              password: credentials.password,
              options: sqlConnectionConfig.options,
            },
            query,
            params: queryParams,
            security: {
              maxResultRows: sqlConnectionConfig.security?.maxResultRows,
              queryTimeoutMs: sqlConnectionConfig.security?.queryTimeoutMs,
            },
            allowWrite: isWriteOperation,
          },
        )) as SqlExecutionResult;

        if (!result.success) {
          throw new Error(`SQL query failed: ${result.error}`);
        }

        return {
          id: op.id,
          operation: op.operation,
          success: true,
          data: {
            name: integration.name,
            operation: op.operation,
            engine: sqlConnectionConfig.engine,
            data: result.data,
            rowCount: result.rowCount,
            duration: result.duration,
          },
          duration: Date.now() - opStartTime,
          rowCount: result.rowCount,
        };
      } catch (error) {
        return {
          id: op.id,
          operation: op.operation,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          duration: Date.now() - opStartTime,
        };
      }
    }),
  );

  // Process results
  const processedResults: OperationResult[] = results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    return {
      id: operations[index].id,
      operation: operations[index].operation,
      success: false,
      error: result.reason?.message || 'Unknown error',
    };
  });

  const totalTime = Date.now() - startTime;
  const successCount = processedResults.filter((r) => r.success && !r.requiresApproval).length;
  const failureCount = processedResults.filter((r) => !r.success).length;
  const approvalCount = processedResults.filter((r) => r.requiresApproval).length;

  console.log('[execute_batch_integration_internal] SQL batch complete:', {
    totalTime,
    successCount,
    failureCount,
    approvalCount,
  });

  return {
    success: failureCount === 0,
    integration: integration.name,
    results: processedResults,
    stats: {
      totalTime,
      successCount,
      failureCount,
      approvalCount,
    },
  };
}

/**
 * Execute batch REST API operations
 * Falls back to the standard integrationAction for each operation
 */
async function executeRestApiBatch(
  ctx: ActionCtx,
  integration: Integration,
  operations: Array<{ id?: string; operation: string; params?: Record<string, unknown> }>,
  organizationId: string,
  threadId: string | undefined,
  messageId: string | undefined,
  startTime: number,
) {
  // Import dynamically to avoid circular dependencies
  const { integrationAction } = await import('../../workflow/actions/integration/integration_action');

  const results = await Promise.allSettled(
    operations.map(async (op) => {
      const opStartTime = Date.now();

      try {
        const result = await integrationAction.execute(
          ctx,
          {
            name: integration.name,
            operation: op.operation,
            params: op.params || {},
            skipApprovalCheck: false,
            threadId,
            messageId,
          },
          { organizationId },
        );

        const duration = Date.now() - opStartTime;

        // Use type narrowing with 'in' operator for safe property access
        if (result && typeof result === 'object' && 'requiresApproval' in result && result.requiresApproval) {
          const approvalId = 'approvalId' in result ? String(result.approvalId) : undefined;
          return {
            id: op.id,
            operation: op.operation,
            success: true,
            requiresApproval: true,
            approvalId,
            duration,
          };
        }

        // Extract rowCount safely using type narrowing
        const rowCount = result && typeof result === 'object' && 'rowCount' in result
          ? (result.rowCount as number | undefined)
          : undefined;

        return {
          id: op.id,
          operation: op.operation,
          success: true,
          data: result,
          duration,
          rowCount,
        };
      } catch (error) {
        return {
          id: op.id,
          operation: op.operation,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          duration: Date.now() - opStartTime,
        } as OperationResult;
      }
    }),
  );

  const processedResults: OperationResult[] = results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    return {
      id: operations[index].id,
      operation: operations[index].operation,
      success: false,
      error: result.reason?.message || 'Unknown error',
    };
  });

  const totalTime = Date.now() - startTime;
  const successCount = processedResults.filter((r) => r.success && !r.requiresApproval).length;
  const failureCount = processedResults.filter((r) => !r.success).length;
  const approvalCount = processedResults.filter((r) => r.requiresApproval).length;

  console.log('[execute_batch_integration_internal] REST API batch complete:', {
    totalTime,
    successCount,
    failureCount,
    approvalCount,
  });

  return {
    success: failureCount === 0,
    integration: integration.name,
    results: processedResults,
    stats: {
      totalTime,
      successCount,
      failureCount,
      approvalCount,
    },
  };
}
