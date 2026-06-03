import { getBoolean, isRecord } from '../../../lib/utils/type-guards';

/**
 * Shape returned by the integration-execution action when a write operation
 * needs user approval before it runs.
 */
export interface ApprovalResult {
  requiresApproval: true;
  approvalId: string;
  operationName: string;
  operationTitle: string;
  operationType: 'read' | 'write';
  parameters: Record<string, unknown>;
}

export function isApprovalResult(r: unknown): r is ApprovalResult {
  return isRecord(r) && getBoolean(r, 'requiresApproval') === true;
}
