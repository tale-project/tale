/**
 * Central export point for workflow_processing_records model
 */

// Types
export * from './types';

// Constants
export { BACKOFF_NEVER_REPROCESS } from './constants';

// Helpers
export { calculateCutoffTimestamp } from './calculate_cutoff_timestamp';

// Smart index selection
export { getTableIndexes, type IndexConfig } from './index_registry';
export { parseFilterExpression, type ParsedFilterExpression } from './parse_filter_expression';
export { selectOptimalIndex, type IndexSelectionResult } from './index_selection';

// Internal operations
export { findUnprocessed } from './query_building';
export type {
  FindUnprocessedArgs,
  FindUnprocessedResult,
} from './query_building';

export { recordClaimed } from './record_claimed';
export type { RecordClaimedArgs } from './record_claimed';

export { findAndClaimUnprocessed } from './find_and_claim_unprocessed';
export type {
  FindAndClaimUnprocessedArgs,
  FindAndClaimUnprocessedResult,
} from './types';

export { recordProcessed } from './record_processed';
export type { RecordProcessedArgs } from './record_processed';

// Helper functions for custom queries
export { isRecordProcessed } from './is_record_processed';
export type { IsRecordProcessedArgs } from './is_record_processed';

export { getLatestProcessedCreationTime } from './get_latest_processed_creation_time';
export type { GetLatestProcessedCreationTimeArgs } from './get_latest_processed_creation_time';

export { getProcessingRecordById } from './get_processing_record_by_id';
export type { GetProcessingRecordByIdArgs } from './get_processing_record_by_id';
