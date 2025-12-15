/**
 * Parse Variable References
 *
 * Extracts and parses variable references from workflow template strings.
 * Handles patterns like:
 * - {{steps.step_slug.output.data.fieldName}}
 * - {{variableName}}
 * - {{loop.item.fieldName}}
 * - {{secrets.secretName}}
 * - {{input.fieldName}}
 */

import type { ParsedVariableReference } from './types';

// Regex to match mustache-style template expressions
const TEMPLATE_REGEX = /\{\{([^}]+)\}\}/g;

// Characters that indicate a complex expression (not a simple variable reference)
const EXPRESSION_OPERATORS = /[?:!<>=&|+\-*\/\[\]()]/;

/**
 * Check if an expression is a complex expression (contains operators)
 * rather than a simple variable path
 */
function isComplexExpression(expression: string): boolean {
  return EXPRESSION_OPERATORS.test(expression);
}

/**
 * Parse a single expression into a structured reference
 */
function parseExpression(
  expression: string,
  originalTemplate: string,
): ParsedVariableReference {
  const trimmed = expression.trim();

  // Check for complex expressions (ternary, comparison, etc.)
  // These can't be validated for field access
  if (isComplexExpression(trimmed)) {
    // For complex expressions, try to extract the step reference if present
    // e.g., "steps.foo.output.data.bar == 'baz'" -> extract "steps.foo"
    const stepMatch = trimmed.match(/^steps\.([a-zA-Z_][a-zA-Z0-9_]*)\.?/);
    if (stepMatch) {
      return {
        fullExpression: trimmed,
        type: 'step',
        stepSlug: stepMatch[1],
        path: ['__complex_expression__'], // Special marker for complex expressions
        originalTemplate,
      };
    }

    // Return as a variable reference that won't be validated
    return {
      fullExpression: trimmed,
      type: 'variable',
      path: ['__complex_expression__'],
      originalTemplate,
    };
  }

  const parts = trimmed.split('.');

  // Determine the reference type based on the first segment
  const firstPart = parts[0];

  if (firstPart === 'steps' && parts.length >= 2) {
    // Step reference: steps.step_slug.output.data...
    return {
      fullExpression: trimmed,
      type: 'step',
      stepSlug: parts[1],
      path: parts.slice(2), // Everything after the step slug
      originalTemplate,
    };
  }

  if (firstPart === 'loop') {
    // Loop reference: loop.item, loop.index, loop.state, etc.
    return {
      fullExpression: trimmed,
      type: 'loop',
      path: parts.slice(1),
      originalTemplate,
    };
  }

  if (firstPart === 'secrets') {
    // Secret reference: secrets.secretName
    return {
      fullExpression: trimmed,
      type: 'secret',
      path: parts.slice(1),
      originalTemplate,
    };
  }

  if (firstPart === 'input') {
    // Input reference: input.fieldName
    return {
      fullExpression: trimmed,
      type: 'input',
      path: parts.slice(1),
      originalTemplate,
    };
  }

  // System variables
  const systemVars = [
    'organizationId',
    'wfDefinitionId',
    'rootWfDefinitionId',
    'executionId',
    'now',
    'nowMs',
  ];
  if (systemVars.includes(firstPart)) {
    return {
      fullExpression: trimmed,
      type: 'system',
      path: parts,
      originalTemplate,
    };
  }

  // Default: treat as a variable reference
  return {
    fullExpression: trimmed,
    type: 'variable',
    path: parts,
    originalTemplate,
  };
}

/**
 * Extract all variable references from a template string
 */
export function parseVariableReferencesFromString(
  template: string,
): ParsedVariableReference[] {
  const references: ParsedVariableReference[] = [];
  let match;

  // Reset regex state
  TEMPLATE_REGEX.lastIndex = 0;

  while ((match = TEMPLATE_REGEX.exec(template)) !== null) {
    const expression = match[1];
    const originalTemplate = match[0];
    references.push(parseExpression(expression, originalTemplate));
  }

  return references;
}

/**
 * Recursively extract all variable references from a value (string, object, or array)
 */
export function parseVariableReferences(
  value: unknown,
): ParsedVariableReference[] {
  if (typeof value === 'string') {
    return parseVariableReferencesFromString(value);
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => parseVariableReferences(item));
  }

  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return Object.values(obj).flatMap((val) => parseVariableReferences(val));
  }

  return [];
}

/**
 * Extract only step references from a value
 */
export function extractStepReferences(value: unknown): ParsedVariableReference[] {
  return parseVariableReferences(value).filter((ref) => ref.type === 'step');
}
