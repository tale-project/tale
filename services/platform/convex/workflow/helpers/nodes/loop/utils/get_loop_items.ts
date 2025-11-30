/**
 * Get items from loop variables or fetch fresh data
 */

import { LoopVars, StepExecutionContext } from '../../../../types/workflow';
import { LoopNodeConfig } from '../../../../types/nodes';
import { getInputData } from './get_input_data';

export function getLoopItems(
  loop: LoopVars | undefined,
  ctx: StepExecutionContext,
  config: LoopNodeConfig,
): unknown[] {
  const existingItems = loop?.items;
  if (Array.isArray(existingItems) && existingItems.length > 0) {
    return existingItems;
  }
  return getInputData(ctx, config);
}
