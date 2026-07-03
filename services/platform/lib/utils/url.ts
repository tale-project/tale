/**
 * URL validation utilities shared across forms and backend boundaries.
 */

/**
 * Whether a string is a syntactically valid absolute URL using the `http:` or
 * `https:` scheme. Rejects empty strings, scheme-less values, and any other
 * protocol (e.g. `ftp:`, `javascript:`).
 *
 * "https://example.com/mcp" → true
 * "http://localhost:3000"   → true
 * "not-a-url"               → false
 * "ftp://example.com"       → false
 * "javascript:alert(1)"     → false
 */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
