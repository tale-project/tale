import { jexlInstance } from './jexl_instance';

/**
 * Validate template syntax using JEXL expression parser
 */
export function validateTemplate(template: string): {
  valid: boolean;
  error?: string;
} {
  // Extract all expressions from the template
  const expressions = [] as string[];
  const regex = /\{\{([^}]+)\}\}/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(template)) !== null) {
    expressions.push(match[1].trim());
  }

  // Validate each expression by compiling it with JEXL
  for (const expr of expressions) {
    // Skip step access syntax as it's handled specially
    if (expr.includes('step ')) {
      continue;
    }

    // Try to compile the expression to validate syntax
    // JEXL will throw an error if the syntax is invalid
    jexlInstance.compile(expr);
  }

  return { valid: true };
}

/**
 * Validate a raw JEXL expression (without mustache brackets).
 * This is used for condition expressions which use direct JEXL syntax.
 *
 * @param expression - The JEXL expression to validate
 * @returns Validation result with error message if invalid
 */
export function validateJexlExpression(expression: string): {
  valid: boolean;
  error?: string;
} {
  try {
    // Try to compile the expression to validate syntax
    // JEXL will throw an error if the syntax is invalid
    jexlInstance.compile(expression.trim());
    return { valid: true };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown JEXL syntax error';
    return {
      valid: false,
      error: `Invalid JEXL expression: ${errorMessage}`,
    };
  }
}
