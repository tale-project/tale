import { v, Infer } from 'convex/values';
import { internalAction, type ActionCtx } from '../../_generated/server';
import { internal } from '../../_generated/api';
import { jsonValueValidator, jsonRecordValidator, type JsonRecord } from '../../../lib/shared/schemas/utils/json-value';
import { integrationAction } from '../../workflow_engine/action_defs/integration/integration_action';
import type { SqlExecutionResult } from '../../node_only/sql/types';
import { isIntrospectionOperation } from '../../workflow_engine/action_defs/integration/helpers/is_introspection_operation';
import { getIntrospectTablesQuery } from '../../workflow_engine/action_defs/integration/helpers/get_introspect_tables_query';
import { getIntrospectColumnsQuery } from '../../workflow_engine/action_defs/integration/helpers/get_introspect_columns_query';
import { getIntrospectionOperations } from '../../workflow_engine/action_defs/integration/helpers/get_introspection_operations';
import { decryptSqlCredentials } from '../../workflow_engine/action_defs/integration/helpers/decrypt_sql_credentials';
import { requiresApproval, getOperationType } from '../../workflow_engine/action_defs/integration/helpers/detect_write_operation';
import { validateRequiredParameters } from '../../workflow_engine/action_defs/integration/helpers/validate_required_parameters';
import type { Integration, SqlIntegration, SqlOperation } from '../../integrations/types';
import { getIntegrationType, isSqlIntegration } from '../../integrations/helpers';

type ConvexJsonValue = Infer<typeof jsonValueValidator>;
type ConvexJsonRecord = Infer<typeof jsonRecordValidator>;

// =============================================================================
// EXECUTE INTEGRATION
// =============================================================================

export const executeIntegration = internalAction({
  args: {
    organizationId: v.string(),
    integrationName: v.string(),
    operation: v.string(),
    params: v.optional(jsonRecordValidator),
    skipApprovalCheck: v.optional(v.boolean()),
    threadId: v.optional(v.string()),
    messageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { organizationId, integrationName, operation, params, skipApprovalCheck, threadId, messageId } = args;

    console.log('[executeIntegration] Received context:', {
      hasThreadId: threadId !== undefined,
      hasMessageId: messageId !== undefined,
      threadId: threadId,
      messageId: messageId,
      operation,
      integrationName,
    });

    const result = await integrationAction.execute(
      ctx,
      {
        name: integrationName,
        operation,
        params: params || {},
        skipApprovalCheck: skipApprovalCheck || false,
        threadId,
        messageId,
      },
      {
        organizationId,
      },
    );

    return result;
  },
});

// =============================================================================
// EXECUTE APPROVED OPERATION
// =============================================================================

interface IntegrationOperationMetadataLocal {
  integrationId: string;
  integrationName: string;
  integrationType: string;
  operationName: string;
  operationDescription?: string;
  operationCategory?: string;
  parameters?: Record<string, ConvexJsonValue>;
  requiresApproval: boolean;
  requestedAt?: number;
  executedAt?: number;
  executionResult?: ConvexJsonValue;
  executionError?: string | null;
}

export const executeApprovedOperation = internalAction({
  args: {
    approvalId: v.id('approvals'),
    approvedBy: v.string(),
  },
  returns: jsonValueValidator,
  handler: async (ctx, args): Promise<ConvexJsonValue> => {
    const approval: {
      _id: unknown;
      status: string;
      resourceType: string;
      organizationId: string;
      metadata?: Record<string, ConvexJsonValue>;
    } | null = await ctx.runQuery(internal.approvals.internal_queries.getApprovalById, {
      approvalId: args.approvalId,
    });

    if (!approval) {
      throw new Error('Approval not found');
    }

    if (approval.status !== 'approved') {
      throw new Error(
        `Cannot execute operation: approval status is "${approval.status}", expected "approved"`,
      );
    }

    if (approval.resourceType !== 'integration_operation') {
      throw new Error(
        `Invalid approval type: expected "integration_operation", got "${approval.resourceType}"`,
      );
    }

    const metadata = approval.metadata as unknown as IntegrationOperationMetadataLocal | undefined;

    if (!metadata?.integrationName || !metadata?.operationName) {
      throw new Error(
        'Invalid approval metadata: missing integration or operation name',
      );
    }

    try {
      const result = await ctx.runAction(
        internal.agent_tools.integrations.internal_actions
          .executeIntegration,
        {
          organizationId: approval.organizationId,
          integrationName: metadata.integrationName,
          operation: metadata.operationName,
          params: metadata.parameters as ConvexJsonRecord | undefined,
          skipApprovalCheck: true,
        },
      );

      await ctx.runMutation(
        internal.agent_tools.integrations.internal_mutations
          .updateApprovalWithResult,
        {
          approvalId: args.approvalId,
          executionResult: result as ConvexJsonValue,
          executionError: null,
        },
      );

      return result as ConvexJsonValue;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      await ctx.runMutation(
        internal.agent_tools.integrations.internal_mutations
          .updateApprovalWithResult,
        {
          approvalId: args.approvalId,
          executionResult: null,
          executionError: errorMessage,
        },
      );

      throw error;
    }
  },
});

// =============================================================================
// EXECUTE BATCH INTEGRATION
// =============================================================================

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

interface OperationResult {
  id?: string;
  operation: string;
  success: boolean;
  data?: ConvexJsonValue;
  error?: string;
  duration?: number;
  rowCount?: number;
  requiresApproval?: boolean;
  approvalId?: string;
}

type BatchResult = Infer<typeof batchResultValidator>;

export const executeBatchIntegration = internalAction({
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

    console.log('[executeBatchIntegration] Starting batch:', {
      integrationName,
      operationCount: operations.length,
      operations: operations.map((op) => op.operation),
    });

    // 1. Load integration config ONCE
    const integration = await ctx.runQuery(
      internal.integrations.internal_queries.getByName,
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
    return executeRestApiBatch(ctx, integration, operations, organizationId, threadId, messageId, startTime);
  },
});

async function executeSqlBatch(
  ctx: ActionCtx,
  integration: SqlIntegration,
  operations: Array<{ id?: string; operation: string; params?: Record<string, unknown> }>,
  threadId: string | undefined,
  messageId: string | undefined,
  startTime: number,
) {
  const { sqlConnectionConfig, sqlOperations } = integration;

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

  const results = await Promise.allSettled(
    operations.map(async (op) => {
      const opStartTime = Date.now();
      const params = op.params || {};

      try {
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

          if (requiresApproval(operationConfig)) {
            const operationType = getOperationType(operationConfig);

            const approvalId = await ctx.runMutation(
              internal.agent_tools.integrations.internal_mutations.createIntegrationApproval,
              {
                organizationId: integration.organizationId,
                integrationId: integration._id,
                integrationName: integration.name,
                integrationType: 'sql',
                operationName: op.operation,
                operationTitle: operationConfig.title || op.operation,
                operationType,
                parameters: params as ConvexJsonRecord,
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

        const isWriteOperation = operationConfig ? getOperationType(operationConfig) === 'write' : false;

        const result = (await ctx.runAction(
          internal.node_only.sql.internal_actions.executeQuery,
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
            params: queryParams as ConvexJsonRecord,
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
            data: result.data as ConvexJsonValue,
            rowCount: result.rowCount,
            duration: result.duration,
          } as ConvexJsonValue,
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

  const processedResults = results.map((result, index): OperationResult => {
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

  console.log('[executeBatchIntegration] SQL batch complete:', {
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

async function executeRestApiBatch(
  ctx: ActionCtx,
  integration: Integration,
  operations: Array<{ id?: string; operation: string; params?: Record<string, unknown> }>,
  organizationId: string,
  threadId: string | undefined,
  messageId: string | undefined,
  startTime: number,
) {
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

        const rowCount = result && typeof result === 'object' && 'rowCount' in result
          ? (result.rowCount as number | undefined)
          : undefined;

        return {
          id: op.id,
          operation: op.operation,
          success: true,
          data: result as ConvexJsonValue,
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

  const processedResults = results.map((result, index): OperationResult => {
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

  console.log('[executeBatchIntegration] REST API batch complete:', {
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
