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

export { findUnprocessedWithCustomQuery } from './helpers/find_unprocessed_with_custom_query';
export type {
  FindUnprocessedWithCustomQueryArgs,
  FindUnprocessedWithCustomQueryResult,
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
export { isRecordProcessed } from './helpers/is_document_processed';
export type { IsRecordProcessedArgs } from './helpers/is_document_processed';

export { getLatestProcessedCreationTime } from './helpers/get_latest_processed_creation_time';
export type { GetLatestProcessedCreationTimeArgs } from './helpers/get_latest_processed_creation_time';

export { getLatestConversationMessage } from './helpers/get_latest_conversation_message';

export { getProcessingRecordById } from './get_processing_record_by_id';
export type { GetProcessingRecordByIdArgs } from './get_processing_record_by_id';
