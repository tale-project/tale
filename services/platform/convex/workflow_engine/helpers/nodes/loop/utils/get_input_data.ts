/**
 * Get and validate input data from configuration
 */

import { replaceVariables } from '../../../../../lib/variables/replace_variables';
import { LoopNodeConfig } from '../../../../types/nodes';
import { StepExecutionContext } from '../../../../types/workflow';

export function getInputData(
  ctx: StepExecutionContext,
  config: LoopNodeConfig,
): unknown[] {
  const vars = ctx.variables;
  const itemsConfig = config.items;

  if (itemsConfig === undefined) {
    throw new Error('Loop items configuration is required (config.items)');
  }

  const resolved = replaceVariables(itemsConfig, vars);

  if (!Array.isArray(resolved)) {
    throw new Error(
      `Loop items must resolve to an array. Received: ${resolved === null ? 'null' : typeof resolved}`,
    );
  }

  if (resolved.length === 0) {
    throw new Error('Loop items resolved to an empty array');
  }

  return resolved;
}
