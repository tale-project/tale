/**
 * AST Type Definitions
 *
 * Type definitions for JEXL Abstract Syntax Tree nodes used in filter expression parsing.
 */

/**
 * Base AST node type
 */
export interface ASTNode {
  type: string;
}

/**
 * Binary expression node (e.g., a == b, x > 5)
 */
export interface BinaryExpression extends ASTNode {
  type: 'BinaryExpression';
  operator: string; // '==', '!=', '>', '<', '>=', '<=', '&&', '||'
  left: ASTNode;
  right: ASTNode;
}

/**
 * Identifier node (field reference)
 */
export interface Identifier extends ASTNode {
  type: 'Identifier';
  value: string;
  from?: Identifier; // For nested access like metadata.status
}

/**
 * Literal value node
 */
export interface Literal extends ASTNode {
  type: 'Literal';
  value: unknown; // string, number, boolean, null
}

export function isBinaryExpression(node: ASTNode): node is BinaryExpression {
  return node.type === 'BinaryExpression';
}

export function isIdentifier(node: ASTNode): node is Identifier {
  return node.type === 'Identifier';
}

/**
 * Comparison operators supported for indexing
 */
export type ComparisonOperator = '==' | '!=' | '>' | '<' | '>=' | '<=';

/**
 * A single filter condition extracted from the expression
 */
export interface FilterCondition {
  /** Field name (can be nested like 'metadata.status') */
  field: string;
  /** Comparison operator */
  operator: ComparisonOperator;
  /** Value to compare against */
  value: unknown;
  /** Whether this is a simple field (no dots) */
  isSimpleField: boolean;
}

/**
 * Result of parsing a filter expression
 */
export interface ParsedFilterExpression {
  /** All indexable conditions extracted from the expression */
  conditions: FilterCondition[];
  /** Whether the expression contains complex conditions that require post-filtering */
  hasComplexConditions: boolean;
  /**
   * Backward compatibility: equality conditions only
   * @deprecated Use conditions array instead
   */
  equalityConditions: Record<string, unknown>;
}
