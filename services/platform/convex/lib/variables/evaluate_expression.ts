import { jexlInstance } from './jexl_instance';

/**
 * Safe expression evaluator using JEXL
 * Supports: variables, comparisons, logic, math, ternary operator, array access, and more
 *
 * Examples:
 * - Simple access: user.name, items[0], items[0].name
 * - Comparisons: age > 18, status == "active"
 * - Logic: active && verified, age > 18 || hasPermission
 * - Math: price * 1.1, (subtotal + tax) * quantity
 * - Ternary: age >= 18 ? "adult" : "minor"
 * - Transforms: name|upper, items|length, description|trim
 */
export function evaluateExpression(
  expression: string,
  context: Record<string, unknown>,
): boolean {
  // Use JEXL to evaluate the expression and enforce boolean result
  const result = jexlInstance.evalSync(expression, context);
  if (typeof result !== 'boolean') {
    throw new Error(
      `Expression must return boolean, got: ${typeof result}. Expression: ${expression}`,
    );
  }
  return result;
}
