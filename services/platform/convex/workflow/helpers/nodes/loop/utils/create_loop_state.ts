/**
 * Create loop state object
 */

import { LoopVars } from '../../../../types/workflow';

export function createLoopState(
  currentIndex: number,
  totalItems: number,
  isComplete: boolean,
  iterations: number,
): NonNullable<LoopVars['state']> {
  return {
    currentIndex,
    totalItems,
    isComplete,
    iterations,
    batchesProcessed: iterations,
  };
}
