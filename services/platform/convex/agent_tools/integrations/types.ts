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
 * Integration introspection result for SQL integrations
 */
export interface SqlIntrospectionResult {
  type: 'sql';
  integrationName: string;
  title?: string;
  description?: string;
  engine: 'mssql' | 'postgres' | 'mysql';
  operations: Array<SqlOperation & { isIntrospection?: boolean }>;
}

/**
 * Union type for all introspection results
 */
export type IntegrationIntrospectionResult =
  | RestApiIntrospectionResult
  | SqlIntrospectionResult;

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
