/**
 * Check if loop variables exist and loop is not complete
 */

import { LoopVars } from '../../../../types/workflow';

export function isLoopInProgress(loop: LoopVars | undefined): boolean {
  return !!(loop?.state && !loop.state.isComplete);
}
