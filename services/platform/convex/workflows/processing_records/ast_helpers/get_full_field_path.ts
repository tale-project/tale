/**
 * Extract full field path from an Identifier AST node.
 *
 * Handles nested field access like `metadata.status` by traversing
 * the chain of `from` references.
 *
 * @param identifier - The Identifier AST node
 * @returns The full field path (e.g., "metadata.status")
 *
 * @example
 * // For identifier representing "metadata.status"
 * getFullFieldPath(identifier) // Returns "metadata.status"
 */
export function getFullFieldPath(identifier: {
  value: string;
  from?: { value: string; from?: any };
}): string {
  const parts: string[] = [];
  let current: { value: string; from?: any } | undefined = identifier;

  while (current) {
    parts.unshift(current.value);
    current = current.from;
  }

  return parts.join('.');
}
