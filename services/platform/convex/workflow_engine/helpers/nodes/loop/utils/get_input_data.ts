/**
 * Get and validate input data from configuration
 */

import { replaceVariables } from '../../../../../lib/variables/replace_variables';
import type { LoopNodeConfig } from '../../../../types/nodes';
import type { StepExecutionContext } from '../../../../types/workflow';

export function getInputData(
  ctx: StepExecutionContext,
  config: LoopNodeConfig,
): unknown[] {
  const vars = ctx.variables;
  const itemsConfig = config.items;

  if (itemsConfig === undefined) {
    throw new Error('Loop items configuration is required (config.items)');
  }

  // `config.items` has ALREADY been resolved from its `{{…}}` template by the
  // generic step-config pass (execute_step_handler → replaceVariables) before
  // the loop node runs, so only a still-raw template string needs resolving
  // here. A value that is already concrete — the normal case: the resolved
  // array of items — must be used AS-IS. Re-running replaceVariables over it
  // would recurse into every element and RE-INTERPRET any `{{…}}` inside as a
  // JEXL expression; loop items are routinely user-controlled (e.g. GitHub
  // issue titles/bodies), which legitimately contain `{{…}}` (spreads,
  // ellipses, Handlebars/Vue snippets). That double pass turns benign text
  // into a `Token . unexpected` JEXL crash that kills the whole loop before a
  // single item is processed — and it isn't caught by continueOnError, which
  // only guards the loop body, not item resolution.
  const resolved =
    typeof itemsConfig === 'string'
      ? replaceVariables(itemsConfig, vars)
      : itemsConfig;

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
