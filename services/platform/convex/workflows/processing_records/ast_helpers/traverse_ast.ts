/**
 * Recursively traverse the AST to extract indexable conditions.
 *
 * This is the main entry point for AST traversal. It walks through the
 * AST tree and identifies conditions that can be used for database indexing.
 *
 * @param node - The AST node to traverse
 * @returns Extracted conditions and complexity flag
 */

import type { ASTNode, ParsedFilterExpression } from './types';

import { extractComparison } from './extract_comparison';
import { mergeAndConditions } from './merge_and_conditions';
import { isBinaryExpression } from './types';

export function traverseAST(
  node: ASTNode,
): Omit<ParsedFilterExpression, 'equalityConditions'> {
  if (isBinaryExpression(node)) {
    const binaryNode = node;

    // Handle logical AND operator
    if (binaryNode.operator === '&&') {
      const left = traverseAST(binaryNode.left);
      const right = traverseAST(binaryNode.right);
      return mergeAndConditions(left, right);
    }

    // Handle logical OR operator
    if (binaryNode.operator === '||') {
      // OR expressions require post-filtering
      // We could optimize by extracting conditions from each branch,
      // but for now we mark as complex
      return { conditions: [], hasComplexConditions: true };
    }

    // Handle comparison operators
    if (['==', '!=', '>', '<', '>=', '<='].includes(binaryNode.operator)) {
      return extractComparison(binaryNode);
    }
  }

  // Non-indexable patterns (FunctionCall, ConditionalExpression, UnaryExpression, etc.)
  return { conditions: [], hasComplexConditions: true };
}
