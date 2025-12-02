/**
 * Create loop result object
 */

import { StepExecutionResult, LoopVars } from '../../../../types/workflow';

import { createDebugLog } from '../../../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_WORKFLOW', '[Workflow]');

export function createLoopResult(
  port: string,
  items: unknown[],
  state: NonNullable<LoopVars['state']>,
  currentItem: unknown | null,
  currentIndex: number,
  parentLoop: LoopVars | undefined,
  ownerStepSlug: string,
): StepExecutionResult {
  const loopVars: LoopVars = {
    ownerStepSlug,
    items,
    state,
    item: currentItem,
    index: currentIndex,
    parent: parentLoop,
  };

  debugLog('createLoopResult Creating loop result:', {
    port,
    currentIndex,
    hasParent: !!parentLoop,
    ownerStepSlug,
  });

  return {
    port,
    variables: { loop: loopVars },
    output: {
      type: 'loop',
      data: { state, item: currentItem },
    },
  };
}
