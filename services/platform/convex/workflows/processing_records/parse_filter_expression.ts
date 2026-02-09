/**
 * Filter Expression Parser using JEXL AST
 *
 * Parses JEXL expressions using Abstract Syntax Tree (AST) traversal
 * to extract indexable conditions for database query optimization.
 *
 * Supports:
 * - Equality: field == value
 * - Inequality: field != value
 * - Comparisons: field > value, field >= value, field < value, field <= value
 * - Logical operators: && (AND), || (OR)
 * - Nested fields: metadata.status == "active"
 * - Parentheses and complex expressions
 *
 * Examples:
 * - 'status == "closed"' => [{ field: 'status', operator: '==', value: 'closed' }]
 * - 'status == "open" && priority > 5' => [{ field: 'status', operator: '==', value: 'open' }, { field: 'priority', operator: '>', value: 5 }]
 * - 'status == "closed" && daysAgo(metadata.resolved_at) > 30' => [{ field: 'status', operator: '==', value: 'closed' }] + hasComplexConditions
 */

import type { ASTNode, ParsedFilterExpression } from './ast_helpers';

import { jexlInstance } from '../../lib/variables/jexl_instance';
import { traverseAST } from './ast_helpers';

export * from './ast_helpers';

/**
 * Parse a filter expression using JEXL AST to extract indexable conditions.
 *
 * This parser:
 * 1. Compiles the JEXL expression to an AST
 * 2. Recursively traverses the AST
 * 3. Extracts simple field comparisons that can use database indexes
 * 4. Marks complex expressions (function calls, ternaries, etc.) for post-filtering
 *
 * @param expression - The JEXL filter expression
 * @returns Parsed expression with conditions and complexity flag
 */
export function parseFilterExpression(
  expression: string,
): ParsedFilterExpression {
  if (!expression || expression.trim() === '') {
    return {
      conditions: [],
      hasComplexConditions: false,
      equalityConditions: {},
    };
  }

  try {
    // Compile expression to AST
    // Note: _getAst() is a private JEXL API but stable since JEXL 2.x
    // It returns the internal AST representation for static analysis
    const compiled = jexlInstance.compile(expression);
    const ast = compiled._getAst();

    // Traverse AST to extract indexable conditions
    // @ts-expect-error _getAst() is a private JEXL API that returns untyped AST nodes
    const result = traverseAST(ast as ASTNode);

    // Build backward-compatible equalityConditions
    const equalityConditions: Record<string, unknown> = {};
    for (const condition of result.conditions) {
      if (condition.operator === '==') {
        equalityConditions[condition.field] = condition.value;
      }
    }

    return {
      ...result,
      equalityConditions,
    };
  } catch (error) {
    // Invalid expression - treat as complex
    console.error('Failed to parse filter expression:', {
      expression,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      conditions: [],
      hasComplexConditions: true,
      equalityConditions: {},
    };
  }
}
