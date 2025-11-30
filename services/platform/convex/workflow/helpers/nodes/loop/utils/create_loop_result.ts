/**
 * Create loop result object
 */

import { StepExecutionResult, LoopVars } from '../../../../types/workflow';

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

  console.log('[createLoopResult] Creating loop result:', {
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
