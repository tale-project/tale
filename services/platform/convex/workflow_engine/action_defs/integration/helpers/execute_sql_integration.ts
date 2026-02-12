/**
 * SQL Integration Execution Helper
 *
 * Handles execution of SQL-based integrations
 */

import type { ActionCtx } from '../../../../_generated/server';

import { internal } from '../../../../_generated/api';
import {
  type SqlIntegration,
  type SqlOperation,
} from '../../../../integrations/types';
import { createDebugLog } from '../../../../lib/debug_log';
import { toConvexJsonRecord } from '../../../../lib/type_cast_helpers';
import { decryptSqlCredentials } from './decrypt_sql_credentials';
import { requiresApproval, getOperationType } from './detect_write_operation';
import { getIntrospectColumnsQuery } from './get_introspect_columns_query';
import { getIntrospectTablesQuery } from './get_introspect_tables_query';
import { getIntrospectionOperations } from './get_introspection_operations';
import { isIntrospectionOperation } from './is_introspection_operation';
import { validateRequiredParameters } from './validate_required_parameters';

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
  integration: SqlIntegration,
  operation: string,
  params: Record<string, unknown>,
  skipApprovalCheck: boolean = false,
  threadId?: string,
  messageId?: string,
): Promise<unknown> {
  // Debug: Log context received by SQL integration executor
  debugLog('Received context:', {
    hasThreadId: threadId !== undefined,
    hasMessageId: messageId !== undefined,
    threadId: threadId,
    messageId: messageId,
    operation,
    integrationName: integration.name,
  });

  const { sqlConnectionConfig, sqlOperations } = integration;

  if (!sqlConnectionConfig) {
    throw new Error(
      `SQL integration "${integration.name}" is missing sqlConnectionConfig`,
    );
  }

  if (!sqlConnectionConfig.server) {
    throw new Error(
      `SQL integration "${integration.name}" is missing a server address. Configure it in the integration settings.`,
    );
  }

  if (!sqlConnectionConfig.database) {
    throw new Error(
      `SQL integration "${integration.name}" is missing a database name. Configure it in the integration settings.`,
    );
  }

  // Handle system introspection operations
  let query: string;
  let queryParams: Record<string, unknown> = params;
  let operationConfig: SqlOperation | undefined;

  if (isIntrospectionOperation(operation)) {
    // System introspection operations - never require approval
    if (operation === 'introspect_tables') {
      query = getIntrospectTablesQuery(sqlConnectionConfig.engine);
      queryParams = {};
    } else if (operation === 'introspect_columns') {
      // Requires schemaName and tableName parameters
      const schemaName =
        typeof params.schemaName === 'string' ? params.schemaName : undefined;
      const tableName =
        typeof params.tableName === 'string' ? params.tableName : undefined;
      if (!schemaName || !tableName) {
        throw new Error(
          'introspect_columns requires schemaName and tableName parameters',
        );
      }
      const introspectionQuery = getIntrospectColumnsQuery(
        sqlConnectionConfig.engine,
        schemaName,
        tableName,
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
    operationConfig = sqlOperations.find((op) => op.name === operation);

    if (!operationConfig) {
      const userOps = sqlOperations.map((op) => op.name);
      const introspectionOps = getIntrospectionOperations();
      const availableOps = [...userOps, ...introspectionOps].join(', ');
      throw new Error(
        `Operation "${operation}" not found in SQL integration "${integration.name}". ` +
          `Available operations: ${availableOps}`,
      );
    }

    query = operationConfig.query;

    // Validate required parameters before proceeding
    validateRequiredParameters(operationConfig, params, operation);

    // Check if this operation requires approval
    if (!skipApprovalCheck && requiresApproval(operationConfig)) {
      const operationType = getOperationType(operationConfig);
      debugLog(
        `Operation ${operation} requires approval (type: ${operationType})`,
      );

      // Create approval and return approval result instead of executing
      const approvalId = await ctx.runMutation(
        internal.agent_tools.integrations.internal_mutations
          .createIntegrationApproval,
        {
          organizationId: integration.organizationId,
          integrationId: integration._id,
          integrationName: integration.name,
          integrationType: 'sql',
          operationName: operation,
          operationTitle: operationConfig.title || operation,
          operationType,
          parameters: toConvexJsonRecord(params),
          threadId,
          messageId,
          estimatedImpact: `This ${operationType} operation will modify data in ${sqlConnectionConfig.database}`,
        },
      );

      // Return approval required result - object literal satisfies interface
      const approvalResult: ApprovalRequiredResult = {
        requiresApproval: true,
        approvalId,
        integrationName: integration.name,
        operationName: operation,
        operationTitle: operationConfig.title || operation,
        operationType,
        parameters: params,
      };
      return approvalResult;
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

  // Cast result from runAction - type validated by action's returns validator
  const result = await ctx.runAction(
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
      params: toConvexJsonRecord(queryParams),
      security: {
        maxResultRows: sqlConnectionConfig.security?.maxResultRows,
        queryTimeoutMs: sqlConnectionConfig.security?.queryTimeoutMs,
      },
      // Allow write operations when the operation type is 'write' (approval was already checked above)
      allowWrite: isWriteOperation,
    },
  );

  if (!result.success) {
    throw new Error(`SQL query failed: ${result.error}`);
  }

  // For write operations, check if any rows were affected
  if (
    isWriteOperation &&
    (result.rowCount === 0 ||
      !result.data ||
      (Array.isArray(result.data) && result.data.length === 0))
  ) {
    throw new Error(
      `Write operation "${operation}" completed but no rows were affected. ` +
        `This may indicate the target record doesn't exist or doesn't match the operation's criteria.`,
    );
  }

  debugLog(
    `SQL query returned ${result.rowCount} rows in ${result.duration}ms`,
  );

  return {
    name: integration.name,
    operation,
    engine: sqlConnectionConfig.engine,
    data: result.data,
    rowCount: result.rowCount,
    duration: result.duration,
  };
}
