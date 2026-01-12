/**
 * Integration Tool Type Definitions
 */

import type { ConnectorOperation, SqlOperation } from '../../model/integrations/types';

// =============================================================================
// INTEGRATION TOOL RESULT TYPES
// =============================================================================

/**
 * Result from executing an integration operation
 */
export interface IntegrationExecutionResult {
  success: boolean;
  integration: string;
  operation: string;
  data: unknown;
  duration?: number;
  version?: number;
  /** True if this operation requires user approval before execution */
  requiresApproval?: boolean;
  /** Approval ID if approval is required */
  approvalId?: string;
  /** Explicit flag confirming an approval was successfully created (only true when approval actually exists) */
  approvalCreated?: boolean;
  /** Message to show user about the approval */
  approvalMessage?: string;
}

/**
 * Integration introspection result for REST API integrations
 */
export interface RestApiIntrospectionResult {
  type: 'rest_api';
  integrationName: string;
  title?: string;
  description?: string;
  operations: ConnectorOperation[];
}

/**
 * Summary of an SQL operation (without the actual SQL query).
 * Used for introspection results to reduce token usage.
 */
export interface SqlOperationSummary {
  name: string;
  title?: string;
  description?: string;
  parametersSchema?: SqlOperation['parametersSchema'];
  operationType?: 'read' | 'write';
  isIntrospection?: boolean;
}

/**
 * Integration introspection result for SQL integrations
 */
export interface SqlIntrospectionResult {
  type: 'sql';
  integrationName: string;
  title?: string;
  description?: string;
  engine: 'mssql' | 'postgres' | 'mysql';
  operations: SqlOperationSummary[];
}

/**
 * Union type for all introspection results
 */
export type IntegrationIntrospectionResult =
  | RestApiIntrospectionResult
  | SqlIntrospectionResult;

/**
 * Lightweight operation summary for list mode (no parametersSchema).
 * Used when listing all operations to minimize token usage.
 */
export interface OperationListItem {
  name: string;
  title?: string;
  operationType?: 'read' | 'write';
}

/**
 * Introspection result in summary mode (operation list without details).
 */
export interface IntrospectionSummaryResult {
  type: 'rest_api' | 'sql';
  integrationName: string;
  operations: OperationListItem[];
}

/**
 * Detailed operation info returned when querying a specific operation.
 */
export interface OperationDetailResult {
  name: string;
  title?: string;
  description?: string;
  operationType?: 'read' | 'write';
  parametersSchema?: Record<string, unknown>;
}

/**
 * Result from listing all integrations
 */
export interface IntegrationListResult {
  integrations: Array<{
    name: string;
    title?: string;
    description?: string;
    type: 'rest_api' | 'sql';
    status: string;
  }>;
}

// =============================================================================
// BATCH OPERATION TYPES
// =============================================================================

/**
 * Single operation result within a batch
 */
export interface BatchOperationItemResult {
  /** Optional ID provided by caller for tracking */
  id?: string;
  /** Operation name that was executed */
  operation: string;
  /** Whether the operation succeeded */
  success: boolean;
  /** Result data if successful */
  data?: unknown;
  /** Error message if failed */
  error?: string;
  /** Execution time in milliseconds */
  duration?: number;
  /** Number of rows returned (for SQL operations) */
  rowCount?: number;
  /** True if this operation requires approval */
  requiresApproval?: boolean;
  /** Approval ID if approval was created */
  approvalId?: string;
}

/**
 * Statistics for a batch operation
 */
export interface BatchOperationStats {
  /** Total execution time in milliseconds */
  totalTime: number;
  /** Number of successful operations */
  successCount: number;
  /** Number of failed operations */
  failureCount: number;
  /** Number of operations requiring approval */
  approvalCount?: number;
}

/**
 * Result from executing a batch of integration operations
 */
export interface BatchOperationResult {
  /** True if all operations succeeded (no failures) */
  success: boolean;
  /** Integration name */
  integration: string;
  /** Results for each operation */
  results: BatchOperationItemResult[];
  /** Aggregate statistics */
  stats: BatchOperationStats;
}
