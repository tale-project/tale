/**
 * Types for integration processing records action
 *
 * Types are inferred from validators to ensure consistency.
 */

import type { Infer } from 'convex/values';
import type { Id } from '../../../_generated/dataModel';
import type {
  cursorConfigValidator,
  cursorFormatValidator,
  findAllValidator,
  findByCursorValidator,
  findByIdValidator,
  findByTimestampValidator,
  integrationProcessingRecordsParamsValidator,
  recordProcessedValidator,
} from './validators';

/** Cursor format for parsing external timestamps */
export type CursorFormat = Infer<typeof cursorFormatValidator>;

/** Cursor configuration */
export type CursorConfig = Infer<typeof cursorConfigValidator>;

/** Find by timestamp strategy params */
export type FindByTimestampParams = Infer<typeof findByTimestampValidator>;

/** Find by cursor strategy params */
export type FindByCursorParams = Infer<typeof findByCursorValidator>;

/** Find by ID strategy params */
export type FindByIdParams = Infer<typeof findByIdValidator>;

/** Find all strategy params */
export type FindAllParams = Infer<typeof findAllValidator>;

/** Record processed strategy params */
export type RecordProcessedParams = Infer<typeof recordProcessedValidator>;

/** All strategy params (discriminated union) */
export type IntegrationProcessingRecordsParams = Infer<
  typeof integrationProcessingRecordsParamsValidator
>;

/** Find strategy params (union of all find strategies) */
export type FindStrategyParams =
  | FindByTimestampParams
  | FindByCursorParams
  | FindByIdParams
  | FindAllParams;

/** Strategy type */
export type Strategy = IntegrationProcessingRecordsParams['strategy'];

/** Find strategy type */
export type FindStrategy = FindStrategyParams['strategy'];

/**
 * Result of finding unprocessed integration records
 *
 * - T[] (non-empty array): Successfully claimed records
 * - null: No more unprocessed records available
 */
export type FindUnprocessedResult<T = unknown> = T[] | null;

/**
 * Processing record from the workflowProcessingRecords table
 */
export interface ProcessingRecord {
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
}

/**
 * Metadata stored with processing records for incremental strategies
 */
export interface IntegrationProcessingMetadata {
  /** The resume point for the next fetch (timestamp, cursor, or ID) */
  resumePoint?: string | number;
  /** The strategy used */
  strategy?: FindStrategy;
  /** Original data from the integration (for auditing) */
  originalData?: Record<string, unknown>;
}
