/**
 * Timeout primitives for MCP client operations.
 *
 * Kept dependency-free (no MCP SDK / Node imports) so the behavior can be
 * unit-tested in isolation. Consumed by {@link ../client_factory} to bound
 * the connect handshake + tool discovery/call.
 */

/**
 * Max time we wait for an MCP server to complete the connect handshake +
 * the requested operation (tool discovery / tool call). A slow or
 * unreachable endpoint would otherwise hang the request until the SDK's
 * 60s default fires — far too long for an interactive "Test connection".
 */
export const MCP_CONNECTION_TIMEOUT_MS = 15_000;

/**
 * Thrown when an MCP operation exceeds {@link MCP_CONNECTION_TIMEOUT_MS}.
 * The message is surfaced verbatim to the UI by the testConnection action,
 * so it reads as a clear, actionable timeout notice.
 */
export class McpTimeoutError extends Error {
  constructor(timeoutMs: number = MCP_CONNECTION_TIMEOUT_MS) {
    super(
      `MCP server did not respond within ${Math.round(timeoutMs / 1000)}s. Check that the endpoint is reachable and not blocked by a firewall.`,
    );
    this.name = 'McpTimeoutError';
  }
}

/**
 * Race an operation against a timeout. On timeout, invoke `onTimeout`
 * (used to abort the in-flight transport request so the underlying fetch
 * is cancelled rather than left dangling) and reject with
 * {@link McpTimeoutError}. The operation's late settlement is observed and
 * logged so it never surfaces as an unhandled rejection once the race is
 * lost.
 */
export async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      try {
        onTimeout?.();
      } catch (err) {
        console.warn('MCP timeout abort handler failed:', err);
      }
      reject(new McpTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  // Prevent an unhandled rejection if the aborted operation settles after
  // the timeout already won the race.
  operation.catch((err: unknown) => {
    if (timedOut) {
      console.warn(
        'MCP operation aborted after timeout:',
        err instanceof Error ? err.message : err,
      );
    }
  });

  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
