/**
 * String utility functions
 * Lightweight replacements for lodash string functions
 */

const LEADING_PUNCTUATION_RE = /^[\s:：;；,，.。!！?？…·\-—–]+/;

/**
 * Converts a string to Start Case (capitalizes first letter of each word).
 * Handles camelCase, snake_case, kebab-case, and space-separated strings.
 * Module-private: reach it through {@link formatEnumLabel}.
 */
function startCase(str: string): string {
  if (!str) return '';

  return (
    str
      // Insert space before uppercase letters in camelCase
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      // Replace underscores and hyphens with spaces
      .replace(/[_-]+/g, ' ')
      // Capitalize first letter of each word, lowercase the rest
      .replace(/\b\w/g, (char) => char.toUpperCase())
      .replace(/\B\w+/g, (word) => word.toLowerCase())
      .trim()
  );
}

/** Strips leading whitespace and punctuation from a string. */
export function stripLeadingPunctuation(text: string): string {
  return text.replace(LEADING_PUNCTUATION_RE, '');
}

/**
 * Renders a raw backend enum (e.g. `manual_import`) as a Title Case UI label
 * (`Manual Import`), falling back to `fallback` when unset — the one mapping
 * every surface showing a snake_case enum value should call, so a table
 * column and a detail view can't independently reimplement (and drift on)
 * the same formatting (#2643).
 */
export function formatEnumLabel(
  value: string | null | undefined,
  fallback: string,
): string {
  return value ? startCase(value.toLowerCase()) : fallback;
}
