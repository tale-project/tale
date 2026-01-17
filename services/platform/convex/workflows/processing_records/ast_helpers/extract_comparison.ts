/**
 * Extract a comparison condition from a BinaryExpression node.
 *
 * Analyzes a comparison expression (e.g., `field == value`) and extracts
 * the field name, operator, and value if they can be used for indexing.
 *
 * @param node - The BinaryExpression node to extract from
 * @returns Extracted condition or complexity flag if non-indexable
 */

import type {
  BinaryExpression,
  ComparisonOperator,
  FilterCondition,
  Identifier,
  ParsedFilterExpression,
} from './types';
import { extractLiteralValue } from './extract_literal_value';
import { getFullFieldPath } from './get_full_field_path';

export function extractComparison(
  node: BinaryExpression,
): Omit<ParsedFilterExpression, 'equalityConditions'> {
  const left = node.left;
  const right = node.right;

  // Check if left side is a field reference (Identifier)
  if (left.type !== 'Identifier') {
    return { conditions: [], hasComplexConditions: true };
  }

  // Check if right side is a literal value or null identifier
  const extractResult = extractLiteralValue(right);
  if (!extractResult.isLiteral) {
    return { conditions: [], hasComplexConditions: true };
  }
  const rightValue = extractResult.value;

  const identifier = left as Identifier;

  // Extract field name (handle nested fields like metadata.status)
  const fieldName = getFullFieldPath(identifier);
  const isSimpleField = !fieldName.includes('.');

  const condition: FilterCondition = {
    field: fieldName,
    operator: node.operator as ComparisonOperator,
    value: rightValue,
    isSimpleField,
  };

  return {
    conditions: [condition],
    hasComplexConditions: false,
  };
}
