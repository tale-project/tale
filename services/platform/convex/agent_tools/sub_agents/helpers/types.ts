/**
 * Types for sub-agent thread management.
 */

/**
 * Sub-agent key for thread mapping.
 * Used as the key in the sub-threads map to identify delegate agent threads.
 * Typically the delegate agent's rootVersionId or a stable identifier.
 */
export type SubAgentKey = string;

/** Structure of the subThreads mapping in parent thread summary */
export type SubThreadsMap = Record<string, string>;

/** Extended summary structure for threads with sub-thread mappings */
export interface ThreadSummaryWithSubThreads {
  chatType?: string;
  subThreads?: SubThreadsMap;
  [key: string]: unknown;
}

/** Summary structure for sub-threads (stores parent thread reference) */
export interface SubThreadSummary {
  subAgentType: SubAgentKey;
  parentThreadId: string;
}
