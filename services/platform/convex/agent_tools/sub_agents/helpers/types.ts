/**
 * Types for sub-agent thread management.
 */

/** Available sub-agent types */
export type SubAgentType =
  | 'web_assistant'
  | 'document_assistant'
  | 'integration_assistant'
  | 'workflow_assistant';

/** Structure of the subThreads mapping in parent thread summary */
export type SubThreadsMap = Partial<Record<SubAgentType, string>>;

/** Extended summary structure for threads with sub-thread mappings */
export interface ThreadSummaryWithSubThreads {
  chatType?: string;
  subThreads?: SubThreadsMap;
  [key: string]: unknown;
}
