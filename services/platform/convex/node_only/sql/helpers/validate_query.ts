/**
 * Validate SQL query for security (read-only check)
 */
export function validateQuery(query: string, readOnly: boolean): void {
  const normalizedQuery = query.trim().toUpperCase();

  if (readOnly) {
    const dangerousKeywords = [
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
    ];

    for (const keyword of dangerousKeywords) {
      // Use word boundary to avoid false positives (e.g., "INSERTED" table in SQL Server)
      const regex = new RegExp(`\\b${keyword}\\b`, 'i');
      if (regex.test(normalizedQuery)) {
        throw new Error(
          `Query contains forbidden keyword "${keyword}". This integration is configured as read-only.`,
        );
      }
    }
  }
}
