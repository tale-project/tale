/**
 * Extract a literal value from an AST node.
 *
 * Handles both Literal nodes and special identifier values
 * (null, undefined, true, false) that JEXL parses as Identifiers.
 *
 * @param node - The AST node to extract from
 * @returns An object indicating whether the node is a literal and its value
 *
 * @example
 * extractLiteralValue({ type: 'Literal', value: 42 })
 * // Returns { isLiteral: true, value: 42 }
 *
 * @example
 * extractLiteralValue({ type: 'Identifier', value: 'null' })
 * // Returns { isLiteral: true, value: null }
 */
export function extractLiteralValue(node: {
  type: string;
  value?: unknown;
  from?: any;
}): { isLiteral: boolean; value: unknown } {
  if (node.type === 'Literal') {
    return { isLiteral: true, value: node.value };
  }

  // Handle null, undefined, true, false as Identifiers
  if (node.type === 'Identifier' && typeof node.value === 'string') {
    if (node.value === 'null' && !node.from) {
      return { isLiteral: true, value: null };
    }
    if (node.value === 'undefined' && !node.from) {
      return { isLiteral: true, value: undefined };
    }
    if (node.value === 'true' && !node.from) {
      return { isLiteral: true, value: true };
    }
    if (node.value === 'false' && !node.from) {
      return { isLiteral: true, value: false };
    }
  }

  return { isLiteral: false, value: undefined };
}
