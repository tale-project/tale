import {
  SafeFetchError,
  type SafeFetchResponse,
} from '../../../lib/net/safe-fetch';

/** Internal execution scope, never accepted from a credential or task input. */
export interface BrokerTransportScope {
  readonly deadlineAt: number;
  readonly signal?: AbortSignal;
  readonly assertCurrent: () => Promise<void>;
}

export interface BrokerTransport {
  readonly request: (
    fetch: (
      remainingMs: number,
      signal: AbortSignal,
    ) => Promise<SafeFetchResponse>,
  ) => Promise<SafeFetchResponse>;
}

const TRANSIENT_STATUSES = new Set([502, 503, 504, 521]);
const TRANSIENT_KINDS = new Set(['network_error', 'dns_failed', 'timeout']);
const BACKOFF_MS = [5_000, 10_000];

/** Capture both clocks before the first credential lookup, never per retry. */
export function brokerTransportDeadline(scope: BrokerTransportScope): number {
  return (
    performance.now() +
    Math.max(0, Math.min(60_000, scope.deadlineAt - Date.now()))
  );
}

/** A malformed header must not make us retry earlier than the server asked. */
function retryAfterMs(value: string | null): number | null {
  if (value === null) return 0;
  if (/^\d+$/.test(value)) {
    const seconds = Number(value);
    return Number.isSafeInteger(seconds) &&
      seconds <= Number.MAX_SAFE_INTEGER / 1_000
      ? seconds * 1_000
      : null;
  }
  if (
    !/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(
      value,
    )
  ) {
    return null;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) && new Date(date).toUTCString() === value
    ? Math.max(0, date - Date.now())
    : null;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(new SafeFetchError('aborted', 'Broker transport stopped.'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

/**
 * One admitted task's GET transport budget. Only the request is replayed;
 * mapping and durable account selection belong to resolve, once. SQL reads
 * are awaited, not raced/abandoned: elapsed time still refuses a late result.
 */
export async function withBrokerTransport<T>(
  scope: BrokerTransportScope,
  assertCredential: () => Promise<void>,
  resolve: (transport: BrokerTransport) => Promise<T>,
  deadline = brokerTransportDeadline(scope),
): Promise<T> {
  const budget = deadline - performance.now();
  const controller = new AbortController();
  const abort = () => controller.abort();
  scope.signal?.addEventListener('abort', abort, { once: true });
  if (scope.signal?.aborted) abort();
  const timer = setTimeout(abort, Math.max(0, budget));
  const remaining = () => {
    const left = deadline - performance.now();
    if (controller.signal.aborted || left <= 0 || !Number.isFinite(left)) {
      throw new SafeFetchError('aborted', 'Broker transport stopped.');
    }
    return Math.max(1, Math.floor(left));
  };
  const validate = async () => {
    remaining();
    await assertCredential();
    remaining();
    await scope.assertCurrent();
    remaining();
  };
  try {
    const value = await resolve({
      request: async (fetch) => {
        for (let attempt = 0; ; attempt++) {
          await validate();
          let response: SafeFetchResponse;
          try {
            response = await fetch(remaining(), controller.signal);
          } catch (error) {
            remaining();
            const backoff = BACKOFF_MS[attempt];
            if (
              !(error instanceof SafeFetchError) ||
              !TRANSIENT_KINDS.has(error.kind) ||
              backoff === undefined
            ) {
              throw error;
            }
            const delay = backoff + Math.floor(Math.random() * 1_001);
            if (delay >= remaining()) throw error;
            await wait(delay, controller.signal);
            continue;
          }
          remaining();
          const backoff = BACKOFF_MS[attempt];
          if (
            !TRANSIENT_STATUSES.has(response.status) ||
            backoff === undefined
          ) {
            await validate();
            return response;
          }
          const retryAfter = retryAfterMs(response.headers.get('retry-after'));
          const delay = Math.max(
            backoff + Math.floor(Math.random() * 1_001),
            retryAfter ?? 0,
          );
          if (retryAfter === null || delay >= remaining()) return response;
          await wait(delay, controller.signal);
        }
      },
    });
    await validate();
    return value;
  } finally {
    clearTimeout(timer);
    scope.signal?.removeEventListener('abort', abort);
  }
}
