/**
 * Utility functions for accessing environment variables with validation
 */

/**
 * Get an environment variable or throw an error if it's not set
 * @param key - Environment variable name
 * @param description - Human-readable description for error messages
 * @returns The environment variable value
 * @throws Error if the environment variable is not set or is empty
 */
export function getEnvOrThrow(key: string, description?: string): string {
  const value = process.env[key];

  if (!value || value.trim() === '') {
    const desc = description ? ` (${description})` : '';
    throw new Error(
      `[Environment] Missing required environment variable: ${key}${desc}. ` +
        `Please set it in your .env file or Convex environment.`,
    );
  }

  return value.trim();
}

/**
 * Get an optional environment variable
 * @param key - Environment variable name
 * @returns The environment variable value or undefined if not set
 */
export function getEnvOptional(key: string): string | undefined {
  const value = process.env[key];
  return value && value.trim() !== '' ? value.trim() : undefined;
}

/**
 * Get an environment variable with a default fallback
 * @param key - Environment variable name
 * @param defaultValue - Default value if not set
 * @returns The environment variable value or default
 */
export function getEnvWithDefault(key: string, defaultValue: string): string {
  const value = process.env[key];
  return value && value.trim() !== '' ? value.trim() : defaultValue;
}
