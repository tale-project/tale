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
  if (!isLoopProgress(state)) return null;
  if (isRecord(state) && state.isComplete === true) return null;

  return {
    current: state.currentIndex + 1,
    total: state.totalItems,
  };
}
