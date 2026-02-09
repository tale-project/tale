import { isArray, isPlainObject, isString, map, toString, trim } from 'lodash';
import Mustache from 'mustache';

import { buildContext } from './build_context';
import { jexlInstance } from './jexl_instance';
import { replaceVariablesInString } from './replace_variables_in_string';

/**
 * Replace variables in templates with safe expression evaluation.
 *
 * Features:
 * - Supports dot and [index] paths (e.g., {{data.product.title}})
 * - Supports JavaScript expressions (e.g., {{data.product.status === "active"}})
 * - Safe evaluation without eval() or Function constructor
 * - Recursively processes objects and arrays
 * - Preserves types for single-expression templates
 *
 * @param value - Template string, object, array, or any value to process
 * @param variables - Variables to use for replacement
 * @returns Processed value with variables replaced
 *
 * @example
 * // String template
 * replaceVariables("Hello {{name}}", { name: "World" }) // "Hello World"
 *
 * @example
 * // Single expression (preserves type)
 * replaceVariables("{{user.age}}", { user: { age: 25 } }) // 25 (number)
 *
 * @example
 * // Object with nested templates
 * replaceVariables({ title: "{{product.name}}", price: "{{product.price}}" }, variables)
 */
export function replaceVariables(
  value: string,
  variables: Record<string, unknown>,
): string;
export function replaceVariables(
  value: unknown,
  variables: Record<string, unknown>,
): unknown;
export function replaceVariables(
  value: unknown,
  variables: Record<string, unknown>,
): unknown {
  if (isString(value)) {
    const context = buildContext(variables);

    // Use Mustache to parse and check if it's a single expression
    const tokens = Mustache.parse(value);

    // Check if this is a single-expression template (for type preservation)
    // A single expression has exactly 1 token of type 'name' or '&'
    const isSingleExpression =
      tokens.length === 1 && (tokens[0][0] === 'name' || tokens[0][0] === '&');

    if (isSingleExpression) {
      // Single expression - evaluate and return typed result
      const expression = trim(toString(tokens[0][1]));
      return jexlInstance.evalSync(expression, context);
    }

    // Mixed content → string replacement
    const rendered = replaceVariablesInString(value, variables);

    // Fail-fast if template markers remain unresolved
    if (/\{\{[\s\S]*\}\}/.test(rendered)) {
      throw new Error(`Unresolved template after rendering: ${rendered}`);
    }

    return rendered;
  }

  if (isArray(value)) {
    return map(value, (v) => replaceVariables(v, variables));
  }

  if (isPlainObject(value)) {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};

    for (const [key, val] of Object.entries(obj)) {
      // Replace variables in both key and value
      const processedKey = isString(key)
        ? replaceVariables(key, variables)
        : key;
      const processedValue = replaceVariables(val, variables);
      result[processedKey] = processedValue;
    }

    return result;
  }

  return value;
}
