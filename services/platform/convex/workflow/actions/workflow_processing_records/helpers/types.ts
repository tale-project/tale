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

export type FindUnprocessedResult<T = unknown> = {
  documents: T[];
  count: number;
};

export type RecordProcessedResult = {
  operation: 'record_processed';
  recordId: Id<'workflowProcessingRecords'>;
  success: boolean;
  timestamp: number;
};

