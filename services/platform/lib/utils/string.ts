/**
 * String utility functions
 * Lightweight replacements for lodash string functions
 */

/**
 * Converts a string to Start Case (capitalizes first letter of each word)
 * Handles camelCase, snake_case, kebab-case, and space-separated strings
 *
 * @example
 * startCase('hello_world') // 'Hello World'
 * startCase('helloWorld') // 'Hello World'
 * startCase('hello-world') // 'Hello World'
 * startCase('HELLO') // 'Hello'
 */
export function startCase(str: string): string {
  if (!str) return '';

  return str
    // Insert space before uppercase letters in camelCase
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    // Replace underscores and hyphens with spaces
    .replace(/[_-]+/g, ' ')
    // Capitalize first letter of each word, lowercase the rest
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .replace(/\B\w+/g, (word) => word.toLowerCase());
}

/**
 * Capitalizes the first letter of a string
 *
 * @example
 * capitalize('hello') // 'Hello'
 * capitalize('HELLO') // 'Hello'
 */
function capitalize(str: string): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}
