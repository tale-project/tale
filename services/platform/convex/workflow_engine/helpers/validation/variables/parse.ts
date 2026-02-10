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

import { isRecord } from '../../../../../lib/utils/type-guards';

// Regex pattern to match mustache-style template expressions
// Note: The 'g' flag is added when creating the RegExp instance inside functions
// to avoid shared state issues with lastIndex
const TEMPLATE_PATTERN = /\{\{([^}]+)\}\}/g;

// Characters that indicate a complex expression (not a simple variable reference)
const EXPRESSION_OPERATORS = /[?:!<>=&|+\-*/[\]()]/;

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
  // We still want to validate field paths in these expressions
  if (isComplexExpression(trimmed)) {
    // For complex expressions, extract the full step reference path before the operator
    // e.g., "steps.foo.output.data.bar == 'baz'" -> extract full path "steps.foo.output.data.bar"
    // Match: steps.<slug>.<path segments> until we hit an operator or space
    const stepPathMatch = trimmed.match(
      /^steps\.([a-zA-Z_][a-zA-Z0-9_]*)((?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)/,
    );
    if (stepPathMatch) {
      const stepSlug = stepPathMatch[1];
      // Extract path segments after the step slug (e.g., ".output.data.length" -> ["output", "data", "length"])
      const pathString = stepPathMatch[2]; // e.g., ".output.data.length"
      const path = pathString ? pathString.slice(1).split('.') : [];

      return {
        fullExpression: trimmed,
        type: 'step',
        stepSlug,
        path,
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

  // System variables available at runtime
  // Note: Keep this list in sync with the actual system variables injected
  // by the workflow engine (see workflow execution context)
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

  // Create a new regex instance to avoid shared state issues with lastIndex
  const templateRegex = new RegExp(TEMPLATE_PATTERN.source, 'g');

  while ((match = templateRegex.exec(template)) !== null) {
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

  if (isRecord(value)) {
    return Object.values(value).flatMap((val) => parseVariableReferences(val));
  }

  return [];
}

/**
 * Extract only step references from a value
 */
export function extractStepReferences(
  value: unknown,
): ParsedVariableReference[] {
  return parseVariableReferences(value).filter((ref) => ref.type === 'step');
}

/**
 * Parse a raw JEXL expression (without mustache brackets) for step references.
 * This is used for condition expressions which use direct JEXL syntax.
 *
 * Example: "steps.query_existing_customer.output.data.page|length > 0"
 * -> extracts step reference with path ["output", "data", "page|length"]
 *
 * Example: "steps.query_existing_customer.output.data|length > 0"
 * -> extracts step reference with path ["output", "data|length"]
 */
export function parseJexlExpression(
  expression: string,
): ParsedVariableReference[] {
  const references: ParsedVariableReference[] = [];
  const trimmed = expression.trim();

  // Find all step references in the expression
  // Pattern matches: steps.<slug>.<path> where path is dot-separated identifiers
  // and optionally includes a JEXL filter like |length on the last segment
  const stepRefPattern =
    /steps\.([a-zA-Z_][a-zA-Z0-9_]*)((?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)(\|[a-zA-Z_][a-zA-Z0-9_]*)?/g;

  let match;
  while ((match = stepRefPattern.exec(trimmed)) !== null) {
    const stepSlug = match[1];
    const pathString = match[2]; // e.g., ".output.data" or ".output.data.page"
    const filter = match[3]; // e.g., "|length" or undefined
    let path = pathString ? pathString.slice(1).split('.') : [];

    // If there's a filter, append it to the last path segment
    if (filter && path.length > 0) {
      path[path.length - 1] = path[path.length - 1] + filter;
    } else if (filter && path.length === 0) {
      // Filter applied directly to step (unusual but handle it)
      path = [filter.slice(1)]; // Remove the leading |
    }

    // match[0] is the full match including the filter (if present)
    references.push({
      fullExpression: trimmed,
      type: 'step',
      stepSlug,
      path,
      originalTemplate: match[0],
    });
  }

  return references;
}

/**
 * Extract step references from a condition expression (raw JEXL syntax)
 */
export function extractStepReferencesFromCondition(
  expression: string,
): ParsedVariableReference[] {
  // parseJexlExpression only returns references with type 'step', so filter is redundant
  return parseJexlExpression(expression);
}
