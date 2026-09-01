/**
 * Global environment variable to enable all debug logs at once.
 * Set DEBUG_MODE=true to enable all debug loggers regardless of their individual env vars.
 */
const DEBUG_MODE = process.env.DEBUG_MODE === 'true';

/**
 * Create a namespaced debug logger controlled by an environment variable.
 *
 * Logs are enabled when either:
 * - The specific environment variable is set to 'true' (e.g., DEBUG_IMAP=true)
 * - The global DEBUG_ALL environment variable is set to 'true'
 *
 * @param envVar - Environment variable name (e.g., 'DEBUG_IMAP')
 * @param prefix - Optional prefix for log messages (defaults to envVar in brackets)
 * @returns A debug logging function that only logs when enabled
 *
 * @example
 * const debugLog = createDebugLog('DEBUG_IMAP', '[IMAP]');
 * debugLog('Connecting to server', { host, port });
 *
 * @example
 * // For thread-specific debugging
 * const debugLog = createDebugLog('DEBUG_IMAP_THREAD', '[IMAP Thread]');
 * debugLog('Found', messages.length, 'messages');
 */
export function createDebugLog(
  envVar: string,
  prefix?: string,
): (...args: unknown[]) => void {
  const isEnabled = DEBUG_MODE || process.env[envVar] === 'true';
  const logPrefix = prefix ?? `[${envVar}]`;

  return (...args: unknown[]): void => {
    if (isEnabled) {
      console.log(logPrefix, ...args);
    }
  };
}
