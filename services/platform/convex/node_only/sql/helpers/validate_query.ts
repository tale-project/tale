/**
 * Validate SQL query for security (read-only check)
 */

// Pre-compile regex patterns for dangerous keywords to avoid repeated compilation
const DANGEROUS_KEYWORDS = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'DROP',
  'TRUNCATE',
  'ALTER',
  'CREATE',
  'GRANT',
  'REVOKE',
  'EXEC',
  'EXECUTE',
] as const;

// Combined regex pattern with word boundaries for all dangerous keywords
const DANGEROUS_PATTERN = new RegExp(
  `\\b(${DANGEROUS_KEYWORDS.join('|')})\\b`,
  'i',
);

export function validateQuery(query: string, readOnly: boolean): void {
  if (readOnly) {
    const match = query.match(DANGEROUS_PATTERN);
    if (match) {
      throw new Error(
        `Query contains forbidden keyword "${match[1].toUpperCase()}". This integration is configured as read-only.`,
      );
    }
  }
}
