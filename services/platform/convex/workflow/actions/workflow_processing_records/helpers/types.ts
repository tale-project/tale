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

// Actions should return data directly (not wrapped in { data: ... })
// because execute_action_node wraps the result in output: { type: 'action', data: result }
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
  metadata?: unknown;
};

export type RecordProcessedResult = ProcessingRecord | null;

