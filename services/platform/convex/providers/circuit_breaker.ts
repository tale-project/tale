/**
 * Simple in-memory circuit breaker for provider model failover.
 *
 * Tracks failure counts per provider:model key and determines whether
 * a model should be skipped (circuit open) based on recent failures.
 *
 * States:
 * - Closed: normal operation, requests flow through.
 * - Open: too many recent failures, skip for cooldown period.
 * - Half-open: cooldown elapsed, allow one probe request.
 *
 * NOTE: This runs in-memory within a Convex action. State is per-process
 * and resets on deployment. This is intentional — circuit breaker state
 * is ephemeral and self-healing by design.
 */

const FAILURE_THRESHOLD = 3;
const FAILURE_WINDOW_MS = 60_000;
const COOLDOWN_MS = 30_000;

interface CircuitState {
  failures: number[];
  openedAt: number | null;
  halfOpen: boolean;
}

const circuits = new Map<string, CircuitState>();

function getKey(provider: string, model: string): string {
  return `${provider}:${model}`;
}

function getOrCreate(key: string): CircuitState {
  let state = circuits.get(key);
  if (!state) {
    state = { failures: [], openedAt: null, halfOpen: false };
    circuits.set(key, state);
  }
  return state;
}

function pruneOldFailures(state: CircuitState, now: number): void {
  const cutoff = now - FAILURE_WINDOW_MS;
  state.failures = state.failures.filter((t) => t > cutoff);
}

export function recordFailure(provider: string, model: string): void {
  const key = getKey(provider, model);
  const state = getOrCreate(key);
  const now = Date.now();

  state.failures.push(now);
  pruneOldFailures(state, now);

  if (state.failures.length >= FAILURE_THRESHOLD) {
    state.openedAt = now;
    state.halfOpen = false;
  }
}

export function recordSuccess(provider: string, model: string): void {
  const key = getKey(provider, model);
  const state = circuits.get(key);
  if (!state) return;

  state.failures = [];
  state.openedAt = null;
  state.halfOpen = false;
}

export function isOpen(provider: string, model: string): boolean {
  const key = getKey(provider, model);
  const state = circuits.get(key);
  if (!state || state.openedAt === null) return false;

  const now = Date.now();
  const elapsed = now - state.openedAt;

  if (elapsed >= COOLDOWN_MS) {
    if (!state.halfOpen) {
      state.halfOpen = true;
      return false;
    }
    return false;
  }

  return true;
}
