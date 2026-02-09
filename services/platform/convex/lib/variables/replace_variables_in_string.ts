import { isBoolean, isNil, isNumber, isString, toString, trim } from 'lodash';
import Mustache from 'mustache';

import { buildContext } from './build_context';
import { jexlInstance } from './jexl_instance';

/**
 * Internal: Replace variables in template string using safe expression evaluator.
 *
 * Uses Mustache.parse() for robust template parsing, then evaluates expressions with JEXL.
 * This approach is more reliable than regex for handling edge cases and nested braces.
 */
export function replaceVariablesInString(
  template: string,
  variables: Record<string, unknown>,
): string {
  const context = buildContext(variables);

  // Use Mustache to parse the template into tokens
  // This handles all edge cases with braces, escaping, etc.
  const tokens = Mustache.parse(template);

  let result = '';
  for (const token of tokens) {
    const type = token[0] as string;
    const value = token[1];

    if (type === 'text') {
      // Plain text, just append
      result += value;
    } else if (type === 'name' || type === '&') {
      // Variable reference - evaluate with JEXL
      // Note: Mustache uses 'name' for {{var}}, '&' for {{{var}}} (unescaped)
      const expression = trim(toString(value));
      const evalResult = jexlInstance.evalSync(expression, context);

      if (isNil(evalResult)) {
        // Keep original if evaluation returns null/undefined
        result += '';
      } else if (isString(evalResult)) {
        result += evalResult;
      } else if (isBoolean(evalResult) || isNumber(evalResult)) {
        result += toString(evalResult);
      } else {
        result += JSON.stringify(evalResult);
      }
    }
    // Ignore other token types (sections, partials, etc.)
  }

  return result;
}
