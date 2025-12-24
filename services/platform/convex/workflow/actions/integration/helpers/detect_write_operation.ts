/**
 * Operation Type Detection Helper
 *
 * Reads operation type from the integration configuration.
 * Operation types are explicitly defined in the integration to support
 * both SQL and REST API integrations in a generic way.
 */

import type { OperationType } from '../../../../model/integrations/types';

/**
 * Common interface for operation configs (works for both SQL and REST API operations)
 */
export interface OperationConfig {
  name: string;
  title?: string;
  operationType?: OperationType;
  requiresApproval?: boolean;
}

/**
 * Get the operation type from config
 * Defaults to 'read' if not specified
 */
export function getOperationType(
  operationConfig: OperationConfig | null | undefined,
): OperationType {
  if (!operationConfig) return 'read';
  return operationConfig.operationType || 'read';
}

/**
 * Determine if an operation requires approval
 * Uses explicit config if provided, otherwise defaults based on operation type:
 * - write operations require approval by default
 * - read operations don't require approval by default
 */
export function requiresApproval(
  operationConfig: OperationConfig | null | undefined,
): boolean {
  if (!operationConfig) return false;

  // Use explicit setting if provided
  if (typeof operationConfig.requiresApproval === 'boolean') {
    return operationConfig.requiresApproval;
  }

  // Default: write operations require approval, read operations don't
  return getOperationType(operationConfig) === 'write';
}
