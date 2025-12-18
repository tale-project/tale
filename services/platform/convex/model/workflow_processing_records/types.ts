/**
 * Types and validators for workflow processing records
 */

/**
 * Supported table names for workflow processing
 */
export type TableName =
  | 'customers'
  | 'products'
  | 'documents'
  | 'conversations'
  | 'approvals'
  | 'onedriveSyncConfigs'
  | 'websitePages'
  | 'exampleMessages';

/**
 * Arguments for finding and claiming a single unprocessed document with custom query
 */
export interface FindAndClaimUnprocessedArgs<T = unknown> {
  organizationId: string;
  tableName: TableName;
  wfDefinitionId: string;
  cutoffTimestamp: string;

  /**
   * Build the query with your custom index and filters.
   * The resumeFrom parameter is the _creationTime to resume from (null if first run).
   *
   * You should:
   * 1. Use the appropriate index for your use case
   * 2. Apply the resumeFrom filter if provided using .gt('_creationTime', resumeFrom) in the index query
   *    (_creationTime is automatically indexed in every Convex index)
   * 3. Return the query in ascending order
   */
  buildQuery: (
    resumeFrom: number | null,
  ) => AsyncIterable<T & { _id: unknown; _creationTime: number }>;

  /**
   * Optional additional filter to apply to each document.
   * This runs after the processing status check.
   *
   * Use this for filters that:
   * - Can't be expressed in indexes
   * - Require additional queries (e.g., checking related data)
   * - Are too complex for index queries
   */
  additionalFilter?: (
    doc: T & { _id: unknown; _creationTime: number },
  ) => Promise<boolean>;
}

/**
 * Return type for finding and claiming a single unprocessed document.
 * Returns null if no unprocessed document was found or claiming failed.
 */
export interface FindAndClaimUnprocessedResult<T = unknown> {
  document: T | null;
}
