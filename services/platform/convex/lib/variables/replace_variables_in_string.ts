import isBoolean from 'lodash/isBoolean';
import isNil from 'lodash/isNil';
import isNumber from 'lodash/isNumber';
import isString from 'lodash/isString';
import toString from 'lodash/toString';
import trim from 'lodash/trim';
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

      if (isString(evalResult)) {
        result += evalResult;
      } else if (isBoolean(evalResult) || isNumber(evalResult)) {
        result += toString(evalResult);
      } else if (!isNil(evalResult)) {
        result += JSON.stringify(evalResult);
      }
      // A resolved-but-nil reference (an absent optional field — e.g. a task
      // with no description, or empty labels) contributes nothing to the
      // rendered string. We deliberately do NOT re-emit the `{{marker}}`: a
      // leftover marker would reach the LLM verbatim or trip the guard in
      // replaceVariables(). JEXL returns undefined for both a nil value and an
      // unknown path, so this can't distinguish a leaf-level typo at runtime;
      // unknown reference *sources* are caught at authoring time by
      // validateVariableReferencesKnownSources.
    }
    // Ignore other token types (sections, partials, etc.)
  }

  return result;
}
