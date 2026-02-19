'use node';

/**
 * Timeout utility for agent response generation.
 *
 * Provides a Promise.race-based timeout that aborts the generation
 * via AbortController when the deadline is exceeded. This ensures
 * the action completes (with recovery) before the Convex platform
 * hard-kills it at ~10 minutes.
 */

export class AgentTimeoutError extends Error {
  readonly isTimeout = true;

  constructor(timeoutMs: number) {
    super(`Agent response timed out after ${timeoutMs}ms`);
    this.name = 'AgentTimeoutError';
  }
}

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  abortController?: AbortController,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abortController?.abort();
        reject(new AgentTimeoutError(timeoutMs));
      }, timeoutMs);
    }),
  ]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}
