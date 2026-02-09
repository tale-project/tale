import type { Id } from '../../../../_generated/dataModel';

export type TableName =
  | 'customers'
  | 'products'
  | 'documents'
  | 'conversations'
  | 'approvals'
  | 'onedriveSyncConfigs'
  | 'websitePages'
  | 'exampleMessages';

// The model layer returns { documents: T[], count } but actions extract just the first document
// because execute_action_node wraps the result in output: { type: 'action', data: result }
// This type represents the action layer's return type (first document or null)
export type FindUnprocessedResult<T = unknown> = T | null;

export type ProcessingRecord = {
  _id: Id<'workflowProcessingRecords'>;
  _creationTime: number;
  organizationId: string;
  tableName: string;
  recordId: string;
  wfDefinitionId: string;
  recordCreationTime: number;
  processedAt: number;
  status?: 'in_progress' | 'completed';
  metadata?: unknown;
};

export type RecordProcessedResult = ProcessingRecord | null;
