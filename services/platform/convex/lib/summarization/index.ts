/**
 * Summarization Module
 *
 * Provides shared summarization functionality for all agents.
 * All agents are equal and use the same summarization logic.
 */

export {
  autoSummarizeIfNeededModel,
  type AutoSummarizeIfNeededArgs,
  type AutoSummarizeIfNeededResult,
} from './auto_summarize';

export {
  getAutoSummarizeRef,
  type AutoSummarizeIfNeededRef,
} from './function_refs';
