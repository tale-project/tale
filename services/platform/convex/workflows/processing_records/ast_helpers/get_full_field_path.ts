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
interface IdentifierLike {
  value: string;
  from?: IdentifierLike;
}

export function getFullFieldPath(identifier: IdentifierLike): string {
  const parts: string[] = [];
  let current: IdentifierLike | undefined = identifier;

  while (current) {
    parts.unshift(current.value);
    current = current.from;
  }

  return parts.join('.');
}
