/**
 * Central export point for workflow_processing_records model
 */

// Types and validators
export * from './types';

// Internal operations
export { findUnprocessed } from './find_unprocessed';
export type {
  FindUnprocessedArgs,
  FindUnprocessedResult,
} from './find_unprocessed';

export { recordClaimed } from './record_claimed';
export type { RecordClaimedArgs } from './record_claimed';

export { findAndClaimUnprocessed } from './find_and_claim_unprocessed';
export type {
  FindAndClaimUnprocessedArgs,
  FindAndClaimUnprocessedResult,
} from './types';

export { recordProcessed } from './record_processed';
export type { RecordProcessedArgs } from './record_processed';

// Specific implementations
export { findUnprocessedOpenConversation } from './find_unprocessed_open_conversation';
export type {
  FindUnprocessedOpenConversationArgs,
  FindUnprocessedOpenConversationResult,
} from './find_unprocessed_open_conversation';

export { findProductRecommendationByStatus } from './find_product_recommendation_by_status';
export type {
  FindProductRecommendationByStatusArgs,
  FindProductRecommendationByStatusResult,
} from './find_product_recommendation_by_status';

// Helper functions for custom queries
export { isRecordProcessed } from './is_document_processed';
export type { IsRecordProcessedArgs } from './is_document_processed';

export { getLatestProcessedCreationTime } from './get_latest_processed_creation_time';
export type { GetLatestProcessedCreationTimeArgs } from './get_latest_processed_creation_time';

export { getLatestConversationMessage } from './get_latest_conversation_message';

export { getProcessingRecordById } from './get_processing_record_by_id';
export type { GetProcessingRecordByIdArgs } from './get_processing_record_by_id';
