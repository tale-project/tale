/**
 * Condition Node Executor - Helper Function
 */

import { evaluateExpression } from '../../../../lib/variables/evaluate_expression';
import { ConditionNodeConfig, StepExecutionResult } from '../../../types';

/**
 * Execute condition step logic (helper function)
 */
export function executeConditionNode(
  config: ConditionNodeConfig,
  variables: Record<string, unknown>,
): StepExecutionResult {
  // The expression has already been processed by replaceVariables() in execute_step.ts
  // So config.expression should have all {{...}} replaced with actual values
  const expression = config.expression || 'false';

  // Evaluate the expression (must return boolean)
  const passed = evaluateExpression(expression, variables);
  const conditionDescription = `Expression: ${expression}`;

  const message = `Condition ${passed ? 'passed' : 'failed'}: ${conditionDescription}`;
  return {
    port: passed ? 'true' : 'false',
    output: {
      type: 'condition',
      data: {
        passed,
        description: conditionDescription,
        expression: config.expression ?? null,
        message,
      },
      meta: {
        variablesFromConfig: config.variables ?? {},
        conditionDescription,
      },
    },
  };
}
