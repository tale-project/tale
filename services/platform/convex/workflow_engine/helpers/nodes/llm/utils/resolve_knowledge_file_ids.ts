/**
 * Resolve Knowledge File IDs
 *
 * Resolves knowledgeFileIds from LLM node config with variable substitution.
 * Handles both literal arrays and template expressions.
 */

import { replaceVariables } from '../../../../../lib/variables/replace_variables';

/**
 * Resolves knowledgeFileIds config value into a concrete string array.
 *
 * @param raw - Literal string array, template expression, or undefined
 * @param variables - Variables for template substitution
 * @returns Resolved file IDs array, or undefined if not configured
 */
export function resolveKnowledgeFileIds(
  raw: string[] | string | undefined,
  variables: Record<string, unknown>,
): string[] | undefined {
  if (raw === undefined) {
    return undefined;
  }

  if (Array.isArray(raw)) {
    // Literal array — resolve each element (handles "{{loop.item}}" cases)
    return raw.map((item) => {
      const resolved = replaceVariables(item, variables);
      if (typeof resolved !== 'string') {
        throw new Error(
          `knowledgeFileIds array element must resolve to a string, got ${typeof resolved}`,
        );
      }
      return resolved;
    });
  }

  // Single template expression like "{{input.knowledgeFileIds}}"
  const resolved = replaceVariables(raw, variables);

  if (!Array.isArray(resolved)) {
    throw new Error(
      `knowledgeFileIds template must resolve to an array, got ${typeof resolved}`,
    );
  }

  return resolved.map((item) => {
    if (typeof item !== 'string') {
      throw new Error(
        `knowledgeFileIds array element must be a string, got ${typeof item}`,
      );
    }
    return item;
  });
}
