/**
 * Type-safe function references for summarization module.
 *
 * This module provides strongly-typed function references that can be used
 * with ctx.scheduler.runAfter() and ctx.runAction() without TS2589 errors.
 *
 * The FunctionReference type is explicitly defined to avoid deep type inference.
 */

import type { FunctionReference } from 'convex/server';
import { createRef } from '../function_refs/create_ref';

/**
 * Type definition for autoSummarizeIfNeeded action.
 */
export type AutoSummarizeIfNeededRef = FunctionReference<
  'action',
  'internal',
  { threadId: string },
  { summarized: boolean; existingSummary?: string; newMessageCount: number; totalMessagesSummarized: number }
>;

/**
 * Get the function reference for autoSummarizeIfNeeded.
 *
 * Usage:
 * ```typescript
 * import { getAutoSummarizeRef } from '../../lib/summarization/function_refs';
 * await ctx.scheduler.runAfter(0, getAutoSummarizeRef(), { threadId });
 * ```
 */
export function getAutoSummarizeRef(): AutoSummarizeIfNeededRef {
  return createRef<AutoSummarizeIfNeededRef>('internal', ['lib', 'summarization', 'internal_actions', 'autoSummarizeIfNeeded']);
}
