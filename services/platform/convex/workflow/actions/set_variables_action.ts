/**
 * Set Variables Action
 *
 * This action allows updating workflow variables during execution.
 * Useful for pagination, counters, and other dynamic state management.
 *
 * IMPORTANT: Variables are processed in the order they appear in the array.
 * Later variables can reference earlier ones in the same step.
 *
 * SECURE VARIABLES (Just-in-time decryption):
 * - Variables with `secure: true` MUST be provided as encrypted strings (JWE format)
 * - We DO NOT decrypt or persist plaintext anywhere in this step
 * - We persist only a secure wrapper under `secrets[name] = { __secure: true, encrypted }`
 * - Decryption happens on use in the action executor (execute_action_node), not here
 * - Access via templates like `{{secrets.name}}` still works; value resolves to the wrapper and is
 *   decrypted right before the target action executes
 */

import { v } from 'convex/values';
import type { ActionDefinition } from '../helpers/nodes/action/types';
import { replaceVariables } from '../../lib/variables/replace_variables';

import { createDebugLog } from '../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_WORKFLOW', '[Workflow]');

export const setVariablesAction: ActionDefinition<{
  variables: Array<{ name: string; value: unknown; secure?: boolean }>;
}> = {
  type: 'set_variables',
  title: 'Set Variables',
  description:
    'Update workflow variables during execution. Supports secure variables that are automatically decrypted and stored in secrets namespace.',
  parametersValidator: v.object({
    variables: v.array(
      v.object({
        name: v.string(),
        value: v.any(),
        secure: v.optional(v.boolean()),
      }),
    ),
  }),
  execute: async (_ctx, params, variables, _extras) => {
    // Process variables sequentially so later variables can reference earlier ones
    // Note: params.variables contains raw template strings (not pre-processed)
    // because execute_step.ts skips replaceVariables for set_variables action
    const processedVariables: Record<string, unknown> = {};
    const workingContext = { ...variables };
    debugLog(
      'set_variables Processing variables:',
      params.variables
        .map((v) => `${v.name}${v.secure ? ' (secure)' : ''}`)
        .join(', '),
    );

    for (const { name, value, secure } of params.variables) {
      // Replace variables in the value using the working context
      // This allows referencing previously set variables in the same step
      const processedValue = replaceVariables(value, workingContext);

      if (secure) {
        // Skip undefined/null secure values (e.g., password for OAuth2 or accessToken for password auth)
        if (
          processedValue === undefined ||
          processedValue === null ||
          processedValue === ''
        ) {
          debugLog(
            `set_variables Skipping undefined/null/empty secure variable '${name}'`,
          );
          continue;
        }

        // Secure variable: store encrypted wrapper in secrets namespace (no decryption)
        if (typeof processedValue !== 'string') {
          throw new Error(
            `Secure variable '${name}' must have a string value (encrypted JWE), got ${typeof processedValue}`,
          );
        }

        const secrets =
          (workingContext.secrets as Record<string, unknown>) || {};
        const secureWrapper = {
          __secure: true,
          encrypted: processedValue,
        } as const;
        secrets[name] = secureWrapper;

        processedVariables.secrets = secrets;
        workingContext.secrets = secrets;

        debugLog(`set_variables Stored secure wrapper in secrets.${name}`);
      } else {
        // Regular variable: store as-is
        processedVariables[name] = processedValue;
        workingContext[name] = processedValue;
      }
    }
    debugLog('set_variables Processed variables:', processedVariables);

    // Return processed variables in the result
    // execute_action_node will extract them and add to StepExecutionResult.variables
    return {
      variables: processedVariables,
    };
  },
};
