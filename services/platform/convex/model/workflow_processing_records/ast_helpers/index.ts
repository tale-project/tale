/**
 * AST Helper Functions
 *
 * Utility functions and types for working with JEXL AST nodes.
 * Each function is in its own file following the one-function-per-file principle.
 */

// Export types
export type {
  ASTNode,
  BinaryExpression,
  ComparisonOperator,
  FilterCondition,
  Identifier,
  Literal,
  ParsedFilterExpression,
} from './types';

// Export functions
export { extractComparison } from './extract_comparison';
export { extractLiteralValue } from './extract_literal_value';
export { getFullFieldPath } from './get_full_field_path';
export { isSimpleField } from './is_simple_field';
export { mergeAndConditions } from './merge_and_conditions';
export { traverseAST } from './traverse_ast';
