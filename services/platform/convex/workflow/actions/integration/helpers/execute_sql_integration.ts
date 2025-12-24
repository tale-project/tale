/**
 * SQL Integration Execution Helper
 *
 * Handles execution of SQL-based integrations
 */

import type { ActionCtx } from '../../../../_generated/server';
import type { Doc } from '../../../../_generated/dataModel';
import { internal } from '../../../../_generated/api';
import type { SqlExecutionResult } from '../../../../node_only/sql/types';
import { createDebugLog } from '../../../../lib/debug_log';
import { isIntrospectionOperation } from './is_introspection_operation';
import { getIntrospectTablesQuery } from './get_introspect_tables_query';
import { getIntrospectColumnsQuery } from './get_introspect_columns_query';
import { getIntrospectionOperations } from './get_introspection_operations';
import { decryptSqlCredentials } from './decrypt_sql_credentials';
import { requiresApproval, getOperationType } from './detect_write_operation';

const debugLog = createDebugLog('DEBUG_INTEGRATIONS', '[Integrations]');

/**
 * Result indicating an approval is required instead of execution
 */
export interface ApprovalRequiredResult {
  requiresApproval: true;
  approvalId: string;
  integrationName: string;
  operationName: string;
  operationTitle: string;
  operationType: 'read' | 'write';
  parameters: Record<string, unknown>;
}

/**
 * Execute a SQL integration operation
 */
export async function executeSqlIntegration(
  ctx: ActionCtx,
  integration: Doc<'integrations'>,
  operation: string,
  params: Record<string, unknown>,
  skipApprovalCheck: boolean = false,
  threadId?: string,
): Promise<any> {
  const sqlConnectionConfig = (integration as any).sqlConnectionConfig;
  const sqlOperations = (integration as any).sqlOperations || [];

  if (!sqlConnectionConfig) {
    throw new Error(
      `SQL integration "${integration.name}" is missing sqlConnectionConfig`,
    );
  }

  // Handle system introspection operations
  let query: string;
  let queryParams: Record<string, unknown> = params;
  let operationConfig: any = null;

  if (isIntrospectionOperation(operation)) {
    // System introspection operations - never require approval
    if (operation === 'introspect_tables') {
      query = getIntrospectTablesQuery(sqlConnectionConfig.engine);
      queryParams = {};
    } else if (operation === 'introspect_columns') {
      // Requires schemaName and tableName parameters
      if (!params.schemaName || !params.tableName) {
        throw new Error(
          'introspect_columns requires schemaName and tableName parameters',
        );
      }
      const introspectionQuery = getIntrospectColumnsQuery(
        sqlConnectionConfig.engine,
        params.schemaName as string,
        params.tableName as string,
      );
      query = introspectionQuery.query;
      queryParams = introspectionQuery.params;
    } else {
      const availableIntrospection = getIntrospectionOperations().join(', ');
      throw new Error(
        `Unknown introspection operation "${operation}". ` +
          `Available: ${availableIntrospection}`,
      );
    }
  } else {
    // User-defined operation
    operationConfig = sqlOperations.find(
      (op: any) => op.name === operation,
    );

    if (!operationConfig) {
      const userOps = sqlOperations.map((op: any) => op.name);
      const introspectionOps = getIntrospectionOperations();
      const availableOps = [...userOps, ...introspectionOps].join(', ');
      throw new Error(
        `Operation "${operation}" not found in SQL integration "${integration.name}". ` +
          `Available operations: ${availableOps}`,
      );
    }

    query = operationConfig.query;

    // Check if this operation requires approval
    if (!skipApprovalCheck && requiresApproval(operationConfig)) {
      const operationType = getOperationType(operationConfig);
      debugLog(
        `Operation ${operation} requires approval (type: ${operationType})`,
      );

      // Create approval and return approval result instead of executing
      const approvalId = await ctx.runMutation!(
        internal.agent_tools.integrations.create_integration_approval
          .createIntegrationApproval,
        {
          organizationId: (integration as any).organizationId,
          integrationId: integration._id,
          integrationName: integration.name,
          integrationType: 'sql',
          operationName: operation,
          operationTitle: operationConfig.title || operation,
          operationType,
          parameters: params,
          threadId,
          estimatedImpact: `This ${operationType} operation will modify data in ${sqlConnectionConfig.database}`,
        },
      );

      // Return approval required result
      return {
        requiresApproval: true,
        approvalId,
        integrationName: integration.name,
        operationName: operation,
        operationTitle: operationConfig.title || operation,
        operationType,
        parameters: params,
      } as ApprovalRequiredResult;
    }
  }

  // Decrypt credentials
  const credentials = await decryptSqlCredentials(ctx, integration);

  // Determine if this is a write operation (only relevant for user-defined operations)
  const isWriteOperation = operationConfig
    ? getOperationType(operationConfig) === 'write'
    : false;

  // Execute SQL query
  debugLog(
    `Executing SQL ${sqlConnectionConfig.engine} query: ${operation} on ${sqlConnectionConfig.server}/${sqlConnectionConfig.database} (write: ${isWriteOperation})`,
  );

  const result = (await ctx.runAction!(
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
      // Allow write operations when the operation type is 'write' (approval was already checked above)
      allowWrite: isWriteOperation,
    },
  )) as SqlExecutionResult;

  if (!result.success) {
    throw new Error(`SQL query failed: ${result.error}`);
  }

  // For write operations, check if any rows were affected
  if (isWriteOperation && (result.rowCount === 0 || !result.data || result.data.length === 0)) {
    throw new Error(
      `Write operation "${operation}" completed but no rows were affected. ` +
      `This may indicate the target record doesn't exist or doesn't match the operation's criteria.`
    );
  }

  debugLog(`SQL query returned ${result.rowCount} rows in ${result.duration}ms`);

  return {
    name: integration.name,
    operation,
    engine: sqlConnectionConfig.engine,
    data: result.data,
    rowCount: result.rowCount,
    duration: result.duration,
  };
}
