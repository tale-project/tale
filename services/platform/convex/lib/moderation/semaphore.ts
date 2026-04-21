/**
 * In-isolate per-stream semaphore for throttling concurrent moderation calls.
 *
 * A single streaming response may emit dozens of chunks in a second; without
 * throttling, the guardrails transform would fan out as many parallel fetches
 * to the admin-configured moderation provider, eating quota and bypassing
 * the per-stream backpressure the buffer design assumes.
 *
 * Mirrors the ephemerality of providers/circuit_breaker.ts — state is
 * per-process, resets on deployment, self-heals by design. Each worker has
 * its own map, so the effective ceiling is `perStreamMax * workerCount`
 * for the same streamId (in practice one stream is served by one worker).
 */

interface SlotState {
  inFlight: number;
  queue: Array<() => void>;
}

const streams = new Map<string, SlotState>();

function getOrCreate(streamId: string): SlotState {
  let state = streams.get(streamId);
  if (!state) {
    state = { inFlight: 0, queue: [] };
    streams.set(streamId, state);
  }
  return state;
}

export type ReleaseSlot = () => void;

export async function acquire(
  streamId: string,
  max: number,
): Promise<ReleaseSlot> {
  const state = getOrCreate(streamId);

  if (state.inFlight < max) {
    state.inFlight += 1;
    return () => release(streamId);
  }

  return new Promise<ReleaseSlot>((resolve) => {
    state.queue.push(() => {
      state.inFlight += 1;
      resolve(() => release(streamId));
    });
  });
}

function release(streamId: string): void {
  const state = streams.get(streamId);
  if (!state) return;
  state.inFlight = Math.max(0, state.inFlight - 1);

  const next = state.queue.shift();
  if (next) {
    next();
    return;
  }

  if (state.inFlight === 0 && state.queue.length === 0) {
    streams.delete(streamId);
  }
}

export function inFlightCount(streamId: string): number {
  return streams.get(streamId)?.inFlight ?? 0;
}

export function queueDepth(streamId: string): number {
  return streams.get(streamId)?.queue.length ?? 0;
}

/** Test helper — drops all state. Never call from production paths. */
export function resetForTesting(): void {
  streams.clear();
}
