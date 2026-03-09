/**
 * Get active loop progress for real-time UI tracking.
 * Returns null when no loop is active or loop has completed.
 */

import { isLoopProgress, isRecord } from '../../../../lib/utils/type-guards';

export function getActiveLoopProgress(
  loop: unknown,
): { current: number; total: number } | null {
  if (!isRecord(loop)) return null;

  const state = loop.state;
  if (!isRecord(state)) return null;
  if (state.isComplete === true) return null;
  if (!isLoopProgress(state)) return null;

  return {
    current: state.currentIndex + 1,
    total: state.totalItems,
  };
}
