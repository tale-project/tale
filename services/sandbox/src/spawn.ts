// Per-call execution dispatch. The route handler in server.ts hands a typed
// ExecuteRequest in; this module owns the in-flight registry (so cancel +
// orphan-sweep can address a live execution by id), validates the request
// shape, then delegates the actual stage → run → stream → harvest → response
// orchestration to the injected ExecutionBackend's `execute()` (DockerBackend
// for Compose, KubernetesBackend for Helm; see backend/types.ts). This module
// never touches docker or k8s directly.

import type { ExecuteCallbacks, ExecutionBackend } from './backend/types.ts';
import { makeError } from './exec-common.ts';
import type {
  ExecuteRequest,
  ExecuteResponse,
  SpawnerConfig,
} from './types.ts';
import { ID_ALPHABET_RE, ORG_ID_ALPHABET_RE } from './wire.ts';

interface InFlight {
  abort: AbortController;
  startedAt: number;
}

const inFlight = new Map<string, InFlight>();

export function isInFlight(executionId: string): boolean {
  return inFlight.has(executionId);
}

export function inFlightSize(): number {
  return inFlight.size;
}

export function inFlightIds(): string[] {
  return Array.from(inFlight.keys());
}

/**
 * Pre-registers an id when the HTTP handler accepts a request but before
 * `executeRequest` has constructed the real InFlight entry. The placeholder
 * is overwritten in executeRequest; `unregisterInFlight` is a no-op once the
 * real entry has been removed by executeRequest's own finally block.
 */
export function registerInFlight(executionId: string): void {
  if (inFlight.has(executionId)) return;
  // Placeholder until executeRequest swaps in the real entry. The
  // AbortController exists so an early cancelExecution call sees a real
  // signal-bearing object.
  inFlight.set(executionId, {
    abort: new AbortController(),
    startedAt: Date.now(),
  });
}

export function unregisterInFlight(executionId: string): void {
  inFlight.delete(executionId);
}

/**
 * LOCAL cancel: abort the in-flight signal and let `execute()` own the
 * teardown. The docker backend kills the container promptly via an abort
 * listener inside its wait(); the k8s backend's poll loop exits on the abort,
 * performs its final log reads against the still-existing Pod, and its
 * finally deletes Pod + Secret — so a cancel can never race the result
 * harvest. The REMOTE/cross-replica path is `backend.cancel()`, invoked by
 * server.ts only when the id is not in this replica's registry.
 */
export function cancelExecution(executionId: string): boolean {
  const entry = inFlight.get(executionId);
  if (!entry) return false;
  entry.abort.abort('cancelled by client');
  return true;
}

/**
 * Dispatch one execution: validate the request shape, register it in the
 * in-flight map (so cancel/sweep can reach it), then hand off to the backend's
 * `execute()`. The backend owns staging, the runtime, live-progress streaming,
 * harvest, and cleanup; this wrapper owns only the registry + validation. The
 * `opts` callbacks (onPhase/onStdoutDelta/onStderrDelta) are the SSE layer's
 * live-progress hooks, forwarded verbatim with the cancel signal + start time.
 */
export async function executeRequest(
  backend: ExecutionBackend,
  cfg: SpawnerConfig,
  req: ExecuteRequest,
  opts: ExecuteCallbacks = {},
): Promise<ExecuteResponse> {
  if (!ID_ALPHABET_RE.test(req.executionId)) {
    return makeError('SPAWNER_UNAVAILABLE', 'invalid executionId', 0);
  }
  if (!ORG_ID_ALPHABET_RE.test(req.organizationId)) {
    return makeError('SPAWNER_UNAVAILABLE', 'invalid organizationId', 0);
  }
  if (
    req.language !== 'python' &&
    req.language !== 'node' &&
    req.language !== 'polyglot'
  ) {
    return makeError('SPAWNER_UNAVAILABLE', 'invalid language', 0);
  }

  const startedAtMs = Date.now();

  // Reuse the placeholder AbortController if the server pre-registered one
  // when the request landed. A `cancelExecution` call between registerInFlight
  // and this line targets the placeholder's signal — discarding it here and
  // building a fresh controller would leak that early abort, leaving the
  // runtime running until the watchdog timeout. Reusing the entry preserves
  // the (already-aborted, if cancelled) signal.
  const placeholder = inFlight.get(req.executionId);
  const abort = placeholder?.abort ?? new AbortController();
  inFlight.set(req.executionId, { abort, startedAt: startedAtMs });

  try {
    return await backend.execute(cfg, req, {
      ...opts,
      signal: abort.signal,
      startedAtMs,
    });
  } catch (err) {
    // Defensive backstop: `execute()` is contracted to return a failed/
    // cancelled response rather than throw, so this only fires on a truly
    // unexpected backend error.
    const message = err instanceof Error ? err.message : String(err);
    return makeError(
      'SPAWNER_UNAVAILABLE',
      `spawner internal error: ${message}`,
      Date.now() - startedAtMs,
    );
  } finally {
    inFlight.delete(req.executionId);
  }
}
