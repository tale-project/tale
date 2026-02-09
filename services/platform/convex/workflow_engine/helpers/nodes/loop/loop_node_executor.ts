/**
 * Loop Node Executor
 *
 * Provides loop functionality for workflow processing.
 * Iterates through an array of items one at a time.
 */

import { createDebugLog } from '../../../../lib/debug_log';
import { LoopNodeConfig } from '../../../types/nodes';
import {
  StepExecutionContext,
  StepExecutionResult,
  LoopVars,
} from '../../../types/workflow';
import { PORTS } from '../constants';
import { createLoopResult } from './utils/create_loop_result';
import { createLoopState } from './utils/create_loop_state';
import { getInputData } from './utils/get_input_data';
import { getLoopItems } from './utils/get_loop_items';
import { isLoopInProgress } from './utils/is_loop_in_progress';

const debugLog = createDebugLog('DEBUG_WORKFLOW', '[Workflow]');

export class LoopNodeExecutor {
  /**
   * Execute the loop node
   */
  static async execute(
    ctx: StepExecutionContext,
    config: LoopNodeConfig,
  ): Promise<StepExecutionResult> {
    const loop = (ctx.variables as Record<string, unknown>)['loop'] as
      | LoopVars
      | undefined;

    // Only continue an existing loop if it belongs to this step
    if (
      isLoopInProgress(loop) &&
      loop?.ownerStepSlug === ctx.stepDef.stepSlug
    ) {
      const items = getLoopItems(loop, ctx, config);
      const loopState = loop?.state;
      if (!loopState) {
        throw new Error('Loop state is required when continuing a loop');
      }
      debugLog('LoopNodeExecutor Continuing loop:', {
        stepSlug: ctx.stepDef.stepSlug,
        currentIndex: loopState.currentIndex,
        hasParent: !!loop?.parent,
      });
      return this.continueLoop(
        items,
        loopState,
        loop?.parent,
        ctx.stepDef.stepSlug,
      );
    }

    const inputData = getInputData(ctx, config);
    // When starting a new loop, if there is an in-progress different loop, treat it as parent
    const parentLoop =
      loop &&
      !loop.state?.isComplete &&
      loop.ownerStepSlug !== ctx.stepDef.stepSlug
        ? loop
        : undefined;
    debugLog('LoopNodeExecutor Starting new loop:', {
      stepSlug: ctx.stepDef.stepSlug,
      itemsCount: inputData.length,
      hasParent: !!parentLoop,
    });
    return this.startNewLoop(inputData, parentLoop, ctx.stepDef.stepSlug);
  }

  /**
   * Start a new loop with the first item
   */
  private static startNewLoop(
    items: unknown[],
    parentLoop: LoopVars | undefined,
    ownerStepSlug: string,
  ): StepExecutionResult {
    const totalItems = items.length;
    const currentIndex = 0;
    const currentItem = items[currentIndex];

    const state = createLoopState(
      currentIndex,
      totalItems,
      false, // Not complete on first iteration
      0, // Will be incremented in continueLoop
    );

    return createLoopResult(
      PORTS.LOOP,
      items,
      state,
      currentItem,
      currentIndex,
      parentLoop,
      ownerStepSlug,
    );
  }

  /**
   * Continue to the next item in the loop
   */
  private static continueLoop(
    items: unknown[],
    previousState: NonNullable<LoopVars['state']>,
    parentLoop: LoopVars | undefined,
    ownerStepSlug: string,
  ): StepExecutionResult {
    const totalItems = items.length;
    const nextIndex = previousState.currentIndex + 1;
    const isComplete = nextIndex >= totalItems;
    const iterations = (previousState.iterations ?? 0) + 1;

    const newState = createLoopState(
      nextIndex,
      totalItems,
      isComplete,
      iterations,
    );

    if (isComplete) {
      // When loop completes, restore parent loop context
      return createLoopResult(
        PORTS.DONE,
        items,
        newState,
        null,
        -1,
        parentLoop,
        ownerStepSlug,
      );
    }

    const currentItem = items[nextIndex];
    return createLoopResult(
      PORTS.LOOP,
      items,
      newState,
      currentItem,
      nextIndex,
      parentLoop,
      ownerStepSlug,
    );
  }
}
